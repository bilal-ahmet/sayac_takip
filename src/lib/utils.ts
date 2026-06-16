import type { IncomingReading } from "@/types";

// Unix timestamp (saniye) → Türkiye saati (Europe/Istanbul), tr-TR biçimi.
export function formatTimestamp(unix: number): string {
  return new Date(unix * 1000).toLocaleString("tr-TR", {
    timeZone: "Europe/Istanbul",
  });
}

// Delta değerine göre Tailwind renk sınıfı: pozitif yeşil, negatif kırmızı, 0/null nötr.
export function deltaColorClass(delta: number | null | undefined): string {
  if (delta == null || delta === 0) return "text-zinc-400";
  return delta > 0 ? "text-emerald-500" : "text-red-500";
}

// Okunabilir delta gösterimi (+5 / -3 / —).
export function formatDelta(delta: number | null | undefined): string {
  if (delta == null) return "—";
  return delta > 0 ? `+${delta}` : `${delta}`;
}

// Gelen gövdeden device_id'yi normalize et: "Device Id" (boşluklu) veya device_id.
export function normalizeDeviceId(
  body: IncomingReading
): string | undefined {
  const raw = body["Device Id"] ?? body.device_id;
  return typeof raw === "string" ? raw.trim() : undefined;
}
