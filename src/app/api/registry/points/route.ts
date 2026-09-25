import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { InstallationPoint } from "@/types";

// PATCH /api/registry/points — montaj noktası bilgilerini düzelt.
// Yalnızca yazım/adres düzeltmesi içindir; geçmişi etkilemez (kurulum ve iş emri
// satırlarına dokunulmaz). SİLME UCU YOK.

const ADDRESS_MAX = 2000;
const FACILITY_MAX = 40;
const LOCATION_MAX = 200;

function text(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
}

export async function PATCH(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const id =
    typeof body.id === "number" && Number.isFinite(body.id) ? body.id : null;
  if (id === null) {
    return NextResponse.json(
      { success: false, error: "id zorunlu" },
      { status: 400 }
    );
  }

  try {
    // COALESCE: gönderilmeyen alan mevcut değerinde kalır.
    const result = await pool.query<InstallationPoint>(
      `UPDATE installation_points
       SET facility_code  = COALESCE($2, facility_code),
           address        = COALESCE($3, address),
           meter_location = COALESCE($4, meter_location),
           notes          = COALESCE($5, notes)
       WHERE id = $1
       RETURNING id, facility_code, address, meter_location, notes, created_at`,
      [
        id,
        text(body.facility_code, FACILITY_MAX),
        text(body.address, ADDRESS_MAX),
        text(body.meter_location, LOCATION_MAX),
        text(body.notes, 2000),
      ]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "Montaj noktası bulunamadı" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, point: result.rows[0] });
  } catch (err) {
    if (typeof err === "object" && err !== null && "code" in err && err.code === "23505") {
      return NextResponse.json(
        { success: false, error: "Bu tesisat ID başka bir noktada kayıtlı." },
        { status: 409 }
      );
    }
    console.error("PATCH /api/registry/points hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
