import { NextResponse } from "next/server";
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
