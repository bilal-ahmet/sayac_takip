# Firmware MQTT Sözleşmesi (ESP32)

Sayaç Takip sistemi cihaz iletişimini HTTP'den MQTT'ye taşıyor. Bu doküman firmware
tarafında uyulması gereken sözleşmedir.

**Okuma payload'ı bugünküyle birebir aynı kalıyor** — yalnızca tek yeni alan (`msg_id`)
ekleniyor ve taşıma katmanı değişiyor. JSON üreten kod olduğu gibi kullanılabilir.

---

## Bağlantı

| | |
|---|---|
| Host | `<cluster>.s1.<region>.hivemq.cloud` |
| Port | **8883, yalnızca TLS.** HiveMQ Cloud'da şifresiz 1883 portu yoktur. |
| Protokol | **MQTT 3.1.1 yeterli.** MQTT 5 gerekmiyor. |
| Client ID | Cihaz id'si = iki nokta olmadan MAC, ör. `188B0E88947C`. Bugünkü `"Device Id"` ile aynı. **Benzersiz olmak zorunda** — aynı clientId'li iki cihaz birbirini sonsuz döngüde düşürür. |
| Clean session | **`true`.** Cihazın tek aboneliği *retained* bir topic olduğu için temiz oturumda da güncel komut bağlantı anında gelir. Böylece brokerda kalıcı oturum birikmez. |
| Keepalive | **60 sn** (en fazla 120). |
| Kimlik | **Tüm cihazlarda AYNI** kullanıcı adı/şifre (ayrıca iletilecek). Firmware'de sabit gömülebilir, cihaz başına farklılaşmaz. Asla loglanmayacak, seri porta basılmayacak. |

### Bağlantı açık tutulacak

Okumalar arasında bağlanıp kapanılmayacak. Tam bir TLS el sıkışması ~5 KB, yani bir
okumanın yaklaşık **20 katı**. 5 saniyede bir bağlanıp kapanmak veri kotasını payload'dan
çok daha hızlı tüketir. TLS session resumption (session ticket) açılsın.

### Yeniden bağlanma

Üstel backoff: 1 → 2 → 4 → 8 … tavan **60 sn**, artı **±30 sn rastgele jitter**.
Jitter zorunlu: aksi halde bir broker kesintisi sonrası tüm cihazlar aynı anda döner.

### TLS

**ESP-IDF'in `esp_crt_bundle`'ı kullanılacak** (gömülü Mozilla kök sertifika deposu).
Tek bir kök veya leaf sertifika **pinlenmeyecek**: HiveMQ tarafında bir CA rotasyonu
tüm filoyu OTA yolu olmadan kullanılamaz hale getirir.

`setInsecure()` / sertifika doğrulamasını kapatma **kabul edilmez**.

### Saat

**SNTP, TLS bağlantısından ÖNCE başarılı olmak zorunda** — sertifika geçerlilik
kontrolü doğru saate ihtiyaç duyar. Başarısızlıkta SNTP yeniden denenecek.

### Buffer boyutu

MQTT istemci buffer'ı **en az 512 bayt**. Arduino `PubSubClient` kullanılıyorsa
varsayılan `MQTT_MAX_PACKET_SIZE` **256**'dır; 213 baytlık publish neredeyse sıfır
boşlukla sığar ve payload'a bir alan eklendiğinde `publish()` **sessizce `false`**
döner. `setBufferSize(512)` çağrılacak.

---

## Topic'ler

`{id}` = iki nokta olmadan MAC.

| Topic | Yön | QoS | Retain | İçerik |
|---|---|---|---|---|
| `sayac/{id}/reading` | cihaz → sunucu | **1** | **false** | Okuma JSON'u (aşağıda) |
| `sayac/{id}/health` | cihaz → sunucu | **1** | **false** | Periyodik sağlık raporu |
| `sayac/{id}/ack` | cihaz → sunucu | **1** | **false** | Komut sonucu |
| `sayac/{id}/cmd/{type}` | sunucu → cihaz | **1** | **true** | O tipteki güncel komut, boş payload = yok |
| `sayac/{id}/status` | cihaz → sunucu | **1** | **true** | `online` / `offline` |

`reading`, `health` ve `ack` **retain edilmeyecek** — retained olsalardı sunucu her
yeniden bağlandığında eski mesajı tekrar işlerdi.

**Komut topic'i neden tip başına ayrı:** Sunucuda her komut tipinin kendi bağımsız
"tek güncel hedefi" var — bir `set_counter` göndermek bekleyen bir `calibration`'ı
geçersiz kılmaz. Tek bir `cmd` topic'i kullanılsaydı yeni bir komut brokerdaki farklı
tipteki komutu ezerdi. Cihaz tek bir wildcard aboneliğiyle hepsini alır:

```
sayac/{id}/cmd/+
```

### Last Will (LWT)

CONNECT paketinde ayarlanacak:
- topic: `sayac/{id}/status`
- payload: `offline`
- qos: 1, retain: **true**

Bağlantı kurulduktan hemen sonra cihaz aynı topic'e `online` (retain: true) yayınlar
(birth mesajı). Sunucu bunu dashboard'daki çevrimiçi rozetinde gösterir.

---

## Okuma payload'ı

Bugünküyle birebir aynı, tek fark `msg_id`:

```json
{"Device Id":"188B0E88947C","fw_version":"1.0.8","msg_id":1043,
 "timestamp":1781601718,"time_synced":1,"sayac":2,"devir":4,
 "period":0,"baslangic":260686,"toplam":260692,"Threshold y":0,"Mid y":0}
```

Zorunlu alanlar: `Device Id`, `timestamp`, `sayac`, `devir`, `baslangic`.
`timestamp` saat bilinmiyorken bile **gönderilmek zorunda** (`0` olarak).

> Payload'daki `Device Id` ile topic'teki `{id}` **aynı olmak zorunda**. Sunucu
> uyuşmayan mesajı reddeder.

### `msg_id` kuralları

MQTT QoS 1 "en az bir kez" teslim eder; yeniden bağlanmalarda aynı okuma tekrar
gelebilir. Sunucu kopyaları `msg_id` ile ayırt edip atar.

- Cihaz başına **monotonik artan**, asla tekrar kullanılmaz.
- **NVS'te her 256 artışta bir** checkpoint'lenir; boot'ta `kayıtlı + 256`'dan devam
  edilir. 5 sn'lik okumada günde ~67 flash yazımı; reboot'lar arası monotonluk
  garantili, wrap aritmetiği veya bit-packing yok.
- Aynı okumanın her yeniden gönderiminde **aynı** `msg_id` kullanılır. (QoS 1
  yeniden gönderimi serileştirilmiş paketi tekrar kullandığı için otomatik — yeter ki
  JSON retry'da yeniden kurulmasın.)
- `msg_id` gönderilmezse okuma yine kabul edilir, sadece kopya koruması olmaz.
  NVS'i bozulan cihaz susmaktansa veri göndermeye devam etmeli.

> ⚠️ **NVS silinir veya cihaz yeniden flash'lanıp sayaç sıfırlanırsa**, yeni okumalar
> geçmiştekilerle çakışır ve sunucu tarafından **sessizce atılır**. Flash prosedüründe
> NVS korunmalı; korunamıyorsa cihaz yeni bir id ile yeniden provizyonlanmalı.

---

## Tamponlama (çevrimdışıyken)

MQTT bağlantı koptuğunda okumaları tamponlayıp sonra göndermeyi mümkün kılar —
bugün o okumalar tamamen kayıp. Kurallar:

- Ring buffer **~200 okuma** ile sınırlı; taşmada en eski düşer.
- Yakalama anında `esp_timer_get_time()` (boot'tan beri µs, WiFi'siz çalışır) kaydedilir.
- Boşaltmada gerçek zaman geri hesaplanır:
  ```
  timestamp   = ntp_now_sec - (uptime_now_us - uptime_yakalama_us) / 1e6
  time_synced = 1
  ```
- ⚠️ **Tamponlanmış okuma asla `time_synced: 0` ile gönderilmeyecek.** Sunucu
  `time_synced: 0` gördüğünde kendi saatini basar; tamponlanmış bir okumada bu,
  yakalama anı yerine **boşaltma anının** saati demektir — veri sessizce yanlış olur.
  Boşaltma anında saat hâlâ bilinmiyorsa tampon atılır.
- Boşaltma **en eskiden başlar**, saniyede **≤5 mesaj**, yeniden bağlanma sonrası
  **0-30 sn rastgele gecikmeyle** (thundering herd koruması).
- Canlı (tamponlanmamış) okuma bugünkü gibi `timestamp: 0, time_synced: 0`
  kullanabilir — yayın gecikmesi içinde sunucu saati yakalama anına yeterince yakındır.

---

## Sağlık raporu

Cihaz periyodik olarak (öneri: **60 saniyede bir**, okuma sıklığından çok daha seyrek)
`sayac/{id}/health` topic'ine yayınlar:

```json
{"Device Id":"188B0E88947C","uptime_sec":86400,"rssi":-63,"signal_quality":74,"error":null}
```

Tüm alanlar `Device Id` dışında opsiyoneldir; sayı olmayan değerler `null` kaydedilir.
`signal_quality` 0-100 aralığında; gönderilmezse arayüz RSSI'dan türetir.
`error` sorun yokken `null`, varsa ≤1000 karakterlik mesaj.

---

## Komut işleme

Beş komut tipi var. Hepsi aynı kuyruk/ACK yolunu kullanır:

| `type` | `payload` | Cihaz ne yapar |
|---|---|---|
| `calibration` | `{"period": 120}` | Süreden `Threshold y` / `Mid y`'yi **kendisi türetir**, sonraki okuma paketlerinde geri bildirir (bugünkü davranış, değişmedi) |
| `set_counter` | `{"value": 1500}` | Sayaç register'ını `value`'ya yazar |
| `set_devir` | `{"value": 40}` | Devir register'ını `value`'ya yazar |
| `reset_counter` | `{}` | Sayacı sıfırlar |
| `reset_devir` | `{}` | Deviri sıfırlar |

Gelen komut (`sayac/{id}/cmd/{type}`, retained):
```json
{"command_id":42,"type":"calibration","payload":{"period":120},"created_at":"2026-09-14T10:00:00.000Z"}
```

- Bağlantıdan hemen sonra `sayac/{id}/cmd/+`'e abone olunur; retained mesajlar
  (varsa, birden fazla tip olabilir) anında gelir.
- **Boş (sıfır uzunlukta) payload = o tipte aktif komut yok**, hiçbir şey yapılmaz.
- ⚠️ **`last_applied_command_id` TİP BAŞINA ayrı tutulur** (NVS'te 5 ayrı değer).
  Gelen komutun `command_id`'si o tipin kayıtlı değerinden küçük veya eşitse yok
  sayılır. **Tek bir global değer kullanmak hatalıdır**: `command_id` tüm tipler için
  ortak bir sayaçtan gelir, yani cihaz `calibration` id=50'yi uyguladıktan sonra
  brokerda bekleyen `set_counter` id=48'i sessizce yok sayardı.
- Bu mekanizma retained komutu cihaz tarafında idempotent yapar: reboot döngüsü komutu
  tekrar uygulamaz, sunucunun temizlemeyi kaçırdığı bir retained mesaj zararsız kalır.
  **Bu olmadan**, geri dönüştürülmüş MAC'li bir cihaz ilk boot'ta bir yıllık
  kalibrasyonu uygular.
- Uygulandıktan sonra: önce o tipin `last_applied_command_id`'si yazılır, sonra ACK
  yayınlanır.
- `period` ve `value` JSON **sayı** ve **ondalıklı gelebilir** (dashboard yalnızca
  sonlu ve `>= 0` kontrolü yapıyor). Yuvarlanacak ya da reddedilecek; tam sayı
  varsayılmayacak.
- `set_*` ve `reset_*` fiziksel register'ı değiştirir; dashboard bunlar için iki adımlı
  onay istiyor ama cihaz tarafında ek bir koruma beklenmiyor.

### ACK

Başarı:
```json
{"Device Id":"188B0E88947C","command_id":42,"ok":true}
```
Başarısızlık:
```json
{"Device Id":"188B0E88947C","command_id":42,"ok":false,"error":"≤200 karakter mesaj"}
```

Hata durumunda retry döngüsüne girilmez: bir kez bildirilir ve yeni komut beklenir.

---

## Netleştirilmesi gereken dört soru

1. **Bugünkü firmware TLS sertifikasını doğruluyor mu, yoksa `setInsecure()` mi
   çağırıyor?** Sahada `time_synced: 0` yaşanıyorsa ikincisi muhtemel — bu durumda
   bugün TLS hiçbir kimlik doğrulaması sağlamıyor demektir ve geçişle birlikte
   kapatılması gereken bir açık var.
2. **Flash prosedürü NVS'i koruyor mu?** `msg_id`'nin doğruluğu buna bağlı.
3. **`period` ve `value` tam sayı mı bekleniyor?** Dashboard ondalıklı gönderebiliyor.
4. **Flash okuma koruması (flash encryption / secure boot) açık mı?** Broker
   kimliği tüm cihazlarda ortak olduğu için, tek bir cihazın flash'ından okunan
   şifre tüm filoyu taklit etmeye yeter. Koruma açıksa bu risk büyük ölçüde kapanır.
