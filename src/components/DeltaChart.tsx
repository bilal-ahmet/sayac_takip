"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { MeterReading, InstallationPeriod } from "@/types";
import { formatTimestamp } from "@/lib/utils";

interface Props {
  readings: MeterReading[];
  // Kurulum dönemleri (varsa). Her dönem başlangıcına dikey işaret çizilir.
  periods?: InstallationPeriod[];
}

export default function DeltaChart({ readings, periods = [] }: Props) {
  // Okumalar timestamp DESC geliyor; grafik için kronolojik (ASC) sıraya çevir.
  const sorted = [...readings].sort((a, b) => a.timestamp_unix - b.timestamp_unix);

  const data = sorted.map((r) => ({
    zaman: formatTimestamp(r.timestamp_unix),
    sayac_delta: r.sayac_delta,
    devir_delta: r.devir_delta,
  }));

  // X ekseni KATEGORİ ekseni (biçimlenmiş zaman metni), sürekli bir zaman ekseni
  // değil. Bu yüzden ReferenceLine'a ham tarih verilemez; sınırı, o andan sonraki
  // İLK OKUMANIN kategori değerine oturtuyoruz.
  //
  // Eşleştirme recorded_at (sunucu saati) üzerinden yapılır, timestamp_unix
  // üzerinden değil: ikincisi cihazdan gelir ve time_synced false iken ikame edilir,
  // yani 1970'e düşüp her aralığın dışında kalabilir.
  const markers = periods
    .map((p) => {
      const from = new Date(p.started_at).getTime();
      const idx = sorted.findIndex(
        (r) => new Date(r.recorded_at).getTime() >= from
      );
      // Dönem tüm veriden önce başlamışsa işaret gerekmez (grafiğin tamamı o döneme ait).
      if (idx <= 0) return null;
      return { x: data[idx].zaman, serial: p.serial_no };
    })
    .filter((m): m is { x: string; serial: string } => m !== null);

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        Grafik için veri yok
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Değişim Grafiği (delta)
        </h2>
        {markers.length > 0 && (
          // Sayaç değişiminden sonra delta SÜREKLİ görünür ama fiziksel anlamı
          // değişmiştir (yeni sayacın darbe sabiti farklı olabilir). İşaretler
          // bu süreksizliği görünür kılıyor.
          <span className="text-xs text-amber-600 dark:text-amber-400">
            ⟂ kurulum değişimi · öncesi ve sonrası fiziksel olarak karşılaştırılamaz
          </span>
        )}
      </div>
      <ResponsiveContainer width="100%" height={288}>
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
          <XAxis
            dataKey="zaman"
            tick={{ fontSize: 11 }}
            minTickGap={24}
            stroke="#a1a1aa"
          />
          <YAxis tick={{ fontSize: 11 }} stroke="#a1a1aa" allowDecimals={false} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(value, name) => [
              value,
              name === "sayac_delta" ? "Sayaç Δ" : "Devir Δ",
            ]}
          />
          <Legend
            formatter={(value) =>
              value === "sayac_delta" ? "Sayaç Δ" : "Devir Δ"
            }
            wrapperStyle={{ fontSize: 12 }}
          />
          {markers.map((m, i) => (
            <ReferenceLine
              key={`${m.x}-${i}`}
              x={m.x}
              stroke="#f59e0b"
              strokeDasharray="4 3"
              label={{
                value: m.serial,
                position: "top",
                fontSize: 10,
                fill: "#f59e0b",
              }}
            />
          ))}
          <Line
            type="monotone"
            dataKey="sayac_delta"
            stroke="#10b981"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
          />
          <Line
            type="monotone"
            dataKey="devir_delta"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 2 }}
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
