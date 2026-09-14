"use client";

import { useCallback, useEffect, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DeviceHealthResponse } from "@/types";
import { formatDuration, formatTimestamp, rssiQuality } from "@/lib/utils";
import StatsCard from "@/components/StatsCard";

interface Props {
  deviceId: string;
}

const REFRESH_MS = 5_000;

export default function DeviceHealthPanel({ deviceId }: Props) {
  const [data, setData] = useState<DeviceHealthResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/devices/health?device_id=${encodeURIComponent(deviceId)}`
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Sağlık verisi yüklenemedi");
      setData(json);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    }
  }, [deviceId]);

  // Seçili cihaz değişince yükle + 5 sn'de bir tazele (dashboard poll deseni).
  useEffect(() => {
    // setState fetch await'inden SONRA çalışır — set-state-in-effect uyarısı geçersiz.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    const id = setInterval(load, REFRESH_MS);
    return () => clearInterval(id);
  }, [load]);

  const latest = data?.latest ?? null;
  const online = data?.online ?? false;
  const quality = rssiQuality(latest?.rssi);

  // RSSI trendi: API en yeni önce döner; grafik için kronolojik (ASC) sıraya çevir.
  const chartData = [...(data?.history ?? [])]
    .filter((h) => h.rssi != null)
    .sort(
      (a, b) =>
        new Date(a.reported_at).getTime() - new Date(b.reported_at).getTime()
    )
    .map((h) => ({
      zaman: new Date(h.reported_at).toLocaleTimeString("tr-TR"),
      rssi: h.rssi,
    }));

  // Son hata olayları (error dolu satırlar).
  const errorEvents = (data?.history ?? []).filter((h) => h.error != null);

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Durum kutucukları */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-3">
        <StatsCard
          label="Bağlantı Durumu"
          value={online ? "Çevrimiçi" : "Çevrimdışı"}
          valueClassName={online ? "text-emerald-500" : "text-red-500"}
          subtitle={
            data?.last_seen_unix != null
              ? `Son görülme: ${formatTimestamp(data.last_seen_unix)}`
              : "henüz veri yok"
          }
        />
        <StatsCard
          label="RSSI"
          value={latest?.rssi != null ? `${latest.rssi} dBm` : "—"}
          valueClassName={quality.colorClass}
          subtitle={quality.label}
        />
        <StatsCard
          label="Sinyal Kalitesi"
          value={
            latest?.signal_quality != null
              ? `${latest.signal_quality}%`
              : quality.label
          }
        />
        <StatsCard
          label="Çalışma Süresi"
          value={
            latest?.uptime_sec != null ? formatDuration(latest.uptime_sec) : "—"
          }
        />
        <StatsCard
          label="Hata Durumu"
          value={latest?.error != null ? "Hata var" : "Sorun yok"}
          valueClassName={
            latest?.error != null ? "text-red-500" : "text-emerald-500"
          }
          subtitle={latest?.error ?? undefined}
        />
      </section>

      {/* RSSI trend grafiği */}
      <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <h2 className="mb-4 text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          RSSI Trendi (dBm)
        </h2>
        {chartData.length === 0 ? (
          <div className="flex h-72 items-center justify-center text-sm text-zinc-400">
            Grafik için veri yok
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={288}>
            <LineChart
              data={chartData}
              margin={{ top: 8, right: 16, bottom: 8, left: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#e4e4e7" />
              <XAxis
                dataKey="zaman"
                tick={{ fontSize: 11 }}
                minTickGap={24}
                stroke="#a1a1aa"
              />
              <YAxis
                tick={{ fontSize: 11 }}
                stroke="#a1a1aa"
                allowDecimals={false}
                domain={["dataMin - 5", "dataMax + 5"]}
              />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8 }}
                formatter={(value) => [value, "RSSI"]}
              />
              <Line
                type="monotone"
                dataKey="rssi"
                stroke="#6366f1"
                strokeWidth={2}
                dot={{ r: 2 }}
                connectNulls
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Son hata/olay listesi */}
      <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
            Son Hata Olayları
          </h2>
        </div>
        <div className="p-4">
          {errorEvents.length === 0 ? (
            <p className="text-sm text-zinc-400">Kayıtlı hata yok.</p>
          ) : (
            <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {errorEvents.map((h) => (
                <li
                  key={h.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-red-200 px-3 py-2 dark:border-red-900/50"
                >
                  <span className="min-w-0 truncate text-xs text-red-700 dark:text-red-300">
                    {h.error}
                  </span>
                  <span className="shrink-0 text-xs text-zinc-400">
                    {new Date(h.reported_at).toLocaleString("tr-TR", {
                      timeZone: "Europe/Istanbul",
                    })}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
