-- MQTT geçişi — Faz 1 migration'ı.
-- Hem dev (localhost) hem prod veritabanında çalıştırılır.
-- Tüm ifadeler IF NOT EXISTS: tekrar çalıştırmak güvenlidir.

-- 1) Kopya okuma tespiti -------------------------------------------------------
-- MQTT QoS 1 en-az-bir-kez teslim eder; yeniden bağlanmada kopya okuma gelir.
-- Cihaz her okumaya monotonik artan bir msg_id koyar.
ALTER TABLE meter_readings
  ADD COLUMN IF NOT EXISTS msg_id BIGINT;

-- KISMİ unique indeks: mevcut satırların hepsinde msg_id NULL olduğu için
-- indeksin dışında kalırlar → geçmişte kopya olsa bile bu CREATE başarısız olmaz,
-- önceden bir geçmiş temizliği gerekmez.
CREATE UNIQUE INDEX IF NOT EXISTS uq_mr_device_msg
  ON meter_readings (device_id, msg_id)
  WHERE msg_id IS NOT NULL;

-- 2) Sorgu indeksi -------------------------------------------------------------
-- Şunları karşılar: öncül satır aramasi (timestamp_unix <= $2), ardıl araması,
-- canlı mod GET'inin "ORDER BY timestamp_unix DESC, id DESC LIMIT n" sorgusu ve
-- filtre modundaki CTE penceresi.
CREATE INDEX IF NOT EXISTS idx_mr_device_ts_id
  ON meter_readings (device_id, timestamp_unix DESC, id DESC);

-- idx_mr_device_id artık bunun gereksiz bir ön eki. Yukarıdaki indeksin
-- kullanıldığı EXPLAIN ile doğrulandıktan SONRA düşürülebilir:
--   DROP INDEX IF EXISTS idx_mr_device_id;

-- 3) Cihaz özet sayaçları ------------------------------------------------------
-- GET /api/devices her 5 saniyede tüm meter_readings üzerinde COUNT() + LEFT JOIN
-- çalıştırıyordu. 5 sn'lik okuma aralığında bu ayda milyonlarca satır demek.
-- Sayaçlar ingest sırasında güncellenir, sorgu tek tablo taramasına iner.
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS reading_count       INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_timestamp_unix BIGINT;

-- Mevcut veriden bir kerelik doldurma (tekrar çalıştırmak da doğru sonucu verir).
UPDATE devices d
SET reading_count = COALESCE(s.cnt, 0),
    last_timestamp_unix = s.max_ts
FROM (
  SELECT device_id, COUNT(*)::int AS cnt, MAX(timestamp_unix) AS max_ts
  FROM meter_readings
  GROUP BY device_id
) s
WHERE s.device_id = d.device_id;

-- Hiç okuması olmayan cihazlar için sayacı sıfırla.
UPDATE devices
SET reading_count = 0, last_timestamp_unix = NULL
WHERE device_id NOT IN (SELECT DISTINCT device_id FROM meter_readings);

-- 4) Cihaz çevrimiçi durumu (MQTT LWT + birth mesajı) -------------------------
ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS online       BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ;
