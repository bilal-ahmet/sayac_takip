import type { NextRequest } from "next/server";

// Cihaz-yazan uçlar için opsiyonel güvenlik anahtarı kontrolü.
// API_SECRET_KEY tanımlı değilse auth kapalıdır (true döner).
// Tanımlıysa istek "x-api-key" başlığında doğru anahtarı taşımalıdır.
export function isApiKeyValid(request: NextRequest): boolean {
  const secret = process.env.API_SECRET_KEY;
  if (!secret) return true;
  return request.headers.get("x-api-key") === secret;
}
