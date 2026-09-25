import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import pool from "@/lib/db";
import { canonicalizeDeviceId, canonicalizeSerial } from "@/lib/utils";
import { WORK_ORDER_TYPES, type WorkOrderType } from "@/types";

// POST /api/registry/work-orders — iş emri oluştur, tipe göre eşleşmeyi güncelle.
//
// Tip → etki haritası, commands/route.ts'teki VALIDATORS deseninin aynısı: her tip
// kendi sözleşmesini doğrular ve ne yapılacağını döndürür.
//   ariza | kontrol | onarim  → yalnızca kayıt, eşleşmeye dokunulmaz
//   sayac_degisimi            → kurulum kapanır, aynı cihaz + YENİ sayaçla açılır
//   esp32_degisimi            → kurulum kapanır, aynı sayaç + YENİ cihazla açılır
//   sokum                     → kurulum kapanır, yenisi açılmaz
//   kurulum                   → burada DEĞİL; /api/registry/installations kullanılır

const SERIAL_MAX = 40;
const SEAL_MAX = 40;
const BRAND_MAX = 60;

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
}
function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

type Effect =
  | { kind: "none" }
  | {
      kind: "swap_meter";
      new_serial: string;
      new_initial_index: number | null;
      new_seal_no: string | null;
      brand: string | null;
      model: string | null;
      pulse_per_unit: number | null;
    }
  | { kind: "swap_device"; new_device_id: string }
  | { kind: "close" };

type Validation = { effect: Effect } | { error: string };

const HANDLERS: Record<
  Exclude<WorkOrderType, "kurulum">,
  (src: Record<string, unknown>) => Validation
> = {
  ariza: () => ({ effect: { kind: "none" } }),
  kontrol: () => ({ effect: { kind: "none" } }),
  onarim: () => ({ effect: { kind: "none" } }),

  sayac_degisimi: (src) => {
    const serial = text(src.new_meter_serial, SERIAL_MAX);
    if (!serial) return { error: "Yeni sayaç seri numarası zorunlu" };
    return {
      effect: {
        kind: "swap_meter",
        new_serial: canonicalizeSerial(serial),
        new_initial_index: num(src.new_initial_index),
        new_seal_no: text(src.new_seal_no, SEAL_MAX),
        brand: text(src.brand, BRAND_MAX),
        model: text(src.model, BRAND_MAX),
        pulse_per_unit: num(src.pulse_per_unit),
      },
    };
  },

  esp32_degisimi: (src) => {
    const mac = text(src.new_mac, 20);
    if (!mac) return { error: "Yeni ESP32 MAC adresi zorunlu" };
    return { effect: { kind: "swap_device", new_device_id: canonicalizeDeviceId(mac) } };
  },

  sokum: () => ({ effect: { kind: "close" } }),
};

interface OpenInstallation {
  id: number;
  meter_id: number;
  device_id: string | null;
  started_at: string;
  serial_no: string;
}

// Yeni sayacı bul ya da oluştur.
async function upsertMeter(
  client: PoolClient,
  e: Extract<Effect, { kind: "swap_meter" }>
): Promise<number> {
  const found = await client.query<{ id: number }>(
    "SELECT id FROM meters WHERE serial_no = $1",
    [e.new_serial]
  );
  if (found.rows[0]) return found.rows[0].id;
  const created = await client.query<{ id: number }>(
    `INSERT INTO meters (serial_no, brand, model, pulse_per_unit)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [e.new_serial, e.brand, e.model, e.pulse_per_unit]
  );
  return created.rows[0].id;
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const pointId = num(body.installation_point_id);
  const typeRaw = text(body.type, 30);
  const performedById = num(body.performed_by_id);
  const performedAtRaw = text(body.performed_at, 40);

  if (pointId === null) {
    return NextResponse.json(
      { success: false, error: "installation_point_id zorunlu" },
      { status: 400 }
    );
  }
  if (performedById === null) {
    return NextResponse.json(
      { success: false, error: "İşlemi yapan kişi seçilmeli" },
      { status: 400 }
    );
  }
  if (!performedAtRaw) {
    return NextResponse.json(
      { success: false, error: "İşlem tarihi zorunlu" },
      { status: 400 }
    );
  }

  if (typeRaw === "kurulum") {
    return NextResponse.json(
      {
        success: false,
        error: "İlk kurulum bu uçtan açılmaz; kurulum kaydı formunu kullanın.",
      },
      { status: 400 }
    );
  }
  if (!typeRaw || !WORK_ORDER_TYPES.includes(typeRaw as WorkOrderType)) {
    return NextResponse.json(
      {
        success: false,
        error: `Geçersiz tip: ${typeRaw}. İzin verilenler: ${Object.keys(HANDLERS).join(", ")}`,
      },
      { status: 400 }
    );
  }
  const type = typeRaw as Exclude<WorkOrderType, "kurulum">;

  const performedAt = new Date(performedAtRaw);
  if (Number.isNaN(performedAt.getTime())) {
    return NextResponse.json(
      { success: false, error: "İşlem tarihi geçersiz" },
      { status: 400 }
    );
  }
  if (performedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { success: false, error: "İşlem tarihi gelecekte olamaz" },
      { status: 400 }
    );
  }

  const validated = HANDLERS[type](body);
  if ("error" in validated) {
    return NextResponse.json(
      { success: false, error: validated.error },
      { status: 400 }
    );
  }
  const effect = validated.effect;
  const ts = performedAt.toISOString();

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Nokta başına serileştirme: iki eşzamanlı değişim isteği birbirini ezmesin.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `reg:${pointId}`,
    ]);

    // Açık kurulumu kilitle. Eşleşmeyi değiştiren tipler için zorunlu.
    const openRes = await client.query<OpenInstallation>(
      `SELECT i.id, i.meter_id, i.device_id, i.started_at, m.serial_no
       FROM installations i
       JOIN meters m ON m.id = i.meter_id
       WHERE i.installation_point_id = $1 AND i.ended_at IS NULL
       FOR UPDATE OF i`,
      [pointId]
    );
    const open = openRes.rows[0] ?? null;

    if (effect.kind !== "none" && !open) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error: "Bu montaj noktasında açık bir kurulum yok; önce kurulum kaydı açın.",
        },
        { status: 409 }
      );
    }

    // Geri tarihli kayıt kontrolü. Açık kurulumdan eski bir tarih, negatif uzunlukta
    // aralık yaratır ve "T anında hangi kurulum aktifti" sorusunu kalıcı olarak
    // cevapsız bırakır. Ev stilinde CHECK constraint yok; tek savunma burası.
    if (open && performedAt.getTime() < new Date(open.started_at).getTime()) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error: `İşlem tarihi mevcut kurulumun başlangıcından (${new Date(
            open.started_at
          ).toLocaleString("tr-TR")}) önce olamaz.`,
        },
        { status: 400 }
      );
    }

    // İş emri. Eski MAC / seri no anlık görüntüleri açık kurulumdan doldurulur.
    const wo = await client.query<{ id: number }>(
      `INSERT INTO work_orders
         (installation_point_id, type, performed_by_id, performed_at,
          reason, work_done, old_meter_serial, new_meter_serial,
          old_mac, new_mac, new_seal_no, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
       RETURNING id`,
      [
        pointId,
        type,
        performedById,
        ts,
        text(body.reason, 2000),
        text(body.work_done, 2000),
        open?.serial_no ?? null,
        effect.kind === "swap_meter" ? effect.new_serial : null,
        open?.device_id ?? null,
        effect.kind === "swap_device" ? effect.new_device_id : null,
        effect.kind === "swap_meter" ? effect.new_seal_no : null,
        text(body.notes, 2000),
      ]
    );
    const workOrderId = wo.rows[0].id;

    let newInstallationId: number | null = null;

    if (effect.kind !== "none" && open) {
      // Eskiyi kapat.
      await client.query(
        `UPDATE installations
         SET ended_at = $2, closed_by_work_order_id = $3
         WHERE id = $1`,
        [open.id, ts, workOrderId]
      );

      if (effect.kind !== "close") {
        // Yeniyi aç. started_at, kapanan satırın ended_at'i ile AYNI değer olmalı;
        // aksi halde aralıkta boşluk kalır ve o boşluk için hangi kurulumun aktif
        // olduğu cevapsız hale gelir.
        let meterId = open.meter_id;
        let deviceId = open.device_id;
        let initialIndex: number | null = null;
        let sealNo: string | null = null;

        if (effect.kind === "swap_meter") {
          meterId = await upsertMeter(client, effect);
          initialIndex = effect.new_initial_index;
          sealNo = effect.new_seal_no;
        } else {
          // swap_device: cihaz kaydı yoksa oluştur (kurulum kaydı provizyon yoludur).
          await client.query(
            "INSERT INTO devices (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING",
            [effect.new_device_id]
          );
          deviceId = effect.new_device_id;
        }

        const created = await client.query<{ id: number }>(
          `INSERT INTO installations
             (installation_point_id, meter_id, device_id, started_at,
              initial_index, seal_no, opened_by_work_order_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id`,
          [pointId, meterId, deviceId, ts, initialIndex, sealNo, workOrderId]
        );
        newInstallationId = created.rows[0].id;
      }
    }

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      work_order_id: workOrderId,
      installation_id: newInstallationId,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      const constraint = String((err as { constraint?: string }).constraint ?? "");
      const msg = constraint.includes("device")
        ? "Bu ESP32 başka bir montaj noktasında açık kurulumda. Önce oradan sökün."
        : constraint.includes("meter")
        ? "Bu sayaç başka bir montaj noktasında açık kurulumda. Önce oradan sökün."
        : "Bu montaj noktasında zaten açık bir kurulum var.";
      return NextResponse.json({ success: false, error: msg }, { status: 409 });
    }

    console.error("POST /api/registry/work-orders hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
