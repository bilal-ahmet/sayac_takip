// Sahte IoT cihaz — donanım olmadan MQTT yolunu uçtan uca sınamak için.
//
// Kullanım (Node 20.6+ --env-file ile .env.local'ı okur):
//   node --env-file=.env.local scripts/sim-device.mjs
//   node --env-file=.env.local scripts/sim-device.mjs --scenario duplicate
//   node --env-file=.env.local scripts/sim-device.mjs --devices 5 --interval 5
//
// Senaryolar:
//   live           sürekli periyodik okuma (varsayılan), komutlara ACK verir
//   duplicate      aynı msg_id ile 3 kez yayınlar → DB'de tam olarak 1 satır olmalı
//   out-of-order   t=300, t=100, t=200 sırasıyla → delta zinciri sonunda doğru olmalı
//   unsynced       timestamp:0, time_synced:0 → sunucu kendi saatini ikame etmeli
//   bad-json       bozuk gövde → reddedilmeli, sunucu çökmemeli
//   missing-field  eksik alan → reddedilmeli
//   topic-mismatch payload'daki id topic'ten farklı → reddedilmeli

import mqtt from "mqtt";

const args = process.argv.slice(2);
function arg(name, fallback) {
  const i = args.indexOf(`--${name}`);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
}
const flag = (name) => args.includes(`--${name}`);

const PREFIX = process.env.MQTT_TOPIC_PREFIX ?? "sayac";
const URL = process.env.MQTT_URL;
if (!URL) {
  console.error("MQTT_URL tanımlı değil. --env-file=.env.local ile çalıştırın.");
  process.exit(1);
}

const scenario = arg("scenario", "live");
const baseId = arg("id", "SIM0000001");
const deviceCount = Number(arg("devices", "1"));
const intervalSec = Number(arg("interval", "5"));
const failAck = flag("fail-ack");

const now = () => Math.floor(Date.now() / 1000);

function makeReading(deviceId, msgId, overrides = {}) {
  return {
    "Device Id": deviceId,
    fw_version: "1.0.8",
    msg_id: msgId,
    timestamp: now(),
    time_synced: 1,
    sayac: 2,
    devir: 4,
    period: 0,
    baslangic: 260686,
    toplam: 260692,
    "Threshold y": 0,
    "Mid y": 0,
    ...overrides,
  };
}

function connect(clientId) {
  return mqtt.connect(URL, {
    protocolVersion: 5,
    clientId,
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    clean: true,
    connectTimeout: 10_000,
    will: {
      topic: `${PREFIX}/${clientId}/status`,
      payload: "offline",
      qos: 1,
      retain: true,
    },
  });
}

function publish(client, topic, payload, opts = {}) {
  return new Promise((resolve, reject) => {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    client.publish(topic, body, { qos: 1, ...opts }, (err) =>
      err ? reject(err) : resolve()
    );
  });
}

async function runDevice(deviceId) {
  const client = connect(deviceId);
  let msgId = Math.floor(Date.now() / 1000);
  let counter = 0;

  await new Promise((resolve, reject) => {
    client.on("connect", resolve);
    client.on("error", reject);
  });
  console.log(`[${deviceId}] bağlandı`);

  // Birth mesajı (retained) — LWT'nin karşılığı.
  await publish(client, `${PREFIX}/${deviceId}/status`, "online", { retain: true });

  // Retained komutu al ve ACK'le.
  client.subscribe(`${PREFIX}/${deviceId}/cmd`, { qos: 1 });
  client.on("message", async (topic, buf) => {
    if (!topic.endsWith("/cmd")) return;
    if (buf.length === 0) {
      console.log(`[${deviceId}] komut temizlendi (boş retained)`);
      return;
    }
    const cmd = JSON.parse(buf.toString());
    console.log(`[${deviceId}] komut alındı:`, cmd);
    await publish(client, `${PREFIX}/${deviceId}/ack`, {
      "Device Id": deviceId,
      command_id: cmd.command_id,
      ok: !failAck,
      ...(failAck ? { error: "simülasyon: uygulanamadı" } : {}),
    });
    console.log(`[${deviceId}] ack gönderildi (ok=${!failAck})`);
  });

  const topic = `${PREFIX}/${deviceId}/reading`;

  switch (scenario) {
    case "duplicate": {
      const r = makeReading(deviceId, ++msgId);
      for (let i = 0; i < 3; i++) await publish(client, topic, r);
      console.log(`[${deviceId}] aynı msg_id=${r.msg_id} 3 kez yayınlandı → DB'de 1 satır bekleniyor`);
      break;
    }
    case "out-of-order": {
      const base = now() - 600;
      // Kasıtlı olarak t=+300, +100, +200 sırasıyla gönderilir.
      for (const [offset, sayac] of [[300, 30], [100, 10], [200, 20]]) {
        await publish(
          client,
          topic,
          makeReading(deviceId, ++msgId, { timestamp: base + offset, sayac })
        );
        console.log(`[${deviceId}] t=+${offset} sayac=${sayac} yayınlandı`);
      }
      console.log("Beklenen: sayac_delta zinciri 10 → 10 → 10 (ardıl onarımı)");
      break;
    }
    case "unsynced": {
      await publish(
        client,
        topic,
        makeReading(deviceId, ++msgId, { timestamp: 0, time_synced: 0 })
      );
      console.log(`[${deviceId}] senkronsuz okuma → sunucu saati ikame etmeli`);
      break;
    }
    case "bad-json": {
      await publish(client, topic, "{bozuk json");
      console.log(`[${deviceId}] bozuk JSON yayınlandı → reddedilmeli`);
      break;
    }
    case "missing-field": {
      const r = makeReading(deviceId, ++msgId);
      delete r.sayac;
      await publish(client, topic, r);
      console.log(`[${deviceId}] sayac alanı eksik → reddedilmeli`);
      break;
    }
    case "topic-mismatch": {
      // Payload başka bir cihazın id'sini taşıyor.
      await publish(client, topic, makeReading("BASKA_CIHAZ", ++msgId));
      console.log(`[${deviceId}] topic/payload uyuşmazlığı → reddedilmeli`);
      break;
    }
    case "live":
    default: {
      const tick = async () => {
        counter += 1;
        await publish(
          client,
          topic,
          makeReading(deviceId, ++msgId, {
            sayac: counter,
            devir: counter * 2,
            period: intervalSec,
          })
        );
        console.log(`[${deviceId}] okuma #${counter} (msg_id=${msgId})`);
      };
      await tick();
      setInterval(tick, intervalSec * 1000);
      return; // süresiz çalışır
    }
  }

  // Tek atışlık senaryolar: mesajın brokera ulaşması için kısa bekleme.
  setTimeout(() => client.end(), 1500);
}

const ids =
  deviceCount > 1
    ? Array.from({ length: deviceCount }, (_, i) =>
        `${baseId.slice(0, -2)}${String(i).padStart(2, "0")}`
      )
    : [baseId];

console.log(`Senaryo: ${scenario} · cihazlar: ${ids.join(", ")}`);
for (const id of ids) {
  runDevice(id).catch((err) => console.error(`[${id}] hata:`, err.message));
}
