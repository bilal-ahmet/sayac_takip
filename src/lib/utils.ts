import type { IncomingReading, MeterReading, Gap } from "@/types";

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

// Saniyeyi okunabilir süreye çevir: "2 sa 5 dk", "3 dk 20 sn", "45 sn".
export function formatDuration(seconds: number): string {
  const s = Math.abs(Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h} sa`);
  if (m > 0) parts.push(`${m} dk`);
  if (sec > 0 && h === 0) parts.push(`${sec} sn`);
  return parts.length > 0 ? parts.join(" ") : "0 sn";
}

// timeoutSec'i aşan boşlukları bul. Boşluk bilgisi sunucudan gelen gap_sec
// alanından okunur (LAG ile hesaplanır): gap_sec = bu okumanın bir önceki
// kronolojik okumaya saniye uzaklığı. En eski satırda gap_sec null'dur.
export function computeGaps(
  readings: MeterReading[],
  timeoutSec: number
): Gap[] {
  if (!timeoutSec || timeoutSec <= 0) return [];
  const gaps: Gap[] = [];
  for (const r of readings) {
    const gapSeconds = r.gap_sec;
    if (gapSeconds != null && gapSeconds > timeoutSec) {
      gaps.push({
        toId: r.id,
        fromTs: r.timestamp_unix - gapSeconds,
        toTs: r.timestamp_unix,
        gapSeconds,
      });
    }
  }
  return gaps;
}

// Okumaları CSV string'e çevir (başlık + satırlar).
export function readingsToCSV(readings: MeterReading[]): string {
  const headers = [
    "Zaman",
    "timestamp_unix",
    "sayac",
    "devir",
    "baslangic",
    "toplam",
    "sayac_delta",
    "devir_delta",
    "time_synced",
  ];
  // Türkçe yerel ayarlı Excel sütun ayırıcı olarak noktalı virgül bekler.
  const SEP = ";";
  const escape = (v: string | number | null): string => {
    const s = v == null ? "" : String(v);
    // Ayırıcı, çift tırnak veya yeni satır içeriyorsa tırnakla.
    return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = readings.map((r) =>
    [
      formatTimestamp(r.timestamp_unix),
      r.timestamp_unix,
      r.sayac,
      r.devir,
      r.baslangic,
      r.toplam,
      r.sayac_delta,
      r.devir_delta,
      r.time_synced === false ? 0 : 1,
    ]
      .map(escape)
      .join(SEP)
  );
  // "sep=;" satırı, Excel'in ayırıcıyı otomatik tanımasını sağlar.
  return [`sep=${SEP}`, headers.join(SEP), ...lines].join("\n");
}

// CSV string'i tarayıcıda indir. Excel'de Türkçe için UTF-8 BOM eklenir.
export function downloadCSV(filename: string, csv: string): void {
  const blob = new Blob(["﻿" + csv], {
    type: "text/csv;charset=utf-8;",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
