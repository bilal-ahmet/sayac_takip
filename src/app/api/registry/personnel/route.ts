import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import type { Person } from "@/types";

// Personel — iş emirlerinde "işi yapan kişi" olarak seçilir.
// Sistemde kullanıcı kimliği yok (tek ortak Basic auth şifresi), o yüzden kişi ayrı
// bir referans tablosundan gelir. SİLME UCU YOK: personel pasife alınır, böylece
// iş emirlerindeki FK kırılmaz ve geçmiş kaybolmaz.

const NAME_MAX = 100;
const ROLE_MAX = 60;
const PHONE_MAX = 30;

function trimOrNull(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim() !== "" ? v.trim().slice(0, max) : null;
}

// GET /api/registry/personnel[?all=1]
// Varsayılan yalnızca aktifleri döner (açılır liste için); all=1 pasifleri de içerir.
export async function GET(request: NextRequest) {
  const all = request.nextUrl.searchParams.get("all") === "1";

  try {
    const result = await pool.query<Person>(
      `SELECT id, full_name, role, phone, active, created_at
       FROM personnel
       ${all ? "" : "WHERE active"}
       ORDER BY active DESC, full_name ASC`
    );
    return NextResponse.json({ success: true, personnel: result.rows });
  } catch (err) {
    console.error("GET /api/registry/personnel hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}

// POST /api/registry/personnel — { full_name, role?, phone? }
export async function POST(request: NextRequest) {
  let body: { full_name?: unknown; role?: unknown; phone?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const fullName = trimOrNull(body.full_name, NAME_MAX);
  if (!fullName) {
    return NextResponse.json(
      { success: false, error: "Ad soyad zorunlu" },
      { status: 400 }
    );
  }

  try {
    const result = await pool.query<Person>(
      `INSERT INTO personnel (full_name, role, phone) VALUES ($1, $2, $3)
       ON CONFLICT (full_name) DO NOTHING
       RETURNING id, full_name, role, phone, active, created_at`,
      [fullName, trimOrNull(body.role, ROLE_MAX), trimOrNull(body.phone, PHONE_MAX)]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: `Bu kişi zaten kayıtlı: ${fullName}` },
        { status: 409 }
      );
    }

    return NextResponse.json({ success: true, person: result.rows[0] });
  } catch (err) {
    console.error("POST /api/registry/personnel hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}

// PATCH /api/registry/personnel — { id, full_name?, role?, phone?, active? }
// Pasife alma da buradan: { id, active: false }.
export async function PATCH(request: NextRequest) {
  let body: {
    id?: unknown;
    full_name?: unknown;
    role?: unknown;
    phone?: unknown;
    active?: unknown;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const id = typeof body.id === "number" && Number.isFinite(body.id) ? body.id : null;
  if (id === null) {
    return NextResponse.json(
      { success: false, error: "id zorunlu" },
      { status: 400 }
    );
  }

  // COALESCE: gönderilmeyen alan mevcut değerinde kalır.
  const fullName = trimOrNull(body.full_name, NAME_MAX);
  const active = typeof body.active === "boolean" ? body.active : null;

  try {
    const result = await pool.query<Person>(
      `UPDATE personnel
       SET full_name = COALESCE($2, full_name),
           role      = COALESCE($3, role),
           phone     = COALESCE($4, phone),
           active    = COALESCE($5, active)
       WHERE id = $1
       RETURNING id, full_name, role, phone, active, created_at`,
      [
        id,
        fullName,
        trimOrNull(body.role, ROLE_MAX),
        trimOrNull(body.phone, PHONE_MAX),
        active,
      ]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "Kişi bulunamadı" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, person: result.rows[0] });
  } catch (err) {
    console.error("PATCH /api/registry/personnel hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
