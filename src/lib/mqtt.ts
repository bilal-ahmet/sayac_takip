import mqtt, { type MqttClient, type IClientOptions } from "mqtt";
import pool from "@/lib/db";
import { ingestReading, ingestHealth, applyAck, strictDevices } from "@/lib/ingest";
import {
  cmdTopic,
  statusTopic,
  allCmdTopics,
  parseTopic,
  subscriptions,
} from "@/lib/topics";
import type { CommandType } from "@/types";

// Sunucunun kalıcı MQTT bağlantısı. Railway'de `next start` uzun ömürlü tek bir
// Node process'i olduğu için istemci doğrudan uygulamanın içinde yaşar; ayrı bir
// worker process yok. Bağlantı src/instrumentation.ts içinden başlatılır.

interface MqttState {
  client: MqttClient;
  connects: number;
  reconnects: number;
  lastConnectAt: number | null;
  lastMessageAt: number | null;
  sessionPresent: boolean | null;
  lastError: string | null;
}

// DİKKAT: cache KOŞULSUZ. db.ts'teki `if (NODE_ENV !== "production")` kalıbı buraya
// KOPYALANMAMALI. instrumentation.ts Next tarafından ayrı bir webpack katmanında
// derlenir; bu modül hem oradan hem route handler'lardan import edildiği için
// koşullu cache iki modül örneği → iki MQTT istemcisi → iki abonelik → her okumanın
// iki kez yazılması demek olurdu.
const g = globalThis as unknown as { __sayacMqtt?: MqttState };

const PUBLISH_TIMEOUT_MS = 5_000;
// Retained komutun brokerda kalma süresi (30 gün). Devreden çıkan bir cihazın
// komutu sonsuza dek çöp olarak durmasın.
const COMMAND_EXPIRY_SEC = 30 * 24 * 60 * 60;

export function getMqttClient(): MqttClient | null {
  if (g.__sayacMqtt) return g.__sayacMqtt.client;

  const url = process.env.MQTT_URL;
  // MQTT_URL yoksa MQTT tamamen kapalıdır. Serverless bir ortama (Vercel) yanlışlıkla
  // deploy edilirse her cold start'ın brokera bağlanmaya çalışmasını engelleyen emniyet.
  if (!url) return null;

  const options: IClientOptions = {
    protocolVersion: 5,
    clientId: process.env.MQTT_CLIENT_ID ?? "sayac-backend",
    username: process.env.MQTT_USERNAME,
    password: process.env.MQTT_PASSWORD,
    // Kalıcı oturum: uygulama yeniden başlarken (deploy, restart) brokerın mesajları
    // kuyruklaması için. Cihaz tarafı tamponlamanın yerini TUTMAZ — broker kuyruğu
    // istemci başına ~1000 mesajla sınırlı ve Serverless'ta ayarlanamıyor.
    clean: false,
    properties: { sessionExpiryInterval: 3600 },
    reconnectPeriod: 2_000,
    connectTimeout: 10_000,
  };

  console.log(`MQTT bağlanıyor: ${url} (clientId=${options.clientId})`);
  const client = mqtt.connect(url, options);

  const state: MqttState = {
    client,
    connects: 0,
    reconnects: 0,
    lastConnectAt: null,
    lastMessageAt: null,
    sessionPresent: null,
    lastError: null,
  };
  g.__sayacMqtt = state;

  client.on("connect", (connack) => {
    state.connects += 1;
    state.lastConnectAt = Date.now();
    state.sessionPresent = connack?.sessionPresent ?? null;
    console.log(
      `MQTT bağlandı (#${state.connects}, sessionPresent=${state.sessionPresent})`
    );

    // KOŞULSUZ yeniden abone ol. MQTT.js `clean: false` ile yeniden bağlanmada
    // abonelikleri geri yüklemiyor; broker oturumu düşürmüşse istemci "bağlı"
    // görünüp sonsuza dek hiçbir mesaj almaz ve hata da vermez. Var olan oturumda
    // tekrar SUBSCRIBE idempotent olduğu için bunun maliyeti yok.
    client.subscribe(subscriptions(), { qos: 1 }, (err) => {
      if (err) {
        state.lastError = `subscribe: ${err.message}`;
        console.error("MQTT abone olunamadı:", err);
      } else {
        console.log(`MQTT abone olundu: ${subscriptions().join(", ")}`);
      }
    });

    // Broker erişilemezken oluşturulmuş komutları yeniden yayınla. Bu olmadan
    // POST /api/commands sırasındaki bir kesinti komutu kalıcı olarak 'pending'de
    // bırakırdı.
    void sweepPendingCommands();
  });

  client.on("reconnect", () => {
    state.reconnects += 1;
  });

  client.on("error", (err) => {
    state.lastError = err.message;
    console.error("MQTT hatası:", err.message);
  });

  client.on("close", () => {
    console.warn("MQTT bağlantısı kapandı");
  });

  client.on("offline", () => {
    console.warn("MQTT çevrimdışı");
  });

  // Ingest 'message' olayı ÜZERİNDEN YAPILMAZ. MQTT.js'in varsayılan handleMessage'ı
  // callback'i hemen çağırır ve PUBACK'i tetikleyen o callback'tir — yani broker'a
  // "aldım" demek satır COMMIT edilmeden önce gerçekleşir ve o aralıkta çöken process
  // okumayı kalıcı kaybeder (QoS 1 sessizce en-fazla-bir-kez'e düşer).
  // Override ayrıca mesajları teker teker işleterek doğal backpressure sağlar.
  client.handleMessage = (packet, done) => {
    const p = packet as { topic: string; payload: Buffer };
    state.lastMessageAt = Date.now();
    void routeMessage(p.topic, p.payload)
      .catch((err) => console.error("MQTT mesaj işleme hatası:", err))
      .finally(() => done());
  };

  return client;
}

// Gelen mesajı topic'e göre yönlendir.
async function routeMessage(topic: string, payload: Buffer): Promise<void> {
  const parsed = parseTopic(topic);
  if (!parsed) {
    console.warn(`MQTT bilinmeyen topic: ${topic}`);
    return;
  }
  const { deviceId, kind } = parsed;

  if (kind === "status") {
    // Boş payload = retained status TEMİZLENDİ, "cihaz çevrimdışı" DEĞİL.
    // Cihaz silinirken clearDeviceTopics boş retained yayınlar; sunucu kendi
    // +/status aboneliğinden bunu geri alır ve buradaki upsert cihazı yeni
    // sildiğimiz halde tekrar yaratırdı.
    if (payload.length === 0) return;
    await handleStatus(deviceId, payload.toString("utf8").trim());
    return;
  }

  let body: unknown;
  try {
    body = JSON.parse(payload.toString("utf8"));
  } catch {
    console.warn(`MQTT geçersiz JSON (${topic})`);
    return;
  }

  if (kind === "health") {
    const result = await ingestHealth(body, { topicDeviceId: deviceId });
    if (!result.ok) {
      console.warn(
        `MQTT sağlık raporu reddedildi (${deviceId}): ${
          result.error === "validation" ? result.detail : "sunucu hatası"
        }`
      );
    }
    return;
  }

  if (kind === "reading") {
    const result = await ingestReading(body, { topicDeviceId: deviceId });
    if (!result.ok) {
      console.warn(
        `MQTT okuma reddedildi (${deviceId}): ${
          result.error === "validation" ? result.detail : "sunucu hatası"
        }`
      );
      return;
    }
    if (!result.inserted) {
      // Kopya, QoS 1'de beklenen trafik. Sürekli tekrarlıyorsa cihazın msg_id
      // sayacı sıfırlanmış olabilir (NVS silinmesi) — o cihaz sessizce veri kaybeder.
      console.warn(`MQTT kopya okuma yok sayıldı (${deviceId})`);
    }
    return;
  }

  // kind === "ack"
  const ack = await applyAck(body);
  if (!ack.ok) {
    console.warn(
      `MQTT ack reddedildi (${deviceId}): ${
        ack.error === "validation" ? ack.detail : "sunucu hatası"
      }`
    );
    return;
  }
  if (ack.status === "applied" && ack.type) {
    // Komut kapandı: o TİPİN retained mesajını temizle ki cihaz yeniden
    // bağlandığında aynı komutu tekrar almasın. Diğer tiplerin bekleyen
    // komutlarına dokunulmaz.
    await clearRetainedCommand(deviceId, ack.type);
  }
}

async function handleStatus(deviceId: string, value: string): Promise<void> {
  const online = value === "online";
  try {
    if (strictDevices()) {
      // Katı modda status mesajı cihaz oluşturmaz; tanımsız cihaz sessizce yok sayılır.
      await pool.query(
        `UPDATE devices SET online = $2, last_seen_at = NOW() WHERE device_id = $1`,
        [deviceId, online]
      );
      return;
    }
    // Upsert: birth mesajı cihazın ilk okumasından ÖNCE gelir, yani cihaz satırı
    // henüz yoktur. Düz UPDATE burada 0 satır etkileyip sessizce kaybolur ve cihaz
    // bir sonraki yeniden bağlanmaya kadar çevrimdışı görünür.
    await pool.query(
      `INSERT INTO devices (device_id, online, last_seen_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (device_id)
       DO UPDATE SET online = EXCLUDED.online, last_seen_at = NOW()`,
      [deviceId, online]
    );
  } catch (err) {
    console.error("MQTT status güncellenemedi:", err);
  }
}

// QoS 1 yayın: PUBACK gelene kadar bekler, zaman aşımında false döner.
function publishAsync(
  client: MqttClient,
  topic: string,
  payload: string,
  opts: { retain?: boolean; expirySec?: number }
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), PUBLISH_TIMEOUT_MS);
    client.publish(
      topic,
      payload,
      {
        qos: 1,
        retain: opts.retain ?? false,
        ...(opts.expirySec
          ? { properties: { messageExpiryInterval: opts.expirySec } }
          : {}),
      },
      (err) => {
        clearTimeout(timer);
        if (err) {
          console.error(`MQTT yayın hatası (${topic}):`, err.message);
          resolve(false);
          return;
        }
        resolve(true);
      }
    );
  });
}

export interface CommandToPublish {
  id: number;
  device_id: string;
  type: CommandType;
  payload: Record<string, number>;
  created_at: string;
}

// Komutu retained olarak yayınla ve başarılıysa 'delivered' işaretle.
// Retained olması poll'ün yerini tutar: cihaz abone olduğu anda güncel komutu alır.
// Topic tip başına ayrı olduğu için yeni bir komut yalnızca KENDİ tipinin retained
// mesajını ezer — device_commands'taki tip-başına-iptal kuralıyla birebir aynı.
export async function publishCommand(cmd: CommandToPublish): Promise<boolean> {
  const client = getMqttClient();
  if (!client) return false;

  const body = JSON.stringify({
    command_id: cmd.id,
    type: cmd.type,
    payload: cmd.payload,
    created_at: cmd.created_at,
  });

  const ok = await publishAsync(client, cmdTopic(cmd.device_id, cmd.type), body, {
    retain: true,
    expirySec: COMMAND_EXPIRY_SEC,
  });
  if (!ok) return false;

  try {
    await pool.query(
      `UPDATE device_commands
       SET status = 'delivered', delivered_at = NOW()
       WHERE id = $1 AND status = 'pending'`,
      [cmd.id]
    );
  } catch (err) {
    console.error("Komut 'delivered' işaretlenemedi:", err);
  }
  return true;
}

// Bir tipin retained komutunu temizle (boş payload = o tipte aktif komut yok).
export async function clearRetainedCommand(
  deviceId: string,
  type: CommandType
): Promise<void> {
  const client = getMqttClient();
  if (!client) return;
  await publishAsync(client, cmdTopic(deviceId, type), "", { retain: true });
}

// Cihaz silinirken brokerdaki tüm retained izlerini temizle: her komut tipinin
// topic'i + status. Aksi halde aynı MAC'le gelen yeni bir cihaz ilk bağlantısında
// eski komutları alır.
export async function clearDeviceTopics(deviceId: string): Promise<void> {
  const client = getMqttClient();
  if (!client) return;
  for (const topic of allCmdTopics(deviceId)) {
    await publishAsync(client, topic, "", { retain: true });
  }
  await publishAsync(client, statusTopic(deviceId), "", { retain: true });
}

// Bağlantı kurulduğunda, broker erişilemezken oluşturulmuş komutları yayınla.
async function sweepPendingCommands(): Promise<void> {
  try {
    const result = await pool.query<CommandToPublish>(
      `SELECT id, device_id, type, payload, created_at
       FROM device_commands
       WHERE status = 'pending'
       ORDER BY created_at ASC, id ASC
       LIMIT 100`
    );
    if (result.rowCount === 0) return;
    console.log(`MQTT bekleyen ${result.rowCount} komut yeniden yayınlanıyor`);
    for (const cmd of result.rows) {
      await publishCommand(cmd);
    }
  } catch (err) {
    console.error("Bekleyen komut süpürmesi hatası:", err);
  }
}

export function mqttHealth() {
  const s = g.__sayacMqtt;
  if (!s) {
    return { enabled: Boolean(process.env.MQTT_URL), connected: false };
  }
  return {
    enabled: true,
    connected: s.client.connected,
    sessionPresent: s.sessionPresent,
    connects: s.connects,
    reconnects: s.reconnects,
    lastConnectAt: s.lastConnectAt,
    lastMessageAt: s.lastMessageAt,
    lastError: s.lastError,
  };
}
