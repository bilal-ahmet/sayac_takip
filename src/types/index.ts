// IoT cihazdan gelen ham POST gövdesi.
// "Device Id" boşluklu alan; devir/baslangic da cihazdan ham gelir.
export interface IncomingReading {
  "Device Id"?: string;
  device_id?: string;
  fw_version?: string; // cihaz firmware sürümü (cihaz başına sabit, okuma başına değil)
  timestamp: number; // unix saniye
  sayac: number;
  devir: number;
  baslangic: number;
  toplam?: number; // cihazın hesapladığı toplam (opsiyonel)
  time_synced?: number | boolean; // cihaz saati NTP ile çekebildi mi? 1/true=evet, 0/false=hayır
}

// devices tablosu satırı
export interface Device {
  id: number;
  device_id: string;
  name: string | null;
  fw_version: string | null; // en son POST'ta bildirilen firmware sürümü
  created_at: string; // ISO timestamptz
}

// /api/devices yanıtı: cihaz + son okuma özeti
export interface DeviceWithStats extends Device {
  last_timestamp_unix: number | null;
  reading_count: number;
}

// meter_readings tablosu satırı
export interface MeterReading {
  id: number;
  device_id: string;
  timestamp_unix: number;
  recorded_at: string; // ISO timestamptz
  sayac: number;
  devir: number;
  baslangic: number;
  toplam: number | null;
  sayac_delta: number | null;
  devir_delta: number | null;
  // Cihaz saati senkron muydu? false ise timestamp_unix sunucu saatiyle ikame
  // edilmiştir (cihaz timestamp=0 gönderdi). Dashboard'da rozetle işaretlenir.
  time_synced: boolean;
  // Bir önceki (kronolojik) okumaya göre saniye farkı. Sunucuda LAG ile hesaplanır.
  // En eski satırda (öncesi yok) null gelir. Kopma tespitinde kullanılır.
  gap_sec?: number | null;
}

// Ardışık iki okuma arasındaki, timeout'u aşan zaman boşluğu (kopma).
export interface Gap {
  toId: number; // boşluktan SONRA gelen (daha yeni) okumanın id'si
  fromTs: number; // önceki (eski) okumanın unix'i
  toTs: number; // sonraki (yeni) okumanın unix'i
  gapSeconds: number; // aradaki saniye farkı
}

// POST /api/readings başarılı yanıtı
export interface ReadingResult {
  success: boolean;
  id: number;
  sayac_delta: number | null;
  devir_delta: number | null;
}
