"use client";

import { useEffect, useState } from "react";
import type { MeterReading } from "@/types";
import { formatTimestamp, deltaColorClass, formatDelta } from "@/lib/utils";
import Pagination from "./Pagination";

const PAGE_SIZE = 10;

interface Props {
  readings: MeterReading[];
}

export default function TimelineView({ readings }: Props) {
  const [page, setPage] = useState(1);

  // Yeni veri gelince ilk sayfaya dön.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPage(1);
  }, [readings]);

  const totalPages = Math.max(1, Math.ceil(readings.length / PAGE_SIZE));
  const slice = readings.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Zaman Çizelgesi
        </h2>
        {readings.length > 0 && (
          <span className="text-xs text-zinc-400">{readings.length} olay</span>
        )}
      </div>
      <div className="p-4">
        {slice.length === 0 ? (
          <p className="text-sm text-zinc-400">Gösterilecek olay yok</p>
        ) : (
          <ol className="relative border-l border-zinc-200 dark:border-zinc-700">
            {slice.map((r) => (
              <li key={r.id} className="mb-5 ml-4 last:mb-0">
                <span className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white bg-zinc-400 dark:border-zinc-900" />
                <time className="text-xs text-zinc-500">
                  {formatTimestamp(r.timestamp_unix)}
                </time>
                <p className="text-sm text-zinc-800 dark:text-zinc-200">
                  Sayaç <span className="font-medium">{r.sayac}</span>{" "}
                  <span className={`font-medium ${deltaColorClass(r.sayac_delta)}`}>
                    ({formatDelta(r.sayac_delta)})
                  </span>{" "}
                  · Devir <span className="font-medium">{r.devir}</span>{" "}
                  <span className={`font-medium ${deltaColorClass(r.devir_delta)}`}>
                    ({formatDelta(r.devir_delta)})
                  </span>
                </p>
              </li>
            ))}
          </ol>
        )}
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
