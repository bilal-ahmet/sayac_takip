-- device_health tablosu.
--
-- Bu tablo 38d78a5 commit'iyle gelen /api/devices/health ucunun ihtiyacı; prod'da
-- (Neon) elle oluşturulmuş ama yerel geliştirme veritabanında yoktu ve bir migration
-- dosyası olarak hiç yazılmamıştı. Şema, route'un INSERT/SELECT'inden türetildi.
--
-- IF NOT EXISTS: tablo zaten varsa (Neon) hiçbir şeye dokunmaz.
--
--   node --env-file=.env.local scripts/migrate.mjs migrations/002_device_health.sql

CREATE TABLE IF NOT EXISTS device_health (
  id             SERIAL PRIMARY KEY,
  device_id      VARCHAR(20) NOT NULL REFERENCES devices(device_id),
  reported_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  uptime_sec     INTEGER,      -- cihazın açık kalma süresi (saniye)
  rssi           INTEGER,      -- sinyal gücü (dBm, ör. -63)
  signal_quality INTEGER,      -- 0-100
  error          TEXT          -- hata durumu/mesajı (null = sorun yok)
);

-- GET /api/devices/health: device_id + reported_at DESC ile son N satırı çeker.
CREATE INDEX IF NOT EXISTS idx_dh_device_reported
  ON device_health (device_id, reported_at DESC, id DESC);
