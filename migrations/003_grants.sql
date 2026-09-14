-- sayac_user yetkileri.
--
-- SORUN: Kurulumdaki `GRANT ALL ON ALL TABLES IN SCHEMA public` yalnızca O AN var
-- olan tablolara uygulanır. device_commands ve device_health daha sonra
-- oluşturulduğu için sayac_user onlara hiç erişemedi (permission denied, 42501).
--
-- Bu dosya hem mevcut eksiği kapatır hem de ALTER DEFAULT PRIVILEGES ile sorunun
-- tekrarlamasını engeller: bundan sonra postgres'in oluşturduğu her yeni tablo/
-- sequence otomatik olarak sayac_user'a açılır.
--
-- TABLO SAHİBİ (postgres) olarak çalıştırılmalı:
--   pgAdmin4 → sayac_takip veritabanı → Query Tool → bu dosyayı aç → F5

GRANT ALL ON ALL TABLES    IN SCHEMA public TO sayac_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO sayac_user;

-- Gelecekte oluşturulacak nesneler için (kök sebebin çözümü).
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES    TO sayac_user;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO sayac_user;
