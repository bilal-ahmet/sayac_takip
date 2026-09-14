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
  period?: number; // cihazın bildirdiği geçen süre (saniye, opsiyonel)
  // Cihazın, sunucudan aldığı süreden (period komutu) türetip uyguladığı güncel
  // kalibrasyon değerleri. Cihaz bunları okuma paketinde geri bildirir (opsiyonel).
  "Threshold y"?: number;
  "Mid y"?: number;
  time_synced?: number | boolean; // cihaz saati NTP ile çekebildi mi? 1/true=evet, 0/false=hayır
  // Cihaz başına monotonik artan mesaj sayacı (opsiyonel). MQTT QoS 1 en-az-bir-kez
  // teslim ettiği için kopya okumaları ayırt etmekte kullanılır. Yoksa dedup kapalıdır.
  msg_id?: number;
}

// devices tablosu satırı
export interface Device {
  id: number;
  device_id: string;
  name: string | null;
  fw_version: string | null; // en son bildirilen firmware sürümü
  created_at: string; // ISO timestamptz
  // MQTT presence: cihazın birth mesajı/LWT'sinden yazılır. MQTT'ye geçmemiş
  // cihazlarda daima false kalır.
  online: boolean;
  last_seen_at: string | null; // ISO timestamptz
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
  period: number | null; // cihazın bildirdiği geçen süre (saniye, yoksa null)
  threshold_y: number | null; // cihazın süreden türetip bildirdiği güncel Threshold y (yoksa null)
  mid_y: number | null; // cihazın süreden türetip bildirdiği güncel Mid y (yoksa null)
  sayac_delta: number | null;
  devir_delta: number | null;
  // Bu okumanın alındığı sırada cihazın bildirdiği firmware sürümü (yoksa null).
  // Okuma başına tutulur; grafik/tablo versiyona göre süzülebilsin diye.
  fw_version: string | null;
  // Cihaz saati senkron muydu? false ise timestamp_unix sunucu saatiyle ikame
  // edilmiştir (cihaz timestamp=0 gönderdi). Dashboard'da rozetle işaretlenir.
  time_synced: boolean;
  // Cihazın bildirdiği mesaj sayacı. Kopya okuma tespiti için; bildirmeyen ya da
  // MQTT öncesi (HTTP) okumalarda null. Dashboard sorguları bu kolonu seçmez
  // (gereksiz egress), o yüzden opsiyonel.
  msg_id?: number | null;
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

// Cihaz komutu yaşam döngüsü:
//  pending   → oluşturuldu, henüz cihaza verilmedi
//  delivered → cihaz GET ile en az bir kez çekti, ACK bekleniyor
//  applied   → cihaz uyguladı ve ok=true ACK gönderdi
//  failed    → cihaz uygulayamadı, ok=false ACK gönderdi (error dolu)
//  cancelled → admin iptal etti / daha yeni komutla geçersiz kılındı
export type CommandStatus =
  | "pending"
  | "delivered"
  | "applied"
  | "failed"
  | "cancelled";

// Desteklenen komut tipleri. Hepsi aynı kuyruk/ACK yolunu kullanır; cihaz tipe
// bakıp fiziksel register'ını (sayac/devir) değiştirir veya kalibrasyonu uygular.
//  calibration   → payload {period}: cihaz süreden threshold/mid'i kendi çıkarır
//  reset_counter → payload {}: cihaz sayacını sıfırlar
//  reset_devir   → payload {}: cihaz devrini sıfırlar
//  set_counter   → payload {value}: cihaz sayacını value'ya set eder
//  set_devir     → payload {value}: cihaz devrini value'ya set eder
// Çalışma zamanında da gerekli (her tipin kendi retained MQTT topic'i var, hepsini
// temizleyebilmek için listeyi dolaşmak lazım), o yüzden const dizi + türetilmiş tip.
export const COMMAND_TYPES = [
  "calibration",
  "reset_counter",
  "reset_devir",
  "set_counter",
  "set_devir",
] as const;

export type CommandType = (typeof COMMAND_TYPES)[number];

// device_commands tablosu satırı — kalibrasyon/konfig/aktüasyon kuyruğu.
export interface DeviceCommand {
  id: number;
  device_id: string;
  type: CommandType; // bkz. CommandType (bilinmeyen değer DB'den ham string gelebilir)
  payload: Record<string, number>; // tipe göre: {period} | {} | {value}
  status: CommandStatus;
  error: string | null; // ok=false ACK'inde cihazın hata mesajı
  created_at: string; // ISO timestamptz
  delivered_at: string | null;
  applied_at: string | null;
}

// device_health tablosu satırı — cihazın periyodik olarak bildirdiği sağlık verisi.
// Zaman serisi (geçmiş); "anlık snapshot" en yeni satırdır.
export interface DeviceHealth {
  id: number;
  device_id: string;
  reported_at: string; // ISO timestamptz
  uptime_sec: number | null; // cihazın açık kalma süresi (saniye)
  rssi: number | null; // sinyal gücü (dBm, ör. -63)
  signal_quality: number | null; // 0-100 (cihaz gönderir ya da UI'da RSSI'dan türetilir)
  error: string | null; // hata durumu/mesajı (null = sorun yok)
}

// GET /api/devices/health yanıtı: en güncel satır + geçmiş + türetilmiş bağlantı durumu.
export interface DeviceHealthResponse {
  success: boolean;
  latest: DeviceHealth | null;
  history: DeviceHealth[]; // en yeni önce
  online: boolean; // last_seen eşik içinde mi
  last_seen_unix: number | null; // son okuma veya son sağlık raporundan büyük olanı
}
