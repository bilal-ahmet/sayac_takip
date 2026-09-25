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

// ---------------------------------------------------------------------------
// Varlık envanteri: kurulum kaydı + iş geçmişi
// ---------------------------------------------------------------------------

// installation_points tablosu satırı — montaj noktası / tesisat.
// Sayaç da ESP32 de değişse sabit kalan çıpa.
export interface InstallationPoint {
  id: number;
  facility_code: string | null; // tesisat ID
  address: string;
  meter_location: string | null; // sayacın adresteki konumu
  notes: string | null;
  created_at: string; // ISO timestamptz
}

// meters tablosu satırı — fiziksel sayaç.
export interface Meter {
  id: number;
  serial_no: string;
  brand: string | null;
  model: string | null;
  // Darbe sabiti (imp/birim). sayac değerini hacme çevirmek için gerekli; farklı
  // sabitli bir sayaca geçilince okuma serisinin anlamı değişir.
  pulse_per_unit: number | null;
  tech_label: string | null;
  notes: string | null;
  created_at: string;
}

// personnel tablosu satırı — işi yapan kişi. Silinmez, pasife alınır.
export interface Person {
  id: number;
  full_name: string;
  role: string | null;
  phone: string | null;
  active: boolean;
  created_at: string;
}

// İş emri tipleri. calibration/COMMAND_TYPES gibi çalışma zamanında da gerekli
// (açılır liste + tipe göre etki haritası), o yüzden const dizi + türetilmiş tip.
//   kurulum        → ilk kurulum; kurulumu açan iş emri
//   ariza/kontrol/onarim → yalnızca kayıt, eşleşmeye dokunmaz
//   sayac_degisimi → kurulum kapanır, aynı cihaz + YENİ sayaçla yenisi açılır
//   esp32_degisimi → kurulum kapanır, aynı sayaç + YENİ cihazla yenisi açılır
//   sokum          → kurulum kapanır, yenisi açılmaz
export const WORK_ORDER_TYPES = [
  "kurulum",
  "ariza",
  "kontrol",
  "onarim",
  "sayac_degisimi",
  "esp32_degisimi",
  "sokum",
] as const;

export type WorkOrderType = (typeof WORK_ORDER_TYPES)[number];

// work_orders tablosu satırı — append-only olay kaydı.
export interface WorkOrder {
  id: number;
  installation_point_id: number;
  type: WorkOrderType;
  performed_by_id: number;
  performed_by_name: string; // personnel JOIN'inden gelir
  performed_at: string; // işin yapıldığı an (kullanıcı girer)
  reason: string | null;
  work_done: string | null;
  // Metin anlık görüntüler: ilgili cihaz/sayaç kaydı silinse bile kalır.
  old_meter_serial: string | null;
  new_meter_serial: string | null;
  old_mac: string | null;
  new_mac: string | null;
  new_seal_no: string | null;
  notes: string | null;
  created_at: string; // sunucu saati; performed_at ile farkı geri tarihlemeyi gösterir
}

// installations tablosu satırı — zamansal (nokta, sayaç, cihaz) eşleşmesi.
export interface Installation {
  id: number;
  installation_point_id: number;
  meter_id: number;
  device_id: string | null; // NULL = ESP32 sökülü, sayaç yerinde
  started_at: string;
  ended_at: string | null; // NULL = aktif eşleşme
  initial_index: number | null; // başlangıç endeksi
  seal_no: string | null;
  notes: string | null;
  opened_by_work_order_id: number;
  closed_by_work_order_id: number | null;
  created_at: string;
}

// Kurulum + ilişkili sayaç ve açan iş emri bilgisi (panelin gösterdiği birleşik satır).
export interface InstallationDetail extends Installation {
  meter: Meter;
  opened_by: { performed_by_name: string; performed_at: string; type: WorkOrderType };
}

// GET /api/registry?device_id= yanıtı — paneli tek turda besler.
export interface RegistryResponse {
  success: boolean;
  point: InstallationPoint | null; // null = bu cihaz hiç kurulmamış
  current: InstallationDetail | null; // aktif eşleşme (ended_at IS NULL)
  installations: InstallationDetail[]; // kapanmışlar dahil, started_at DESC
  work_orders: WorkOrder[]; // performed_at DESC
}

// GET /api/registry/search?q= — tek bir kurulum eşleşmesi.
export interface RegistrySearchResult {
  installation_id: number;
  installation_point_id: number;
  facility_code: string | null;
  address: string;
  meter_location: string | null;
  device_id: string | null;
  serial_no: string;
  started_at: string;
  ended_at: string | null;
  active: boolean; // ended_at === null
}

// GET /api/registry/search?q= yanıtı.
// `devices`, kayıtlı ama hiç kurulmamış cihazları ayrı tutar: aksi halde yeni
// tanımlanmış bir MAC aratıldığında sonuç boş döner ve kullanıcı kaydın kaybolduğunu
// sanır.
export interface RegistrySearchResponse {
  success: boolean;
  results: RegistrySearchResult[];
  devices: { device_id: string; name: string | null }[];
}

// GET /api/registry/periods?device_id= — bir cihazın kurulum dönemleri.
// Okuma paneli bunu grafikteki sınır çizgileri ve "bu okuma hangi sayaca ait"
// atfı için kullanır. Kasten küçük tutuldu; cihaz değişiminde çekilir, poll edilmez.
export interface InstallationPeriod {
  installation_id: number;
  started_at: string;
  ended_at: string | null; // NULL = hâlâ açık
  serial_no: string;
}
