import { COMMAND_TYPES, type CommandType } from "@/types";

// MQTT topic şeması — tek kaynak. Publisher, subscriber ve simülatör aynı
// fonksiyonları kullanır ki topic string'leri aralarında kaymasın.
//
//   sayac/{deviceId}/reading      cihaz → sunucu, QoS 1, retain YOK
//   sayac/{deviceId}/health       cihaz → sunucu, QoS 1, retain YOK
//   sayac/{deviceId}/ack          cihaz → sunucu, QoS 1, retain YOK
//   sayac/{deviceId}/status       cihaz → sunucu, RETAINED (birth "online" / LWT "offline")
//   sayac/{deviceId}/cmd/{type}   sunucu → cihaz, QoS 1, RETAINED
//
// Komut topic'i neden TİP BAŞINA ayrı:
// device_commands'ta iptal kuralı cihaz başına değil, TİP başına tek güncel hedef
// ("bir set_counter göndermek bekleyen kalibrasyonu geçersiz kılmasın"). Tek bir
// retained topic kullanılsaydı yeni bir komut brokerdaki farklı tipteki komutu
// ezerdi — yani DB'de kasıtlı olarak engellenen şey broker tarafında geri gelirdi.
// Tip başına ayrı slot, retained semantiğini DB semantiğiyle birebir örtüştürür.

export const TOPIC_PREFIX = process.env.MQTT_TOPIC_PREFIX ?? "sayac";

export type DeviceTopicKind = "reading" | "health" | "ack" | "status";

export function readingTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/reading`;
}

export function healthTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/health`;
}

export function ackTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/ack`;
}

export function statusTopic(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/status`;
}

export function cmdTopic(deviceId: string, type: CommandType | string): string {
  return `${TOPIC_PREFIX}/${deviceId}/cmd/${type}`;
}

// Bir cihazın tüm komut topic'leri — cihaz silinirken hepsini temizlemek için.
export function allCmdTopics(deviceId: string): string[] {
  return COMMAND_TYPES.map((t) => cmdTopic(deviceId, t));
}

// Sunucunun abone olduğu filtreler. cmd YOK: sunucu yayınlar, dinlemez.
export function subscriptions(): string[] {
  return [
    `${TOPIC_PREFIX}/+/reading`,
    `${TOPIC_PREFIX}/+/health`,
    `${TOPIC_PREFIX}/+/ack`,
    `${TOPIC_PREFIX}/+/status`,
  ];
}

// Cihazın abone olduğu filtre (firmware sözleşmesinde geçer).
export function deviceCmdFilter(deviceId: string): string {
  return `${TOPIC_PREFIX}/${deviceId}/cmd/+`;
}

// Gelen bir topic'i ayrıştır. Şekil uymuyorsa null döner. Dönen deviceId,
// payload'daki "Device Id" ile karşılaştırılarak bütünlük kontrolü yapılır
// (paylaşımlı broker kimliğinde tek gerçek kontrol budur).
export function parseTopic(
  topic: string
): { deviceId: string; kind: DeviceTopicKind } | null {
  const parts = topic.split("/");
  if (parts.length !== 3) return null; // cmd (4 segment) sunucuya gelmez
  const [prefix, deviceId, kind] = parts;
  if (prefix !== TOPIC_PREFIX || !deviceId) return null;
  if (kind !== "reading" && kind !== "health" && kind !== "ack" && kind !== "status") {
    return null;
  }
  return { deviceId, kind };
}
