import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isApiKeyValid } from "@/lib/auth";

// POST /api/commands/ack — cihaz, bir komutu uygulayıp uygulamadığını onaylar.
// Gövde: { "Device Id": X, command_id, ok: boolean, error?: string }
//   ok=true  → status='applied', applied_at=NOW()
//   ok=false → status='failed', error=<cihaz mesajı>
// Cihaz yalnızca kendi (device_id eşleşen) komutunu kapatabilir.
export async function POST(request: NextRequest) {
  // Cihaz-yazan uç: API_SECRET_KEY tanımlıysa x-api-key doğrulanır.
  if (!isApiKeyValid(request)) {
    return NextResponse.json(
      { success: false, error: "Yetkisiz" },
      { status: 401 }
    );
  }

  let body: {
    device_id?: string;
    "Device Id"?: string;
    command_id?: number;
    ok?: boolean;
    error?: string;
  };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const raw = body.device_id ?? body["Device Id"];
  const deviceId = typeof raw === "string" ? raw.trim() : undefined;
  const commandId = body.command_id;
  const ok = body.ok;

  if (!deviceId || typeof commandId !== "number" || typeof ok !== "boolean") {
    return NextResponse.json(
      {
        success: false,
        error: "Device Id, command_id (sayı) ve ok (boolean) zorunlu",
      },
      { status: 400 }
    );
  }

  const errorMsg =
    !ok && typeof body.error === "string" ? body.error.slice(0, 1000) : null;
  const newStatus = ok ? "applied" : "failed";

  try {
    const result = await pool.query<{ status: string }>(
      `UPDATE device_commands
       SET status = $1,
           applied_at = CASE WHEN $1 = 'applied' THEN NOW() ELSE applied_at END,
           error = $2
       WHERE id = $3 AND device_id = $4
       RETURNING status`,
      [newStatus, errorMsg, commandId, deviceId]
    );

    if (result.rowCount === 0) {
      return NextResponse.json(
        { success: false, error: "Komut bulunamadı" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, status: result.rows[0].status });
  } catch (err) {
    console.error("POST /api/commands/ack hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
