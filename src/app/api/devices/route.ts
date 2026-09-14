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
