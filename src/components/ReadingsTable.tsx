"use client";

import { useEffect, useState } from "react";
import type { MeterReading } from "@/types";
import { formatTimestamp, deltaColorClass, formatDelta } from "@/lib/utils";
import Pagination from "./Pagination";

const PAGE_SIZE = 20;

interface Props {
  readings: MeterReading[];
  gapToIds?: Set<number>;
}

export default function ReadingsTable({ readings, gapToIds }: Props) {
  const [page, setPage] = useState(1);

  // Yeni veri gelince (cihaz değişimi veya auto-refresh) ilk sayfaya dön.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [readings]);

  const totalPages = Math.max(1, Math.ceil(readings.length / PAGE_SIZE));
  const slice = readings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Okumalar
        </h2>
        {readings.length > 0 && (
          <span className="text-xs text-zinc-400">
            {readings.length} kayıt
          </span>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500 dark:bg-zinc-950">
            <tr>
              <th className="px-4 py-2 font-medium">Zaman</th>
              <th className="px-4 py-2 text-right font-medium">Sayaç</th>
              <th className="px-4 py-2 text-right font-medium">Δ Sayaç</th>
              <th className="px-4 py-2 text-right font-medium">Devir</th>
              <th className="px-4 py-2 text-right font-medium">Δ Devir</th>
              <th className="px-4 py-2 text-right font-medium">Başlangıç</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800">
            {readings.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-zinc-400">
                  Bu cihaz için okuma yok
                </td>
              </tr>
            )}
            {slice.map((r) => {
              const isGap = gapToIds?.has(r.id) ?? false;
              return (
              <tr
                key={r.id}
                className="text-zinc-800 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-800/50"
              >
                <td className="whitespace-nowrap px-4 py-2">
                  {isGap && (
                    <span className="mr-1.5 rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-semibold text-red-700 dark:bg-red-950 dark:text-red-300">
                      ⚠ kopma
                    </span>
                  )}
                  {r.time_synced === false && (
                    <span
                      title="Cihaz saati senkron değildi; sunucu saati kullanıldı"
                      className="mr-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:bg-amber-950 dark:text-amber-300"
                    >
                      ⚠ saat yok
                    </span>
                  )}
                  <span className={isGap ? "font-medium text-red-600 dark:text-red-400" : ""}>
                    {formatTimestamp(r.timestamp_unix)}
                  </span>
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.sayac}</td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-medium ${deltaColorClass(r.sayac_delta)}`}
                >
                  {formatDelta(r.sayac_delta)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums">{r.devir}</td>
                <td
                  className={`px-4 py-2 text-right tabular-nums font-medium ${deltaColorClass(r.devir_delta)}`}
                >
                  {formatDelta(r.devir_delta)}
                </td>
                <td className="px-4 py-2 text-right tabular-nums text-zinc-500">
                  {r.baslangic}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pagination
        page={page}
        totalPages={totalPages}
        onPrev={() => setPage((p) => p - 1)}
        onNext={() => setPage((p) => p + 1)}
      />
    </div>
  );
}
