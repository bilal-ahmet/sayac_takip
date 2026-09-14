// Migration çalıştırıcı. .env.local'daki POSTGRES_* değişkenlerini kullanır.
//
//   node --env-file=.env.local scripts/migrate.mjs migrations/001_mqtt.sql
//
// Prod (Railway/Neon) için aynı komut, kendi ortam dosyanızla:
//   node --env-file=.env.production.local scripts/migrate.mjs migrations/001_mqtt.sql
//
// Migration'lar IF NOT EXISTS ile yazılmıştır; tekrar çalıştırmak güvenlidir.

import { readFileSync } from "node:fs";
import pg from "pg";

const file = process.argv[2];
if (!file) {
  console.error("Kullanım: node --env-file=.env.local scripts/migrate.mjs <dosya.sql>");
  process.exit(1);
}

const sql = readFileSync(file, "utf8");

const client = new pg.Client({
  host: process.env.POSTGRES_HOST,
  port: Number(process.env.POSTGRES_PORT),
  database: process.env.POSTGRES_DB,
  user: process.env.POSTGRES_USER,
  password: process.env.POSTGRES_PASSWORD,
  ssl: process.env.POSTGRES_SSL === "false" ? false : { rejectUnauthorized: false },
});

try {
  await client.connect();
  console.log(
    `${file} → ${process.env.POSTGRES_USER}@${process.env.POSTGRES_HOST}:${process.env.POSTGRES_PORT}/${process.env.POSTGRES_DB}`
  );
  await client.query(sql);
  console.log("Migration tamam.");
} catch (err) {
  console.error("Migration hatası:", err.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
