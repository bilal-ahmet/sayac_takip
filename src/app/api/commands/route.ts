import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { DeviceCommand, CommandType } from "@/types";

// Dashboard geçmiş görünümünde dönen en fazla komut sayısı (egress tavanı).
const HISTORY_CAP = 500;

// Tip → payload doğrulayıcı. Her doğrulayıcı ham payload'ı alır; geçerliyse
// cihaza kaydedilecek temiz payload'ı döndürür, geçersizse hata mesajı döndürür.
// Böylece her komut tipi kendi sözleşmesini uygular (tek bir ALLOWED_KEYS yerine).
type Validation = { payload: Record<string, number> } | { error: string };

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

const VALIDATORS: Record<CommandType, (src: Record<string, unknown>) => Validation> = {
  // Kalibrasyon: cihaza süre (period, saniye) verilir; threshold/mid'i cihaz çıkarır.
  calibration: (src) => {
    const period = num(src.period);
    if (period === null || period < 0) {
      return { error: "period sayı ve >= 0 olmalı" };
    }
    return { payload: { period } };
  },
  // Sıfırlama komutları payload taşımaz; cihaz tipe bakıp register'ı 0'a çeker.
  reset_counter: () => ({ payload: {} }),
  reset_devir: () => ({ payload: {} }),
  // Set komutları hedef değeri taşır; cihaz register'ı value'ya yazar.
  set_counter: (src) => {
    const value = num(src.value);
    if (value === null || value < 0) {
      return { error: "value sayı ve >= 0 olmalı" };
    }
    return { payload: { value } };
  },
  set_devir: (src) => {
    const value = num(src.value);
    if (value === null || value < 0) {
      return { error: "value sayı ve >= 0 olmalı" };
    }
    return { payload: { value } };
  },
};

// GET /api/commands?device_id=X
//   - Varsayılan (cihaz poll'ü): status IN ('pending','delivered') olan komutlar
//     döner. Dönen 'pending' komutlar 'delivered'a geçirilir (delivered_at damgalanır)
//     ama ACK gelene kadar dönmeye devam eder → at-least-once teslim.
//   - all=1 (dashboard geçmişi): tüm statüler döner, hiçbir şey 'delivered' yapılmaz.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const deviceId = params.get("device_id");
  const all = params.get("all") === "1";

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  if (all) {
    // Dashboard geçmişi: salt okuma, yan etki yok.
    try {
      const result = await pool.query<DeviceCommand>(
        `SELECT id, device_id, type, payload, status, error,
                created_at, delivered_at, applied_at
         FROM device_commands
         WHERE device_id = $1
         ORDER BY created_at DESC, id DESC
         LIMIT ${HISTORY_CAP}`,
        [deviceId]
      );
      return NextResponse.json({ success: true, commands: result.rows });
    } catch (err) {
      console.error("GET /api/commands (all) hata:", err);
      return NextResponse.json(
        { success: false, error: "Sunucu hatası" },
        { status: 500 }
      );
    }
  }

  // Cihaz poll'ü: bekleyenleri al, pending olanları delivered yap, hepsini döndür.
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<DeviceCommand>(
      `SELECT id, device_id, type, payload, status, error,
              created_at, delivered_at, applied_at
       FROM device_commands
       WHERE device_id = $1 AND status IN ('pending', 'delivered')
       ORDER BY created_at ASC, id ASC
       FOR UPDATE`,
      [deviceId]
    );

    const pendingIds = result.rows
      .filter((c) => c.status === "pending")
      .map((c) => c.id);
    if (pendingIds.length > 0) {
      await client.query(
        `UPDATE device_commands
         SET status = 'delivered', delivered_at = NOW()
         WHERE id = ANY($1::int[])`,
        [pendingIds]
      );
    }

    await client.query("COMMIT");

    // Yanıtta delivered durumunu yansıt (DB'de güncellendi).
    const commands = result.rows.map((c) =>
      c.status === "pending" ? { ...c, status: "delivered" as const } : c
    );
    return NextResponse.json({ success: true, commands });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("GET /api/commands hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}

// POST /api/commands — dashboard'dan kalibrasyon komutu oluştur (enqueue).
// Gövde: { device_id, type?, payload: { "Threshold y": n, "Mid y": n } }
// Aynı cihaz için bekleyen (pending/delivered) eski komutlar 'cancelled' yapılır;
// böylece cihaz her zaman tek güncel hedefi alır.
export async function POST(request: NextRequest) {
  let body: {
    device_id?: string;
    "Device Id"?: string;
    type?: string;
    payload?: Record<string, unknown>;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const raw = body.device_id ?? body["Device Id"];
  const deviceId = typeof raw === "string" ? raw.trim() : undefined;
  const type =
    typeof body.type === "string" && body.type.trim() !== ""
      ? body.type.trim()
      : "calibration";

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  // Tip whitelist: yalnızca tanımlı komut tipleri kabul edilir.
  const validator = VALIDATORS[type as CommandType];
  if (!validator) {
    return NextResponse.json(
      {
        success: false,
        error: `Geçersiz tip: ${type}. İzin verilenler: ${Object.keys(VALIDATORS).join(", ")}`,
      },
      { status: 400 }
    );
  }

  // Payload'ı tipe göre doğrula ve temizle.
  const result = validator(body.payload ?? {});
  if ("error" in result) {
    return NextResponse.json(
      { success: false, error: result.error },
      { status: 400 }
    );
  }
  const payload = result.payload;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Cihaz var mı? (FK de korur ama net hata mesajı için önden kontrol.)
    const dev = await client.query(
      "SELECT 1 FROM devices WHERE device_id = $1",
      [deviceId]
    );
    if (dev.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        { success: false, error: "Cihaz bulunamadı" },
        { status: 404 }
      );
    }

    // Aynı tipteki bekleyen eski komutları iptal et (her tipin tek güncel hedefi).
    // Farklı tipler (ör. bekleyen bir calibration) etkilenmez; böylece bir
    // set_counter göndermek kalibrasyonu geçersiz kılmaz.
    await client.query(
      `UPDATE device_commands
       SET status = 'cancelled'
       WHERE device_id = $1 AND type = $2 AND status IN ('pending', 'delivered')`,
      [deviceId, type]
    );

    const inserted = await client.query<DeviceCommand>(
      `INSERT INTO device_commands (device_id, type, payload)
       VALUES ($1, $2, $3)
       RETURNING id, device_id, type, payload, status, error,
                 created_at, delivered_at, applied_at`,
      [deviceId, type, JSON.stringify(payload)]
    );

    await client.query("COMMIT");
    return NextResponse.json({ success: true, command: inserted.rows[0] });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/commands hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
