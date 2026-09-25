import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { canonicalizeDeviceId, canonicalizeSerial } from "@/lib/utils";
import type { RegistrySearchResult } from "@/types";

// GET /api/registry/search?q=...
// MAC veya sayaç seri numarasıyla arama.
//
// MAC tarafı: sorgu kanoniklestirilir, yani "18:8B:0E:88:94:7C" ile "188b0e88947c"
// aynı cihazı bulur. Tam eşleşme (MAC'in bir kısmını aramak anlamsız).
//
// Seri no tarafı: upper(trim()) + ÖNEK araması. Bilerek "%...%" değil — serial_no
// üzerindeki unique indeks yalnızca önek aramasında kullanılabilir.

const RESULT_CAP = 50;

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("q");
  const q = raw?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json(
      { success: false, error: "En az 2 karakter girin" },
      { status: 400 }
    );
  }

  const asDevice = canonicalizeDeviceId(q);
  const asSerial = canonicalizeSerial(q);

  try {
    const [installations, devices] = await Promise.all([
      pool.query<RegistrySearchResult>(
        `SELECT i.id AS installation_id,
                i.installation_point_id,
                ip.facility_code,
                ip.address,
                ip.meter_location,
                i.device_id,
                m.serial_no,
                i.started_at,
                i.ended_at,
                (i.ended_at IS NULL) AS active
         FROM installations i
         JOIN installation_points ip ON ip.id = i.installation_point_id
         JOIN meters m               ON m.id  = i.meter_id
         WHERE i.device_id = $1
            OR m.serial_no LIKE $2 || '%'
         ORDER BY (i.ended_at IS NULL) DESC, i.started_at DESC, i.id DESC
         LIMIT ${RESULT_CAP}`,
        [asDevice, asSerial]
      ),
      // Kayıtlı ama hiç kurulmamış cihazlar — arama sonucu boş görünmesin.
      pool.query<{ device_id: string; name: string | null }>(
        `SELECT d.device_id, d.name
         FROM devices d
         WHERE d.device_id = $1
           AND NOT EXISTS (SELECT 1 FROM installations i WHERE i.device_id = d.device_id)
         LIMIT 10`,
        [asDevice]
      ),
    ]);

    return NextResponse.json({
      success: true,
      results: installations.rows,
      devices: devices.rows,
    });
  } catch (err) {
    console.error("GET /api/registry/search hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
