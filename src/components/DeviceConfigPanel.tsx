"use client";

import { useState } from "react";
import type { DeviceCommand, MeterReading, CommandStatus } from "@/types";
import { formatTimestamp } from "@/lib/utils";

interface Props {
  deviceId: string;
  latest: MeterReading | null;
  commands: DeviceCommand[];
  onChanged: () => void; // başarılı komut sonrası listeyi tazelemek için
}

// Komut durumuna göre rozet rengi.
const STATUS_STYLE: Record<CommandStatus, string> = {
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  delivered:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  applied:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_LABEL: Record<CommandStatus, string> = {
  pending: "bekliyor",
  delivered: "iletildi",
  applied: "uygulandı",
  failed: "başarısız",
  cancelled: "iptal",
};

export default function DeviceConfigPanel({
  deviceId,
  latest,
  commands,
  onChanged,
}: Props) {
  const [thresholdY, setThresholdY] = useState("");
  const [midY, setMidY] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // En az bir alan girilmeli; girilenler sayı olmalı.
    const payload: Record<string, number> = {};
    if (thresholdY.trim() !== "") {
      const n = Number(thresholdY);
      if (!Number.isFinite(n)) return setError("Threshold y sayı olmalı");
      payload["Threshold y"] = n;
    }
    if (midY.trim() !== "") {
      const n = Number(midY);
      if (!Number.isFinite(n)) return setError("Mid y sayı olmalı");
      payload["Mid y"] = n;
    }
    if (Object.keys(payload).length === 0) {
      return setError("En az bir alan girin (Threshold y / Mid y)");
    }

    setSending(true);
    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, payload }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Komut gönderilemedi");
      setThresholdY("");
      setMidY("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Kalibrasyon / Konfigürasyon
        </h2>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Cihazın son bildirdiği güncel değerler */}
        <div className="grid grid-cols-3 gap-3">
          <CurrentValue label="Threshold y" value={latest?.threshold_y} />
          <CurrentValue label="Mid y" value={latest?.mid_y} />
          <CurrentValue label="Period" value={latest?.period} />
        </div>

        {/* Yeni hedef gönder */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">
                Threshold y
              </span>
              <input
                type="number"
                step="any"
                value={thresholdY}
                onChange={(e) => setThresholdY(e.target.value)}
                placeholder="hedef"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">Mid y</span>
              <input
                type="number"
                step="any"
                value={midY}
                onChange={(e) => setMidY(e.target.value)}
                placeholder="hedef"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          </div>
          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}
          <button
            type="submit"
            disabled={sending}
            className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
          >
            {sending ? "Gönderiliyor…" : "Değişiklik Gönder"}
          </button>
        </form>

        {/* Komut geçmişi */}
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Komut Geçmişi
          </h3>
          {commands.length === 0 ? (
            <p className="text-sm text-zinc-400">Henüz komut yok.</p>
          ) : (
            <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {commands.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-zinc-700 dark:text-zinc-300">
                      {Object.entries(c.payload)
                        .map(([k, v]) => `${k}=${v}`)
                        .join(" · ")}
                    </p>
                    <p className="text-xs text-zinc-400">
                      {formatTimestamp(
                        Math.floor(new Date(c.created_at).getTime() / 1000)
                      )}
                      {c.error ? ` · ${c.error}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}
                  >
                    {STATUS_LABEL[c.status]}
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

function CurrentValue({
  label,
  value,
}: {
  label: string;
  value: number | null | undefined;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {value != null ? value : "—"}
      </span>
    </div>
  );
}
