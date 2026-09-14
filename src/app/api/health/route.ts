import { NextResponse } from "next/server";
import pool from "@/lib/db";
import { mqttHealth } from "@/lib/mqtt";

// GET /api/health — harici uptime kontrolü için.
// lastMessageAt önemli: MQTT "bağlı" görünüp abonelik sessizce düşmüş olabilir,
// bu durumda tek belirti mesaj akışının durmasıdır.
export async function GET() {
  let db: "ok" | "fail" = "ok";
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    console.error("Sağlık kontrolü: DB erişilemedi:", err);
    db = "fail";
  }

  const mqtt = mqttHealth();
  const healthy = db === "ok" && (!mqtt.enabled || mqtt.connected);

  return NextResponse.json({ db, mqtt }, { status: healthy ? 200 : 503 });
}
