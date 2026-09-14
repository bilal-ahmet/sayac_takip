import { NextRequest, NextResponse } from "next/server";
import { isApiKeyValid } from "@/lib/auth";
import { applyAck } from "@/lib/ingest";

// POST /api/commands/ack — cihaz, bir komutu uygulayıp uygulamadığını onaylar.
// Gövde: { "Device Id": X, command_id, ok: boolean, error?: string }
// İş mantığı @/lib/ingest içindedir; MQTT ack topic'i de aynı fonksiyonu çağırır.
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

  const result = await applyAck(body);

  if (!result.ok) {
    return result.error === "validation"
      ? NextResponse.json({ success: false, error: result.detail }, { status: 400 })
      : NextResponse.json(
          { success: false, error: "Sunucu hatası" },
          { status: 500 }
        );
  }

  // status="ignored": komut yok ya da zaten kapanmış. Cihaz yeniden denemesin diye
  // hata değil başarı döner (kopya ACK beklenen trafiktir).
  return NextResponse.json({ success: true, status: result.status });
}
