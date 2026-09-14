import { Pool, types } from "pg";

// BIGINT (int8, oid 20) pg'de varsayılan olarak *string* döner. timestamp_unix,
// gap_sec ve msg_id bu tipte; string kalırlarsa `+` birleştirir ve `=== sayı` hep
// false döner. Unix saniye ve msg_id 2^53'ün çok altında, hassasiyet kaybı yok.
types.setTypeParser(20, (v) => (v === null ? null : Number(v)));

// Next.js dev modunda hot-reload her seferinde modülü yeniden değerlendirir.
// globalThis üzerinde tek bir Pool tutarak bağlantı havuzunun çoğalmasını önleriz.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

function createPool(): Pool {
  const created = new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    // Neon ve diğer hosted PostgreSQL sağlayıcıları SSL zorunlu tutar.
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    // Bu olmadan DB erişilemezken pool.connect() sonsuza kadar bekler.
    connectionTimeoutMillis: 10_000,
  });

  // node-postgres boştaki bir bağlantı koptuğunda Pool üzerinde 'error' yayar.
  // Dinleyici yoksa Node bunu yakalanmamış sayıp process'i öldürür — tek uzun
  // ömürlü process'te bu, dashboard'la birlikte MQTT ingest'ini de düşürür.
  created.on("error", (err) => {
    console.error("pg pool hatası (boştaki bağlantı):", err);
  });

  return created;
}

const pool: Pool = globalForPg.pgPool ?? createPool();
globalForPg.pgPool = pool;

export default pool;
