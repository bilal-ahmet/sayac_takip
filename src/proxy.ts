import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Dashboard için HTTP Basic auth.
//
// Next 16'da bu dosya eskiden middleware.ts idi; isim proxy'ye taşındı (named
// export da `proxy`). Runtime nodejs'tir ve değiştirilemez.
//
// Neden gerekli: DELETE /api/readings, DELETE /api/devices ve POST /api/commands
// hiçbir kimlik doğrulaması taşımıyordu. Komut uçları artık reset_counter /
// set_counter gibi FİZİKSEL cihaz register'ını değiştiren tipleri kabul ettiği
// için açık bir uç, veri kaybından öte sahadaki sayacı bozabilir.

// Cihaz-facing uçlar muaf: cihazlar Basic auth konuşmuyor, kendi x-api-key'lerini
// kullanıyor. Faz 6'da bunlar MQTT'ye taşınıp tamamen kalkacak ve bu liste boşalacak.
function isDeviceRequest(request: NextRequest): boolean {
  const { pathname, searchParams } = request.nextUrl;

  if (request.method === "POST") {
    if (
      pathname === "/api/readings" ||
      pathname === "/api/commands/ack" ||
      pathname === "/api/devices/health"
    ) {
      return true;
    }
  }

  // Cihazın komut poll'ü. all=1 dashboard geçmişidir ve korunur.
  if (
    request.method === "GET" &&
    pathname === "/api/commands" &&
    searchParams.get("all") !== "1"
  ) {
    return true;
  }

  return false;
}

// Sabit zamanlı karşılaştırma: erken dönen bir eşitlik kontrolü şifreyi karakter
// karakter tahmin etmeye açık bırakır. Uzunluk farkı sızar, o kabul edilebilir.
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function unauthorized(message: string): NextResponse {
  return new NextResponse(message, {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Sayac Takip", charset="UTF-8"',
    },
  });
}

export function proxy(request: NextRequest): NextResponse {
  // Harici uptime kontrolü kimlik taşıyamaz; sağlık ucu açık kalır.
  if (request.nextUrl.pathname === "/api/health") return NextResponse.next();
  if (isDeviceRequest(request)) return NextResponse.next();

  const user = process.env.DASHBOARD_USER;
  const pass = process.env.DASHBOARD_PASSWORD;

  if (!user || !pass) {
    // Geliştirmede auth'u kapalı tut (lokalde sürekli şifre sormasın).
    if (process.env.NODE_ENV !== "production") return NextResponse.next();
    // Üretimde AÇIK KAPI BIRAKMA. Değişkenler eksikse siteyi kapat; sessizce
    // korumasız çalışmaktansa net bir hata vermek daha güvenli.
    return new NextResponse(
      "Yapılandırma eksik: DASHBOARD_USER ve DASHBOARD_PASSWORD tanımlanmalı.",
      { status: 503 }
    );
  }

  const header = request.headers.get("authorization");
  if (!header || !header.startsWith("Basic ")) {
    return unauthorized("Kimlik doğrulama gerekli");
  }

  let decoded: string;
  try {
    decoded = atob(header.slice(6));
  } catch {
    return unauthorized("Geçersiz kimlik bilgisi");
  }

  const sep = decoded.indexOf(":");
  const providedUser = sep === -1 ? decoded : decoded.slice(0, sep);
  const providedPass = sep === -1 ? "" : decoded.slice(sep + 1);

  // Her iki karşılaştırma da koşulsuz çalışsın (erken çıkış zamanlama sızdırır).
  const okUser = safeEqual(providedUser, user);
  const okPass = safeEqual(providedPass, pass);
  if (!okUser || !okPass) {
    return unauthorized("Kimlik doğrulama başarısız");
  }

  return NextResponse.next();
}

// matcher verilmezse proxy _next/static ve public/ dahil HER isteğe çalışır ve
// CSS/JS/görsellerin yüklenmesini engeller.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
