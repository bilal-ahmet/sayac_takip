-- Varlık envanteri: sayaç kurulum kaydı + iş geçmişi.
--
-- Sistemde bugüne kadar fiziksel sayaç, adres veya kişi kavramı yoktu; devices
-- tablosu ESP32'yi sayacın kendisi sayıyordu. Bu migration adres/tesisat, fiziksel
-- sayaç ve ESP32'yi ayrı varlıklar haline getirir ve aralarındaki eşleşmeyi ZAMANA
-- BAĞLI tutar: değişimde eski eşleşme kapanır, yenisi açılır, hiçbir satır silinmez.
--
-- Tüm ifadeler IF NOT EXISTS: tekrar çalıştırmak güvenlidir.
--
-- DİKKAT: TABLO SAHİBİ (postgres) OLARAK ÇALIŞTIRILMALI. İki sebep:
--    1) sayac_user'ın public şemasında CREATE yetkisi yok ("permission denied for
--       schema public").
--    2) 003_grants.sql'deki ALTER DEFAULT PRIVILEGES yalnızca ONU ÇALIŞTIRAN rolün
--       oluşturduğu nesneleri kapsar; sayac_user ile oluşturulan tablolar o kapsamın
--       dışında kalır ve uygulama runtime'da 42501 (permission denied) alır.
--    pgAdmin4 → sayac_takip → Query Tool → postgres ile bağlan → bu dosyayı çalıştır.

-- 1) Montaj noktası (tesisat) --------------------------------------------------
-- Sabit çıpa: sayaç da ESP32 de değişse adres değişmez.
CREATE TABLE IF NOT EXISTS installation_points (
  id             SERIAL PRIMARY KEY,
  facility_code  VARCHAR(40),          -- tesisat ID (kurum tarafından verilen)
  address        TEXT        NOT NULL, -- açık adres
  meter_location VARCHAR(200),         -- sayacın adresteki konumu (ör. "bodrum, kat girişi")
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tesisat ID benzersiz ama zorunlu değil → kısmi unique (uq_mr_device_msg deseni).
CREATE UNIQUE INDEX IF NOT EXISTS uq_ip_facility
  ON installation_points (facility_code)
  WHERE facility_code IS NOT NULL;

-- 2) Fiziksel sayaç ------------------------------------------------------------
-- Stoktaki sayaç = açık installations satırı olmayan sayaç; durum kolonu gerekmez.
CREATE TABLE IF NOT EXISTS meters (
  id             SERIAL PRIMARY KEY,
  serial_no      VARCHAR(40) UNIQUE NOT NULL, -- uygulamada upper(trim()) ile yazılır
  brand          VARCHAR(60),
  model          VARCHAR(60),
  -- Etiket verisinden YAZILIMIN ihtiyacı olan tek alan: darbe sabiti (imp/birim).
  -- Bu olmadan sayac değeri hacme çevrilemez; farklı sabitli bir sayaca geçilince
  -- okuma serisinin anlamı sessizce değişir.
  pulse_per_unit NUMERIC(12,4),
  tech_label     TEXT,                        -- diğer etiket bilgisi (serbest metin)
  notes          TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3) Personel ------------------------------------------------------------------
-- Sistemde kullanıcı kimliği yok (tek ortak Basic auth şifresi), o yüzden işi yapan
-- kişi ayrı bir referans tablosundan seçilir. SİLİNMEZ, pasife alınır: iş emirlerinden
-- gelen FK kırılmasın.
CREATE TABLE IF NOT EXISTS personnel (
  id         SERIAL PRIMARY KEY,
  full_name  VARCHAR(100) UNIQUE NOT NULL,
  role       VARCHAR(60),                     -- ör. "tekniker", "montaj ekibi"
  phone      VARCHAR(30),
  active     BOOLEAN NOT NULL DEFAULT TRUE,   -- false = artık listede görünmez
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4) İş emri -------------------------------------------------------------------
-- Append-only olay kaydı. installations'tan ÖNCE oluşturulur; FK yönü tek
-- (installations → work_orders), döngü yok.
-- type uygulama tarafında whitelist ile doğrulanır (PG enum / CHECK kullanılmaz):
--   kurulum | ariza | kontrol | onarim | sayac_degisimi | esp32_degisimi | sokum
CREATE TABLE IF NOT EXISTS work_orders (
  id                    SERIAL PRIMARY KEY,
  installation_point_id INTEGER      NOT NULL REFERENCES installation_points(id),
  type                  VARCHAR(30)  NOT NULL,
  performed_by_id       INTEGER      NOT NULL REFERENCES personnel(id),
  performed_at          TIMESTAMPTZ  NOT NULL, -- işin YAPILDIĞI an (kullanıcı girer)
  reason                TEXT,                  -- neden
  work_done             TEXT,                  -- yapılan iş
  -- Metin anlık görüntüler: değişen ESP32/sayaç kaydı sonradan silinse bile iş emri
  -- ayakta kalsın diye BİLEREK FK DEĞİL.
  old_meter_serial      VARCHAR(40),
  new_meter_serial      VARCHAR(40),
  old_mac               VARCHAR(20),
  new_mac               VARCHAR(20),
  new_seal_no           VARCHAR(40),           -- mühür değiştiyse
  notes                 TEXT,
  -- SUNUCU saati. performed_at geri tarihlenmişse fark arayüzde görünür kılınır.
  created_at            TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_wo_point_performed
  ON work_orders (installation_point_id, performed_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_wo_type
  ON work_orders (type);

-- 5) Kurulum (zamansal eşleşme) ------------------------------------------------
-- (nokta, sayaç, cihaz) üçlüsünün zamana bağlı bağı. ended_at IS NULL = aktif.
CREATE TABLE IF NOT EXISTS installations (
  id                      SERIAL PRIMARY KEY,
  installation_point_id   INTEGER     NOT NULL REFERENCES installation_points(id),
  meter_id                INTEGER     NOT NULL REFERENCES meters(id),
  -- NULL olabilir: ESP32 geçici olarak sökülüp sayaç yerinde kalabilir. NOT NULL
  -- olsaydı bunu ifade etmenin tek yolu kurulumu kapatmak olurdu, ki bu "sayaç da
  -- söküldü" demek olurdu.
  device_id               VARCHAR(20) REFERENCES devices(device_id),
  started_at              TIMESTAMPTZ NOT NULL,
  ended_at                TIMESTAMPTZ,          -- NULL = aktif eşleşme
  initial_index           NUMERIC(14,3),        -- başlangıç endeksi (sayaç kadranı)
  seal_no                 VARCHAR(40),          -- kurulum anındaki mühür numarası
  notes                   TEXT,
  -- Her kurulumun bir açan iş emri VARDIR (ilk kurulumda type='kurulum'). Kurulumu
  -- kimin/ne zaman/neden açtığı böylece yapısal olarak garanti; ayrı installed_by
  -- alanı tutulmaz (iki kaynak, biri düzeltilince ayrışır).
  opened_by_work_order_id INTEGER     NOT NULL REFERENCES work_orders(id),
  closed_by_work_order_id INTEGER     REFERENCES work_orders(id), -- ended_at ile dolar
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Zamansal değişmezler DB seviyesinde. Advisory lock atlansa bile bunlar 23505
-- fırlatır ve iki açık kurulum oluşamaz; handler 23505'i 409'a çevirir.
-- device_id NULL satırlar indekste çakışmaz (sökülü ESP32 durumu).
CREATE UNIQUE INDEX IF NOT EXISTS uq_inst_device_open
  ON installations (device_id)
  WHERE ended_at IS NULL AND device_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inst_meter_open
  ON installations (meter_id)
  WHERE ended_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_inst_point_open
  ON installations (installation_point_id)
  WHERE ended_at IS NULL;

-- Cihaz sayfası ve aralık birleştirmesi (okumaların kurulum dönemine atfı).
CREATE INDEX IF NOT EXISTS idx_inst_device_started
  ON installations (device_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inst_point_started
  ON installations (installation_point_id, started_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_inst_meter
  ON installations (meter_id);

-- 6) Şema kendini anlatsın ------------------------------------------------------
COMMENT ON TABLE  installation_points IS 'Montaj noktası / tesisat — sayaç ve ESP32 değişse de sabit kalan adres çıpası';
COMMENT ON COLUMN installation_points.facility_code IS 'Tesisat ID (kurum tarafından verilen; benzersiz ama opsiyonel)';
COMMENT ON COLUMN meters.pulse_per_unit IS 'Darbe sabiti (imp/birim) — sayac değerini hacme çevirmek için gerekli';
COMMENT ON COLUMN personnel.active IS 'false = pasif; personel SİLİNMEZ, iş emri FK''leri kırılmasın diye';
COMMENT ON COLUMN work_orders.performed_at IS 'İşin yapıldığı an (kullanıcı girer); created_at sunucu saatidir';
COMMENT ON COLUMN work_orders.old_mac IS 'Metin anlık görüntü — cihaz kaydı silinse de iş emri ayakta kalsın diye FK DEĞİL';
COMMENT ON TABLE  installations IS 'Zamansal (nokta, sayaç, cihaz) eşleşmesi; ended_at IS NULL = aktif';
COMMENT ON COLUMN installations.device_id IS 'Eşleşen ESP32 MAC. NULL = ESP32 geçici olarak sökülü, sayaç yerinde';
COMMENT ON COLUMN installations.ended_at IS 'NULL = aktif eşleşme. Kapanan satır ASLA silinmez';
COMMENT ON COLUMN installations.initial_index IS 'Kurulum anındaki sayaç kadran değeri (başlangıç endeksi)';
