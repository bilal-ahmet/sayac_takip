import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { DeviceWithStats } from "@/types";

// GET /api/devices — tüm cihazları, son okuma zamanı ve okuma sayısı ile listeler.
export async function GET() {
  try {
    const result = await pool.query<DeviceWithStats>(
      `SELECT d.id,
              d.device_id,
              d.name,
              d.created_at,
              MAX(mr.timestamp_unix)        AS last_timestamp_unix,
              COUNT(mr.id)::int             AS reading_count
       FROM devices d
       LEFT JOIN meter_readings mr ON mr.device_id = d.device_id
       GROUP BY d.id, d.device_id, d.name, d.created_at
       ORDER BY last_timestamp_unix DESC NULLS LAST, d.created_at DESC`
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
    // FK kısıtı nedeniyle önce okumalar, sonra cihaz silinir.
    await client.query("DELETE FROM meter_readings WHERE device_id = $1", [
      deviceId,
    ]);
    const result = await client.query(
      "DELETE FROM devices WHERE device_id = $1",
      [deviceId]
    );
    await client.query("COMMIT");
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
