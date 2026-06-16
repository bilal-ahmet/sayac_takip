"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import type { MeterReading } from "@/types";
import { formatTimestamp } from "@/lib/utils";

interface Props {
  readings: MeterReading[];
}

export default function DeltaChart({ readings }: Props) {
  // Okumalar timestamp DESC geliyor; grafik için kronolojik (ASC) sıraya çevir.
  const data = [...readings]
    .sort((a, b) => a.timestamp_unix - b.timestamp_unix)
    .map((r) => ({
      zaman: formatTimestamp(r.timestamp_unix),
      sayac_delta: r.sayac_delta,
      devir_delta: r.devir_delta,
    }));

  if (data.length === 0) {
    return (
      <div className="flex h-72 items-center justify-center rounded-xl border border-zinc-200 bg-white text-sm text-zinc-400 dark:border-zinc-800 dark:bg-zinc-900">
        Grafik için veri yok
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
        Değişim Grafiği (delta)
      </h2>
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
