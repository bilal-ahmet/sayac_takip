import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { isApiKeyValid } from "@/lib/auth";
import { ingestReading } from "@/lib/ingest";
import type { MeterReading } from "@/types";

// POST /api/readings — IoT cihazdan okuma alır, delta hesaplar, kaydeder.
// İş mantığı @/lib/ingest içindedir; MQTT yolu da aynı fonksiyonu çağırır.
export async function POST(request: NextRequest) {
  // Opsiyonel güvenlik anahtarı doğrulaması (API_SECRET_KEY tanımlıysa).
  if (!isApiKeyValid(request)) {
    return NextResponse.json(
      { success: false, error: "Yetkisiz" },
      { status: 401 }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const result = await ingestReading(body);

  if (!result.ok) {
    return result.error === "validation"
      ? NextResponse.json({ success: false, error: result.detail }, { status: 400 })
      : NextResponse.json(
          { success: false, error: "Sunucu hatası" },
          { status: 500 }
        );
  }

  // Kopya (aynı msg_id): hata değil, cihaz yeniden denemesin diye başarı döner.
  if (!result.inserted) {
    return NextResponse.json({ success: true, duplicate: true });
  }

  return NextResponse.json({
    success: true,
    id: result.id,
    sayac_delta: result.sayac_delta,
    devir_delta: result.devir_delta,
  });
}

// Filtre modunda taranan satır sayısı için üst sınır (egress güvenlik tavanı).
const FILTER_CAP = 10000;
// Canlı modda (filtre yokken) varsayılan satır limiti.
const DEFAULT_LIMIT = 200;

// GET /api/readings?device_id=...&limit=200&from=...&to=...
//   &delta_col=sayac|devir&delta_threshold=N&only_gaps=1&timeout_sec=N
//
// İki mod vardır:
//  - Canlı mod (filtre yok): son N satır + her satır için pencere-içi gap_sec.
//  - Filtre modu (delta_threshold>0 veya only_gaps): TÜM geçmiş LAG ile taranır,
//    sadece eşleşen satırlar döner (en fazla FILTER_CAP). Egress bu sayede düşük kalır.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const deviceId = params.get("device_id");

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  // ?versions=1 → bu cihazın okumalarında geçen benzersiz firmware sürümleri.
  // Firmware filtre dropdown'unu cihaz-başına beslemek için (yan etki yok).
  if (params.get("versions") === "1") {
    try {
      const result = await pool.query<{ fw_version: string }>(
        `SELECT DISTINCT fw_version
         FROM meter_readings
         WHERE device_id = $1 AND fw_version IS NOT NULL
         ORDER BY fw_version`,
        [deviceId]
      );
      return NextResponse.json({
        success: true,
        versions: result.rows.map((r) => r.fw_version),
      });
    } catch (err) {
      console.error("GET /api/readings?versions hata:", err);
      return NextResponse.json(
        { success: false, error: "Sunucu hatası" },
        { status: 500 }
      );
    }
  }

  const from = params.get("from");
  const to = params.get("to");
  // Firmware sürümü filtresi (opsiyonel): sadece o versiyonda alınmış okumalar döner.
  const fwVersion = params.get("fw_version");
  // delta_col yalnızca iki sabit kolona izin verir (SQL'e gömülür, injection yok).
  const deltaCol = params.get("delta_col") === "devir" ? "devir_delta" : "sayac_delta";
  const deltaThreshold = Number(params.get("delta_threshold")) || 0;
  const timeoutSec = Number(params.get("timeout_sec")) || 0;
  const onlyGaps = params.get("only_gaps") === "1";

  const filterActive = deltaThreshold > 0 || (onlyGaps && timeoutSec > 0);

  // device_id + opsiyonel tarih aralığı: her iki modda ortak WHERE.
  const values: (string | number)[] = [deviceId];
  let where = "device_id = $1";
  if (from) {
    values.push(Number(from));
    where += ` AND timestamp_unix >= $${values.length}`;
  }
  if (to) {
    values.push(Number(to));
    where += ` AND timestamp_unix <= $${values.length}`;
  }
  if (fwVersion) {
    values.push(fwVersion);
    where += ` AND fw_version = $${values.length}`;
  }

  let sql: string;

  if (!filterActive) {
    // Canlı mod: son N satırı al, gap_sec'i bu pencere içinde LAG ile hesapla.
    // Tüm tabloyu taramaz; yalnızca en yeni N satırı indeksle çeker.
    //   all=1 → CSV dışa aktarımı için tüm geçmiş döner (LIMIT yok).
    const all = params.get("all") === "1";
    let innerLimit = "";
    if (!all) {
      const limitParam = params.get("limit");
      const limitRaw = Number(limitParam);
      const limit =
        limitParam !== null && Number.isFinite(limitRaw) && limitRaw > 0
          ? Math.min(limitRaw, FILTER_CAP)
          : DEFAULT_LIMIT;
      values.push(limit);
      innerLimit = `LIMIT $${values.length}`;
    }
    sql = `
      SELECT w.*,
             timestamp_unix - LAG(timestamp_unix)
               OVER (ORDER BY timestamp_unix ASC, id ASC) AS gap_sec
      FROM (
        SELECT id, device_id, timestamp_unix, recorded_at,
               sayac, devir, baslangic, toplam, period, threshold_y, mid_y,
               sayac_delta, devir_delta, time_synced, fw_version
        FROM meter_readings
        WHERE ${where}
        ORDER BY timestamp_unix DESC, id DESC
        ${innerLimit}
      ) w
      ORDER BY timestamp_unix DESC, id DESC`;
  } else {
    // Filtre modu: TÜM geçmişi LAG ile tara, filtreleri uygula, eşleşenleri döndür.
    const conds: string[] = [];
    if (deltaThreshold > 0) {
      values.push(deltaThreshold);
      conds.push(`ABS(${deltaCol}) > $${values.length}`);
    }
    if (onlyGaps && timeoutSec > 0) {
      values.push(timeoutSec);
      conds.push(`gap_sec > $${values.length}`);
    }
    const filterWhere = conds.length > 0 ? `WHERE ${conds.join(" AND ")}` : "";
    sql = `
      WITH ordered AS (
        SELECT id, device_id, timestamp_unix, recorded_at,
               sayac, devir, baslangic, toplam, period, threshold_y, mid_y,
               sayac_delta, devir_delta, time_synced, fw_version,
               timestamp_unix - LAG(timestamp_unix)
                 OVER (ORDER BY timestamp_unix ASC, id ASC) AS gap_sec
        FROM meter_readings
        WHERE ${where}
      )
      SELECT * FROM ordered
      ${filterWhere}
      ORDER BY timestamp_unix DESC, id DESC
      LIMIT ${FILTER_CAP}`;
  }

  try {
    const result = await pool.query<MeterReading>(sql, values);
    return NextResponse.json({ success: true, readings: result.rows });
  } catch (err) {
    console.error("GET /api/readings hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}

// DELETE /api/readings?device_id=... — o cihaza ait tüm okumaları siler.
export async function DELETE(request: NextRequest) {
  const deviceId = request.nextUrl.searchParams.get("device_id");

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      "DELETE FROM meter_readings WHERE device_id = $1",
      [deviceId]
    );
    // Okumalar silindiğine göre cihazın özet sayaçları da sıfırlanmalı.
    await client.query(
      `UPDATE devices
       SET reading_count = 0, last_timestamp_unix = NULL
       WHERE device_id = $1`,
      [deviceId]
    );
    await client.query("COMMIT");
    return NextResponse.json({
      success: true,
      deleted: result.rowCount,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("DELETE /api/readings hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
