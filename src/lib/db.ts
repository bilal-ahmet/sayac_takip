import { Pool } from "pg";

// Next.js dev modunda hot-reload her seferinde modülü yeniden değerlendirir.
// globalThis üzerinde tek bir Pool tutarak bağlantı havuzunun çoğalmasını önleriz.
const globalForPg = globalThis as unknown as { pgPool?: Pool };

const pool =
  globalForPg.pgPool ??
  new Pool({
    host: process.env.POSTGRES_HOST,
    port: Number(process.env.POSTGRES_PORT),
    database: process.env.POSTGRES_DB,
    user: process.env.POSTGRES_USER,
    password: process.env.POSTGRES_PASSWORD,
    // Neon ve diğer hosted PostgreSQL sağlayıcıları SSL zorunlu tutar.
    ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPg.pgPool = pool;
}

export default pool;
