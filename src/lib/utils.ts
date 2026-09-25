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

// MAC adresini tek biçime indirger: ayraçsız, büyük harf.
// Telemetri "188B0E88947C" gönderir, cihazın yerel ekranı "18:8B:0E:88:94:7C"
// gösterebilir; merkez ikisini aynı kimlik saymalı.
//
// Yalnızca ÜÇ KESİN MAC biçiminden birine uyan girdiler dönüştürülür; uymayan her
// şey trim'lenmiş haliyle aynen döner. Bu bilinçli: "12 hex + isteğe bağlı ayraç"
// gibi gevşek bir kural "18:8B0E-88947C" gibi bozuk girdileri de kabul ederdi, ve
// koşulsuz büyük-harfe-çevirme SMOKE01 / TEST-01 gibi MAC olmayan cihaz id'lerini
// bozardı.
const MAC_FORMATS = [
  /^[0-9A-Fa-f]{12}$/, //                        188B0E88947C
  /^([0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}$/, //  18:8B:0E:88:94:7C · 18-8B-...
  /^([0-9A-Fa-f]{4}\.){2}[0-9A-Fa-f]{4}$/, //    188b.0e88.947c
];

export function canonicalizeDeviceId(raw: string): string {
  const s = raw.trim();
  if (!MAC_FORMATS.some((re) => re.test(s))) return s;
  return s.replace(/[:.-]/g, "").toUpperCase();
}

// Sayaç seri numarasını tek biçime indirger. serial_no UNIQUE olduğu için yazarken
// de ararken de aynı dönüşümden geçmeli, aksi halde "abc123" ile "ABC123" iki ayrı
// sayaç olur.
export function canonicalizeSerial(raw: string): string {
  return raw.trim().toUpperCase();
}

// RSSI (dBm) → insan-okunur sinyal kalitesi etiketi ve renk sınıfı.
// Cihaz signal_quality (0-100) göndermezse RSSI'dan kaba bir etiket türetmek için.
export function rssiQuality(rssi: number | null | undefined): {
  label: string;
  colorClass: string;
} {
  if (rssi == null) return { label: "—", colorClass: "text-zinc-400" };
  if (rssi >= -60) return { label: "Mükemmel", colorClass: "text-emerald-500" };
  if (rssi >= -70) return { label: "İyi", colorClass: "text-emerald-500" };
  if (rssi >= -80) return { label: "Orta", colorClass: "text-amber-500" };
  if (rssi >= -90) return { label: "Zayıf", colorClass: "text-orange-500" };
  return { label: "Çok zayıf", colorClass: "text-red-500" };
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
    "period",
    "threshold_y",
    "mid_y",
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
      r.period,
      r.threshold_y,
      r.mid_y,
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
