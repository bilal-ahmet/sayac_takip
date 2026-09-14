// MQTT topic şeması — tek kaynak. Publisher, subscriber ve simülatör aynı
// fonksiyonları kullanır ki topic string'leri aralarında kaymasın.
//
//   sayac/{deviceId}/reading   cihaz → sunucu, QoS 1, retain YOK
//   sayac/{deviceId}/ack       cihaz → sunucu, QoS 1, retain YOK
//   sayac/{deviceId}/cmd       sunucu → cihaz, QoS 1, RETAINED
//   sayac/{deviceId}/status    cihaz → sunucu, RETAINED (birth "online" / LWT "offline")

export const TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX ?? "sayac";

export type TopicKind = "reading" | "ack" | "cmd" | "status";

export function readingTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/reading`;
}

export function ackTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/ack`;
}

export function cmdTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/cmd`;
}

export function statusTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/status`;
}

// Sunucunun abone olduğu filtreler.
export function subscriptions(): string[] {
  return [
    `${TOPIC_PREFIX}/+/reading`,
    `${TOPIC_PREFIX}/+/ack`,
    `${TOPIC_PREFIX}/+/status`,
  ];
}

// Gelen bir topic'i ayrıştır. Şekil uymuyorsa null döner.
// Dönen deviceId, payload'daki "Device Id" ile karşılaştırılarak bütünlük
// kontrolü yapılır (paylaşımlı broker kimliğinde tek gerçek kontrol budur).
export function parseTopic(
  topic: string
): { deviceId: string; kind: TopicKind } | null {
  const parts = topic.split("/");
  if (parts.length !== 3) return null;
  const [prefix, deviceId, kind] = parts;
  if (prefix !== TOPIC_PREFIX) return null;
  if (!deviceId) return null;
  if (kind !== "reading" && kind !== "ack" && kind !== "cmd" && kind !== "status") {
    return null;
  }
  return { deviceId, kind };
}
