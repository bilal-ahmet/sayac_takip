import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";
import { canonicalizeDeviceId } from "@/lib/utils";
import type {
  InstallationDetail,
  InstallationPoint,
  WorkOrder,
} from "@/types";

// GET /api/registry?device_id=188B0E88947C
// Cihaz sayfasının envanter bölümünü TEK turda besler.
//
// Her şey MONTAJ NOKTASI etrafında toplanır: cihazın (aktif, yoksa en son) kurulumu
// noktayı belirler, sonra o noktanın tüm kurulum ve iş geçmişi döner. Böylece sayaç
// değişimleri de ESP32 değişimleri de aynı zaman çizelgesinde görünür — adresin
// hikâyesi, tek cihazın değil.
//
// point === null → bu cihaz hiç kurulmamış; arayüz yalnızca "kurulum kaydı oluştur"
// formunu gösterir.

// NUMERIC kolonlar pg'den string olarak gelir (global parser yalnızca BIGINT/oid 20
// için kayıtlı), o yüzden SQL'de ::float8 ile açıkça sayıya çevriliyor.
const INSTALLATION_SELECT = `
  SELECT i.id,
         i.installation_point_id,
         i.meter_id,
         i.device_id,
         i.started_at,
         i.ended_at,
         i.initial_index::float8 AS initial_index,
         i.seal_no,
         i.notes,
         i.opened_by_work_order_id,
         i.closed_by_work_order_id,
         i.created_at,
         m.serial_no,
         m.brand,
         m.model,
         m.pulse_per_unit::float8 AS pulse_per_unit,
         m.tech_label,
         m.notes      AS meter_notes,
         m.created_at AS meter_created_at,
         w.type         AS opened_type,
         w.performed_at AS opened_performed_at,
         p.full_name    AS opened_by_name
  FROM installations i
  JOIN meters      m ON m.id = i.meter_id
  JOIN work_orders w ON w.id = i.opened_by_work_order_id
  JOIN personnel   p ON p.id = w.performed_by_id
  WHERE i.installation_point_id = $1
  ORDER BY i.started_at DESC, i.id DESC`;

interface InstallationRow {
  id: number;
  installation_point_id: number;
  meter_id: number;
  device_id: string | null;
  started_at: string;
  ended_at: string | null;
  initial_index: number | null;
  seal_no: string | null;
  notes: string | null;
  opened_by_work_order_id: number;
  closed_by_work_order_id: number | null;
  created_at: string;
  serial_no: string;
  brand: string | null;
  model: string | null;
  pulse_per_unit: number | null;
  tech_label: string | null;
  meter_notes: string | null;
  meter_created_at: string;
  opened_type: InstallationDetail["opened_by"]["type"];
  opened_performed_at: string;
  opened_by_name: string;
}

function toDetail(r: InstallationRow): InstallationDetail {
  return {
    id: r.id,
    installation_point_id: r.installation_point_id,
    meter_id: r.meter_id,
    device_id: r.device_id,
    started_at: r.started_at,
    ended_at: r.ended_at,
    initial_index: r.initial_index,
    seal_no: r.seal_no,
    notes: r.notes,
    opened_by_work_order_id: r.opened_by_work_order_id,
    closed_by_work_order_id: r.closed_by_work_order_id,
    created_at: r.created_at,
    meter: {
      id: r.meter_id,
      serial_no: r.serial_no,
      brand: r.brand,
      model: r.model,
      pulse_per_unit: r.pulse_per_unit,
      tech_label: r.tech_label,
      notes: r.meter_notes,
      created_at: r.meter_created_at,
    },
    opened_by: {
      performed_by_name: r.opened_by_name,
      performed_at: r.opened_performed_at,
      type: r.opened_type,
    },
  };
}

export async function GET(request: NextRequest) {
  const raw = request.nextUrl.searchParams.get("device_id");
  if (!raw) {
    return NextResponse.json(
      { success: false, error: "device_id zorunlu" },
      { status: 400 }
    );
  }
  // Arayüzden iki noktalı biçim gelebilir; kayıtlarla eşleşsin diye kanoniklestirilir.
  const deviceId = canonicalizeDeviceId(raw);

  try {
    // 1) Cihazın noktasını bul: açık kurulum önce, yoksa en son kapanmış olan.
    const pointRow = await pool.query<{ installation_point_id: number }>(
      `SELECT installation_point_id
       FROM installations
       WHERE device_id = $1
       ORDER BY (ended_at IS NULL) DESC, started_at DESC, id DESC
       LIMIT 1`,
      [deviceId]
    );

    if (pointRow.rowCount === 0) {
      // Hiç kurulmamış cihaz — beklenen durum, hata değil.
      return NextResponse.json({
        success: true,
        point: null,
        current: null,
        installations: [],
        work_orders: [],
      });
    }

    const pointId = pointRow.rows[0].installation_point_id;

    const [point, installations, workOrders] = await Promise.all([
      pool.query<InstallationPoint>(
        `SELECT id, facility_code, address, meter_location, notes, created_at
         FROM installation_points WHERE id = $1`,
        [pointId]
      ),
      pool.query<InstallationRow>(INSTALLATION_SELECT, [pointId]),
      pool.query<WorkOrder>(
        `SELECT w.id, w.installation_point_id, w.type, w.performed_by_id,
                p.full_name AS performed_by_name,
                w.performed_at, w.reason, w.work_done,
                w.old_meter_serial, w.new_meter_serial, w.old_mac, w.new_mac,
                w.new_seal_no, w.notes, w.created_at
         FROM work_orders w
         JOIN personnel p ON p.id = w.performed_by_id
         WHERE w.installation_point_id = $1
         ORDER BY w.performed_at DESC, w.id DESC`,
        [pointId]
      ),
    ]);

    const details = installations.rows.map(toDetail);

    return NextResponse.json({
      success: true,
      point: point.rows[0] ?? null,
      current: details.find((d) => d.ended_at === null) ?? null,
      installations: details,
      work_orders: workOrders.rows,
    });
  } catch (err) {
    console.error("GET /api/registry hata:", err);
    return NextResponse.json(
      { success: false, error: "Sunucu hatası" },
      { status: 500 }
    );
  }
}
