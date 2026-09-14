import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isApiKeyValid } from "@/lib/auth";
import { ingestHealth } from "@/lib/ingest";
import type { DeviceHealth } from "@/types";

// GET'te dönen en fazla geçmiş satırı (trend grafiği + egress tavanı).
const HISTORY_LIMIT = 200;
// Bağlantı durumu penceresi: son görülme bundan yeniyse cihaz "online" sayılır.
// Cihazın sağlık/okuma bildirim periyoduna göre ayarlanabilir.
const ONLINE_WINDOW_SEC = 120;

// POST /api/devices/health — cihaz periyodik sağlık verisi bildirir.
// Gövde: { "Device Id"|device_id, uptime_sec?, rssi?, signal_quality?, error? }
// Bilinmeyen cihaz otomatik oluşturulur (readings ile aynı davranış).
export async function POST(request: NextRequest) {
  // Cihaz-yazan uç: API_SECRET_KEY tanımlıysa x-api-key doğrulanır.
  if (!isApiKeyValid(request)) {
    return NextResponse.json(
      { success: false, error: "Yetkisiz" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const result = await ingestHealth(body);

  if (!result.ok) {
    return result.error === "validation"
      ? NextResponse.json({ success: false, error: result.detail }, { status: 400 })
      : NextResponse.json(
          { success: false, error: "Sunucu hatası" },
          { status: 500 }
        );
  }

  return NextResponse.json({ success: true });
}

// GET /api/devices/health?device_id=X — dashboard için sağlık okuması (salt okuma).
// Döner: { success, latest, history (en yeni önce), online, last_seen_unix }.
export async function GET(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("device_id");
  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  try {
    // Son N sağlık satırı (en yeni önce); latest = ilk satır.
    const health = await pool.query<DeviceHealth>(
      `SELECT id, device_id, reported_at, uptime_sec, rssi, signal_quality, error
       FROM device_health
       WHERE device_id = $1
       ORDER BY reported_at DESC, id DESC
       LIMIT ${HISTORY_LIMIT}`,
      [deviceId]
    );

    // Son görülme: son okuma zamanı ile son sağlık raporu zamanının büyük olanı.
    const seen = await pool.query<{
      last_reading_unix: number | null;
      last_health_unix: number | null;
    }>(
      `SELECT
         (SELECT MAX(timestamp_unix) FROM meter_readings WHERE device_id = $1)
           AS last_reading_unix,
         (SELECT EXTRACT(EPOCH FROM MAX(reported_at))::bigint
          FROM device_health WHERE device_id = $1)
           AS last_health_unix`,
      [deviceId]
    );

    const { last_reading_unix, last_health_unix } = seen.rows[0];
    const candidates = [last_reading_unix, last_health_unix].filter(
      (v): v is number => v != null
    );
    const lastSeen = candidates.length > 0 ? Math.max(...candidates) : null;
    const nowUnix = Math.floor(Date.now() / 1000);
    const online = lastSeen != null && nowUnix - lastSeen <= ONLINE_WINDOW_SEC;

    return NextResponse.json({
      success: true,
      latest: health.rows[0] ?? null,
      history: health.rows,
      online,
      last_seen_unix: lastSeen,
    });
  } catch (err) {
    console.error("GET /api/devices/health hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
