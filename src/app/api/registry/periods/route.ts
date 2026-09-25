import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { canonicalizeDeviceId } from "@/lib/utils";
import type { InstallationPeriod } from "@/types";

// GET /api/registry/periods?device_id=...
// Bu CİHAZIN kurulum dönemleri — grafikteki sınır çizgileri ve okumaların hangi
// sayaca ait olduğunun belirlenmesi için.
//
// /api/registry'den ayrı bir uç olmasının sebebi: orası montaj NOKTASININ tüm
// geçmişini döndürür (ESP32 değişiminden sonra başka cihazların dönemleri dahil).
// Burada yalnızca bu cihazın takılı olduğu aralıklar lazım ve yük mümkün olduğunca
// küçük tutuluyor — okuma paneli her cihaz değişiminde bunu çekiyor.
export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("device_id");
  if (!raw) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query<InstallationPeriod>(
      `SELECT i.id AS installation_id, i.started_at, i.ended_at, m.serial_no
       FROM installations i
       JOIN meters m ON m.id = i.meter_id
       WHERE i.device_id = $1
       ORDER BY i.started_at ASC, i.id ASC`,
      [canonicalizeDeviceId(raw)]
    );
    return NextResponse.json({ success: true, periods: result.rows });
  } catch (err) {
    console.error("GET /api/registry/periods hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
