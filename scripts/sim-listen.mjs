// Brokerdaki tüm sayaç trafiğini dinler — geçiş sırasında "gerçekten ne yayınlanıyor?"
// sorusunu cevaplamak için.
//
//   node --env-file=.env.local scripts/sim-listen.mjs
//   node --env-file=.env.local scripts/sim-listen.mjs --topic 'sayac/+/cmd'

import mqtt from "mqtt";

const args = process.argv.slice(2);
const i = args.indexOf("--topic");
const PREFIX = process.env.MQTT_TOPIC_PREFIX ?? "sayac";
const topic = i !== -1 && args[i + 1] ? args[i + 1] : `${PREFIX}/#`;

if (!process.env.MQTT_URL) {
  console.error("MQTT_URL tanımlı değil. --env-file=.env.local ile çalıştırın.");
  process.exit(1);
}

const client = mqtt.connect(process.env.MQTT_URL, {
  protocolVersion: 5,
  clientId: `sayac-listen-${Math.random().toString(16).slice(2, 8)}`,
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clean: true,
});

client.on("connect", () => {
  console.log(`Dinleniyor: ${topic}`);
  client.subscribe(topic, { qos: 1 });
});

client.on("message", (t, payload, packet) => {
  const tag = packet.retain ? " [retained]" : "";
  const body = payload.length === 0 ? "<boş>" : payload.toString();
  console.log(`${new Date().toISOString()} ${t}${tag}\n  ${body}`);
});

client.on("error", (err) => console.error("Hata:", err.message));
