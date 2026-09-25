import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { clearDeviceTopics } from "@/lib/mqtt";
import type { DeviceWithStats } from "@/types";

// GET /api/devices — tüm cihazları, son okuma zamanı ve okuma sayısı ile listeler.
export async function GET() {
  try {
    // Sayaçlar devices üzerinde tutulur (ingest sırasında güncellenir). Eskiden
    // burada meter_readings ile LEFT JOIN + COUNT() vardı; 5 saniyede bir milyonlarca
    // satırı taramak sürdürülebilir değil.
    const result = await pool.query<DeviceWithStats>(
      `SELECT id, device_id, name, fw_version, created_at,
              last_timestamp_unix, reading_count, online, last_seen_at
       FROM devices
       ORDER BY last_timestamp_unix DESC NULLS LAST, created_at DESC`
    );

    return NextResponse.json({ success: true, devices: result.rows });
  } catch (err) {
    console.error("GET /api/devices hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}

// device_id VARCHAR(20); cihazın gönderdiği "Device Id" ile BİREBİR eşleşmeli.
const DEVICE_ID_RE = /^[A-Za-z0-9:_-]{1,20}$/;
// name VARCHAR(100)
const NAME_MAX = 100;

function parseName(v: unknown): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, NAME_MAX) : null;
}

// POST /api/devices — arayüzden cihaz oluştur.
// Gövde: { device_id, name? }
// Cihazlar okuma geldiğinde de otomatik oluşur; bu uç, cihazı önceden tanımlayıp
// isim vermek için. MQTT_STRICT_DEVICES=1 iken otomatik oluşturma kapanır ve
// provizyon yalnızca buradan yapılır.
export async function POST(request: NextRequest) {
  let body: { device_id?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const raw = body.device_id;
  const deviceId = typeof raw === "string" ? raw.trim() : "";
  if (!DEVICE_ID_RE.test(deviceId)) {
    return NextResponse.json(
      {
        success: false,
        error:
          "device_id 1-20 karakter olmalı ve yalnızca harf, rakam, : _ - içerebilir",
      },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query<{ device_id: string }>(
      `INSERT INTO devices (device_id, name) VALUES ($1, $2)
       ON CONFLICT (device_id) DO NOTHING
       RETURNING device_id`,
      [deviceId, parseName(body.name)]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: `Bu cihaz zaten kayıtlı: ${deviceId}` },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, device_id: deviceId });
  } catch (err) {
    console.error("POST /api/devices hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}

// PATCH /api/devices — cihazın görünen adını değiştir.
// Gövde: { device_id, name }  (name boş/null → isim kaldırılır)
export async function PATCH(request: NextRequest) {
  let body: { device_id?: unknown; name?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const raw = body.device_id;
  const deviceId = typeof raw === "string" ? raw.trim() : "";
  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query(
      `UPDATE devices SET name = $2 WHERE device_id = $1`,
      [deviceId, parseName(body.name)]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "Cihaz bulunamadı" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("PATCH /api/devices hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}

// DELETE /api/devices?device_id=... — cihazı ve tüm okumalarını siler.
export async function DELETE(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Kurulum geçmişi olan cihaz SİLİNMEZ. installations satırları korunması istenen
    // geçmişin ta kendisi; onları silmek adresin zaman çizelgesini yok eder ve
    // iş emirlerini yetim bırakırdı. Cihaz sahadan çıktıysa doğru yol söküm /
    // ESP32 değişimi kaydı açmaktır.
    const installed = await client.query(
      "SELECT 1 FROM installations WHERE device_id = $1 LIMIT 1",
      [deviceId]
    );
    if (installed.rowCount && installed.rowCount > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json(
        {
          success: false,
          error:
            "Bu cihazın kurulum geçmişi var ve silinemez. Cihaz sahadan çıktıysa 'ESP32 değişimi' ya da 'söküm' kaydı açın.",
        },
        { status: 409 }
      );
    }

    // FK kısıtı nedeniyle önce çocuk tablolar, sonra cihaz silinir.
    // device_commands da devices'a FK ile bağlı: atlanırsa komut geçmişi olan
    // bir cihaz hiç silinemez (FK ihlali → 500).
    await client.query("DELETE FROM meter_readings WHERE device_id = $1", [
      deviceId,
    ]);
    await client.query("DELETE FROM device_commands WHERE device_id = $1", [
      deviceId,
    ]);
    await client.query("DELETE FROM device_health WHERE device_id = $1", [
      deviceId,
    ]);
    const result = await client.query(
      "DELETE FROM devices WHERE device_id = $1",
      [deviceId]
    );
    await client.query("COMMIT");

    // Brokerdaki retained izleri de temizle; aksi halde aynı MAC'le gelen yeni bir
    // cihaz ilk bağlantısında eski kalibrasyon komutunu alır.
    try {
      await clearDeviceTopics(deviceId);
    } catch (err) {
      console.error("Retained topic'ler temizlenemedi:", err);
    }

    return NextResponse.json({ success: true, deleted: result.rowCount });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/devices hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
