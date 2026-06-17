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

    // 1) Cihaz yoksa ekle (idempotent).
    await client.query(
      `INSERT INTO devices (device_id) VALUES ($1)
       ON CONFLICT (device_id) DO NOTHING`,
      [deviceId]
    );

    // 2) Bu cihazın son okumasını al (delta için).
    const prev = await client.query<{ sayac: number; devir: number }>(
      `SELECT sayac, devir
       FROM meter_readings
       WHERE device_id = $1
       ORDER BY timestamp_unix DESC
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
         (device_id, timestamp_unix, sayac, devir, baslangic, toplam, sayac_delta, devir_delta)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [deviceId, timestamp, sayac, devir, baslangic, toplam, sayacDelta, devirDelta]
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

// GET /api/readings?device_id=...&limit=100&from=...&to=...
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const deviceId = params.get("device_id");

  if (!deviceId) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }

  // limit parametresi verilmezse sınır uygulanmaz (tüm kayıtlar döner).
  const limitParam = params.get("limit");
  const limitRaw = Number(limitParam);
  const hasLimit = limitParam !== null && Number.isFinite(limitRaw) && limitRaw > 0;

  const from = params.get("from");
  const to = params.get("to");

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

  let limitClause = "";
  if (hasLimit) {
    values.push(Math.min(limitRaw, 10000));
    limitClause = `LIMIT $${values.length}`;
  }

  try {
    const result = await pool.query<MeterReading>(
      `SELECT id, device_id, timestamp_unix, recorded_at,
              sayac, devir, baslangic, toplam, sayac_delta, devir_delta
       FROM meter_readings
       WHERE ${where}
       ORDER BY timestamp_unix DESC
       ${limitClause}`,
      values
    );

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
