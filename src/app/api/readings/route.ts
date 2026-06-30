import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { normalizeDeviceId } from "@/lib/utils";
import type { IncomingReading, MeterReading } from "@/types";

// POST /api/readings — IoT cihazdan okuma alır, delta hesaplar, kaydeder.
export async function POST(request: NextRequest) {
  // Opsiyonel güvenlik anahtarı doğrulaması (API_SECRET_KEY tanımlıysa).
  const secret = process.env.API_SECRET_KEY;
  if (secret) {
    const provided = request.headers.get("x-api-key");
    if (provided !== secret) {
      return NextResponse.json(
        { success: false, error: "Yetkisiz" },
        { status: 401 }
      );
    }
  }

  let body: IncomingReading;
  try {
    body = (await request.json()) as IncomingReading;
  } catch {
    return NextResponse.json(
      { success: false, error: "Geçersiz JSON" },
      { status: 400 }
    );
  }

  const deviceId = normalizeDeviceId(body);
  const { timestamp, sayac, devir, baslangic } = body;
  // toplam opsiyonel: sayı değilse null kaydedilir.
  const toplam = typeof body.toplam === "number" ? body.toplam : null;
  // period (geçen süre, saniye) opsiyonel: sayı değilse null kaydedilir.
  const period = typeof body.period === "number" ? body.period : null;
  // fw_version cihaz başına sabit bilgidir; okuma satırına değil devices'a yazılır.
  const fwVersion =
    typeof body.fw_version === "string" && body.fw_version.trim() !== ""
      ? body.fw_version.trim()
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
    return NextResponse.json(
      {
        success: false,
        error:
          "Eksik veya hatalı alan: Device Id, timestamp, sayac, devir, baslangic zorunlu",
      },
      { status: 400 }
    );
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1) Cihaz yoksa ekle; varsa firmware sürümünü güncelle (en son bildirilen).
    //    fw_version null gelirse mevcut değer korunur (COALESCE).
    await client.query(
      `INSERT INTO devices (device_id, fw_version) VALUES ($1, $2)
       ON CONFLICT (device_id)
       DO UPDATE SET fw_version = COALESCE(EXCLUDED.fw_version, devices.fw_version)`,
      [deviceId, fwVersion]
    );

    // 2) Bu cihazın son okumasını al (delta için).
    const prev = await client.query<{ sayac: number; devir: number }>(
      `SELECT sayac, devir
       FROM meter_readings
       WHERE device_id = $1
       ORDER BY timestamp_unix DESC, id DESC
       LIMIT 1`,
      [deviceId]
    );

    // 3) Delta hesapla (ilk okumada null).
    const sayacDelta =
      prev.rows.length > 0 ? sayac - prev.rows[0].sayac : null;
    const devirDelta =
      prev.rows.length > 0 ? devir - prev.rows[0].devir : null;

    // 4) Okumayı kaydet.
    const inserted = await client.query<MeterReading>(
      `INSERT INTO meter_readings
         (device_id, timestamp_unix, sayac, devir, baslangic, toplam, period, sayac_delta, devir_delta, time_synced)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [deviceId, effectiveTs, sayac, devir, baslangic, toplam, period, sayacDelta, devirDelta, synced]
    );

    await client.query("COMMIT");

    return NextResponse.json({
      success: true,
      id: inserted.rows[0].id,
      sayac_delta: sayacDelta,
      devir_delta: devirDelta,
    });
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("POST /api/readings hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  } finally {
    client.release();
  }
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

  const from = params.get("from");
  const to = params.get("to");
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
               sayac, devir, baslangic, toplam, period,
               sayac_delta, devir_delta, time_synced
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
               sayac, devir, baslangic, toplam, period,
               sayac_delta, devir_delta, time_synced,
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

  try {
    const result = await pool.query(
      "DELETE FROM meter_readings WHERE device_id = $1",
      [deviceId]
    );
    return NextResponse.json({
      success: true,
      deleted: result.rowCount,
    });
  } catch (err) {
    console.error("DELETE /api/readings hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
