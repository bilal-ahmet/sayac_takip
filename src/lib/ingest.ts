import pool from "@/lib/db";
import { normalizeDeviceId } from "@/lib/utils";
import type { IncomingReading } from "@/types";

// Transport'tan bağımsız ingest çekirdeği. Hem HTTP route'ları hem MQTT mesaj
// yönlendiricisi bu iki fonksiyonu çağırır; böylece iki yolun ürettiği satırlar
// inşa gereği aynı olur ve HTTP kaldırıldığında mantık tek yerde kalır.

export type IngestResult =
  | {
      ok: true;
      inserted: true;
      id: number;
      device_id: string;
      sayac_delta: number | null;
      devir_delta: number | null;
    }
  | { ok: true; inserted: false; reason: "duplicate"; device_id: string }
  | { ok: false; error: "validation"; detail: string }
  | { ok: false; error: "server" };

export type AckResult =
  | {
      ok: true;
      // "ignored": komut yok, başka cihaza ait ya da zaten kapanmış.
      status: "applied" | "failed" | "ignored";
      device_id: string;
      command_id: number;
    }
  | { ok: false; error: "validation"; detail: string }
  | { ok: false; error: "server" };

interface AckBody {
  device_id?: string;
  "Device Id"?: string;
  command_id?: number;
  ok?: boolean;
  error?: string;
}

// Bir okumayı doğrula, delta'sını hesapla ve kaydet.
// opts.topicDeviceId (MQTT): topic'ten çıkan cihaz id'si. Payload'daki id ile
// eşleşmezse reddedilir — paylaşımlı broker kimliğinde tek gerçek bütünlük kontrolü.
export async function ingestReading(
  raw: unknown,
  opts?: { topicDeviceId?: string }
): Promise<IngestResult> {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "validation", detail: "Gövde bir JSON nesnesi olmalı" };
  }
  const body = raw as IncomingReading;

  const deviceId = normalizeDeviceId(body);
  const { timestamp, sayac, devir, baslangic } = body;
  // Opsiyonel alanlar: sayı değilse null kaydedilir.
  const toplam = typeof body.toplam === "number" ? body.toplam : null;
  const period = typeof body.period === "number" ? body.period : null;
  // Cihazın süreden türetip bildirdiği güncel kalibrasyon değerleri (opsiyonel).
  // Boşluklu anahtarlar "Device Id" deseniyle köşeli parantezle okunur.
  const thresholdY =
    typeof body["Threshold y"] === "number" ? body["Threshold y"] : null;
  const midY = typeof body["Mid y"] === "number" ? body["Mid y"] : null;
  const fwVersion =
    typeof body.fw_version === "string" && body.fw_version.trim() !== ""
      ? body.fw_version.trim()
      : null;
  // msg_id opsiyonel: yoksa dedup devre dışı kalır (cihaz susmaktansa yazsın).
  const msgId =
    typeof body.msg_id === "number" && Number.isFinite(body.msg_id)
      ? Math.trunc(body.msg_id)
      : null;

  // Cihaz saati senkron mu? time_synced 0/false veya timestamp geçersiz/0 ise değil.
  // Cihaz bu alanı integer (1/0) ya da boolean (true/false) gönderebilir; ikisi de
  // desteklenir. Senkron değilse timestamp_unix'i sunucu kendi saatiyle ikame eder;
  // böylece sıralama/delta/grafik mantığı 1970'e düşen bir kayıtla bozulmaz.
  const synced =
    body.time_synced !== 0 &&
    body.time_synced !== false &&
    typeof timestamp === "number" &&
    timestamp > 0;
  const effectiveTs = synced ? timestamp : Math.floor(Date.now() / 1000);

  if (
    !deviceId ||
    typeof timestamp !== "number" ||
    typeof sayac !== "number" ||
    typeof devir !== "number" ||
    typeof baslangic !== "number"
  ) {
    return {
      ok: false,
      error: "validation",
      detail:
        "Eksik veya hatalı alan: Device Id, timestamp, sayac, devir, baslangic zorunlu",
    };
  }

  if (opts?.topicDeviceId && opts.topicDeviceId !== deviceId) {
    return {
      ok: false,
      error: "validation",
      detail: `Topic cihaz id'si (${opts.topicDeviceId}) payload'daki id ile uyuşmuyor (${deviceId})`,
    };
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // Aynı cihazdan eşzamanlı iki okuma aynı öncül satırı okuyup aynı delta'yı
    // hesaplamasın. Cihaz başına serileştirir; farklı cihazlar birbirini beklemez.
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [deviceId]);

    // 1) Cihaz yoksa ekle; varsa firmware sürümünü güncelle (en son bildirilen).
    //    fw_version null gelirse mevcut değer korunur (COALESCE). RETURNING ile
    //    cihazın güncel sürümü alınır; okuma satırı bunu kullanır.
    const dev = await client.query<{ fw_version: string | null }>(
      `INSERT INTO devices (device_id, fw_version) VALUES ($1, $2)
       ON CONFLICT (device_id)
       DO UPDATE SET fw_version = COALESCE(EXCLUDED.fw_version, devices.fw_version)
       RETURNING fw_version`,
      [deviceId, fwVersion]
    );
    const effectiveFw = dev.rows[0]?.fw_version ?? null;

    // 2) Öncül okuma = gelen timestamp'ten küçük-eşit EN YENİ satır.
    //    Koşulsuz "en yeni satır" almak, tampondan sıra dışı boşaltılan okumalarda
    //    negatif çöp delta üretirdi.
    const prev = await client.query<{ sayac: number; devir: number }>(
      `SELECT sayac, devir
       FROM meter_readings
       WHERE device_id = $1 AND timestamp_unix <= $2
       ORDER BY timestamp_unix DESC, id DESC
       LIMIT 1`,
      [deviceId, effectiveTs]
    );

    // 3) Delta hesapla (ilk okumada null).
    const sayacDelta = prev.rows.length > 0 ? sayac - prev.rows[0].sayac : null;
    const devirDelta = prev.rows.length > 0 ? devir - prev.rows[0].devir : null;

    // 4) Okumayı kaydet. msg_id doluysa kısmi unique indeks kopyayı engeller.
    //    QoS 1 en-az-bir-kez olduğu için kopya MQTT'de beklenen trafiktir.
    const inserted = await client.query<{ id: number }>(
      `INSERT INTO meter_readings
         (device_id, timestamp_unix, sayac, devir, baslangic, toplam, period,
          threshold_y, mid_y, sayac_delta, devir_delta, time_synced, fw_version, msg_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       ON CONFLICT (device_id, msg_id) WHERE msg_id IS NOT NULL DO NOTHING
       RETURNING id`,
      [
        deviceId,
        effectiveTs,
        sayac,
        devir,
        baslangic,
        toplam,
        period,
        thresholdY,
        midY,
        sayacDelta,
        devirDelta,
        synced,
        effectiveFw,
        msgId,
      ]
    );

    if (inserted.rowCount === 0) {
      await client.query("ROLLBACK");
      return { ok: true, inserted: false, reason: "duplicate", device_id: deviceId };
    }

    const newId = inserted.rows[0].id;

    // 5) Cihaz özet sayaçlarını güncelle. GET /api/devices bunları okur; aksi halde
    //    her 5 saniyede tüm meter_readings üzerinde COUNT() çalıştırmak gerekirdi.
    //    GREATEST: sıra dışı gelen eski bir okuma son zaman damgasını geri almasın.
    await client.query(
      `UPDATE devices
       SET reading_count = reading_count + 1,
           last_timestamp_unix = GREATEST(COALESCE(last_timestamp_unix, 0), $2)
       WHERE device_id = $1`,
      [deviceId, effectiveTs]
    );

    // 6) Ardıl onarımı: bu satır sıra dışı geldiyse, kendisinden sonraki ilk
    //    okumanın delta'sı artık yanlıştır (öncülü değişti). Aynı transaction
    //    içinde düzeltilir; delta zinciri her varış sırasında kendini onarır.
    const next = await client.query<{ id: number; sayac: number; devir: number }>(
      `SELECT id, sayac, devir
       FROM meter_readings
       WHERE device_id = $1
         AND (timestamp_unix > $2 OR (timestamp_unix = $2 AND id > $3))
       ORDER BY timestamp_unix ASC, id ASC
       LIMIT 1`,
      [deviceId, effectiveTs, newId]
    );
    const successor = next.rows[0];
    if (successor) {
      await client.query(
        `UPDATE meter_readings
         SET sayac_delta = $1, devir_delta = $2
         WHERE id = $3`,
        [successor.sayac - sayac, successor.devir - devir, successor.id]
      );
    }

    await client.query("COMMIT");

    return {
      ok: true,
      inserted: true,
      id: newId,
      device_id: deviceId,
      sayac_delta: sayacDelta,
      devir_delta: devirDelta,
    };
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("ingestReading hata:", err);
    return { ok: false, error: "server" };
  } finally {
    client.release();
  }
}

// Cihazın komut ACK'ini uygula.
//   ok=true  → applied (applied_at damgalanır)
//   ok=false → failed (error dolu)
// Statü koruması: yalnızca açık bir komut kapatılabilir. Böylece geç gelen bir ACK
// 'cancelled' bir komutu 'applied'a çeviremez; ama başarısız olup sonra başaran bir
// deneme failed → applied geçişini yapabilir.
export async function applyAck(raw: unknown): Promise<AckResult> {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, error: "validation", detail: "Gövde bir JSON nesnesi olmalı" };
  }
  const body = raw as AckBody;

  const rawId = body.device_id ?? body["Device Id"];
  const deviceId = typeof rawId === "string" ? rawId.trim() : undefined;
  const commandId = body.command_id;
  const ok = body.ok;

  if (!deviceId || typeof commandId !== "number" || typeof ok !== "boolean") {
    return {
      ok: false,
      error: "validation",
      detail: "Device Id, command_id (sayı) ve ok (boolean) zorunlu",
    };
  }

  const errorMsg =
    !ok && typeof body.error === "string" ? body.error.slice(0, 1000) : null;
  const newStatus = ok ? "applied" : "failed";

  try {
    const result = await pool.query<{ status: string }>(
      `UPDATE device_commands
       SET status = $1,
           applied_at = CASE WHEN $1 = 'applied' THEN NOW() ELSE applied_at END,
           error = $2
       WHERE id = $3 AND device_id = $4
         AND status IN ('pending', 'delivered', 'failed')
       RETURNING status`,
      [newStatus, errorMsg, commandId, deviceId]
    );

    if (result.rowCount === 0) {
      // Komut yok, başka cihaza ait ya da zaten kapanmış. MQTT'de kopya ACK normal
      // trafiktir; hata dönmek brokerın sonsuza dek yeniden göndermesine yol açar.
      return { ok: true, status: "ignored", device_id: deviceId, command_id: commandId };
    }

    return {
      ok: true,
      status: result.rows[0].status as "applied" | "failed",
      device_id: deviceId,
      command_id: commandId,
    };
  } catch (err) {
    console.error("applyAck hata:", err);
    return { ok: false, error: "server" };
  }
}
