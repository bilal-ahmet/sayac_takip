import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { canonicalizeDeviceId, canonicalizeSerial } from "@/lib/utils";

// POST /api/registry/installations — İLK KURULUM kaydı.
//
// Tek transaction'da: montaj noktası + sayaç (+ gerekirse cihaz) oluşturulur,
// type='kurulum' bir iş emri açılır ve kurulum satırı ona bağlanarak yazılır.
// Sonraki tüm eşleşme değişiklikleri /api/registry/work-orders üzerinden yapılır.
//
// İlk kurulumun da bir iş emri olması, her kurulum satırının "kim, ne zaman, neden
// açtı" bilgisine yapısal olarak sahip olmasını sağlar (opened_by_work_order_id
// NOT NULL). Ayrıca kurulum, iş geçmişi listesinin ilk olayı olarak görünür.

const ADDRESS_MAX = 2000;
const FACILITY_MAX = 40;
const LOCATION_MAX = 200;
const SERIAL_MAX = 40;
const SEAL_MAX = 40;
const BRAND_MAX = 60;

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
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

  const address = text(body.address, ADDRESS_MAX);
  const serialRaw = text(body.serial_no, SERIAL_MAX);
  const deviceRaw = text(body.device_id, 20);
  const performedById = num(body.performed_by_id);
  const performedAtRaw = text(body.performed_at, 40);

  if (!address) {
    return NextResponse.json(
      { success: false, error: "Açık adres zorunlu" },
      { status: 400 }
    );
  }
  if (!serialRaw) {
    return NextResponse.json(
      { success: false, error: "Sayaç seri numarası zorunlu" },
      { status: 400 }
    );
  }
  if (!deviceRaw) {
    return NextResponse.json(
      { success: false, error: "ESP32 MAC adresi zorunlu" },
      { status: 400 }
    );
  }
  if (performedById === null) {
    return NextResponse.json(
      { success: false, error: "Kurulumu yapan kişi seçilmeli" },
      { status: 400 }
    );
  }
  if (!performedAtRaw) {
    return NextResponse.json(
      { success: false, error: "Kurulum tarihi zorunlu" },
      { status: 400 }
    );
  }

  const performedAt = new Date(performedAtRaw);
  if (Number.isNaN(performedAt.getTime())) {
    return NextResponse.json(
      { success: false, error: "Kurulum tarihi geçersiz" },
      { status: 400 }
    );
  }
  // Geleceğe karşı sınır: yanlış yazılmış bir yıl, o güne kadar hiçbir şey yanlış
  // görünmeyen bir kurulum yaratır.
  if (performedAt.getTime() > Date.now() + 24 * 60 * 60 * 1000) {
    return NextResponse.json(
      { success: false, error: "Kurulum tarihi gelecekte olamaz" },
      { status: 400 }
    );
  }

  const serialNo = canonicalizeSerial(serialRaw);
  const deviceId = canonicalizeDeviceId(deviceRaw);
  const facilityCode = text(body.facility_code, FACILITY_MAX);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Montaj noktası: tesisat kodu verilmiş ve kayıtlıysa onu kullan, yoksa yeni aç.
    let pointId: number | null = null;
    if (facilityCode) {
      const existing = await client.query<{ id: number }>(
        "SELECT id FROM installation_points WHERE facility_code = $1",
        [facilityCode]
      );
      pointId = existing.rows[0]?.id ?? null;
    }
    if (pointId === null) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO installation_points (facility_code, address, meter_location, notes)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          facilityCode,
          address,
          text(body.meter_location, LOCATION_MAX),
          text(body.point_notes, 2000),
        ]
      );
      pointId = inserted.rows[0].id;
    }

    // Nokta başına serileştirme (ingest.ts'teki advisory lock deseni; 'reg:' öneki
    // cihaz kilidi ad alanıyla çakışmasın diye).
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `reg:${pointId}`,
    ]);

    // 2) Sayaç: seri no kayıtlıysa onu kullan, yoksa oluştur.
    const meterExisting = await client.query<{ id: number }>(
      "SELECT id FROM meters WHERE serial_no = $1",
      [serialNo]
    );
    let meterId = meterExisting.rows[0]?.id ?? null;
    if (meterId === null) {
      const inserted = await client.query<{ id: number }>(
        `INSERT INTO meters (serial_no, brand, model, pulse_per_unit, tech_label, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          serialNo,
          text(body.brand, BRAND_MAX),
          text(body.model, BRAND_MAX),
          num(body.pulse_per_unit),
          text(body.tech_label, 2000),
          text(body.meter_notes, 2000),
        ]
      );
      meterId = inserted.rows[0].id;
    }

    // 3) Cihaz kaydı yoksa oluştur. MQTT_STRICT_DEVICES=1 iken provizyon yolu budur:
    //    kurulum kaydı açmak cihazı da tanımlar.
    await client.query(
      "INSERT INTO devices (device_id) VALUES ($1) ON CONFLICT (device_id) DO NOTHING",
      [deviceId]
    );

    // 4) Kurulumu açan iş emri.
    const wo = await client.query<{ id: number }>(
      `INSERT INTO work_orders
         (installation_point_id, type, performed_by_id, performed_at,
          reason, work_done, new_meter_serial, new_mac, new_seal_no, notes)
       VALUES ($1, 'kurulum', $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [
        pointId,
        performedById,
        performedAt.toISOString(),
        text(body.reason, 2000),
        text(body.work_done, 2000),
        serialNo,
        deviceId,
        text(body.seal_no, SEAL_MAX),
        text(body.notes, 2000),
      ]
    );

    // 5) Kurulum satırı. started_at = iş emrinin performed_at'i (aynı değer).
    const inst = await client.query<{ id: number }>(
      `INSERT INTO installations
         (installation_point_id, meter_id, device_id, started_at,
          initial_index, seal_no, notes, opened_by_work_order_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [
        pointId,
        meterId,
        deviceId,
        performedAt.toISOString(),
        num(body.initial_index),
        text(body.seal_no, SEAL_MAX),
        text(body.notes, 2000),
        wo.rows[0].id,
      ]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      installation_id: inst.rows[0].id,
      installation_point_id: pointId,
      device_id: deviceId,
    });
  } catch (err) {
    await client.query("ROLLBACK");

    // Kısmi unique indekslerden biri patladı: bu cihaz / sayaç / nokta için zaten
    // açık bir kurulum var. Kullanıcı hatası, sunucu hatası değil.
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      const constraint = String(
        (err as { constraint?: string }).constraint ?? ""
      );
      const msg = constraint.includes("device")
        ? "Bu ESP32 zaten açık bir kurulumda. Önce söküm veya değişim kaydı açın."
        : constraint.includes("meter")
        ? "Bu sayaç zaten açık bir kurulumda. Önce söküm veya değişim kaydı açın."
        : constraint.includes("point")
        ? "Bu montaj noktasında zaten açık bir kurulum var."
        : "Bu kayıt zaten mevcut.";
      return NextResponse.json({ success: false, error: msg }, { status: 409 });
    }

    console.error("POST /api/registry/installations hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
