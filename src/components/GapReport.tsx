"use client";

import type { Gap } from "@/types";
import { formatTimestamp, formatDuration } from "@/lib/utils";

interface Props {
  gaps: Gap[];
  timeoutSec: number;
}

export default function GapReport({ gaps, timeoutSec }: Props) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Kopma Raporu
        </h2>
        {timeoutSec > 0 && (
          <span className="text-xs text-zinc-400">{gaps.length} kopma</span>
        )}
      </div>
      <div className="max-h-96 overflow-y-auto p-4">
        {timeoutSec <= 0 ? (
          <p className="text-sm text-zinc-400">
            Kopma kontrolü için yukarıdan timeout (sn) girin.
          </p>
        ) : gaps.length === 0 ? (
          <p className="text-sm text-zinc-400">
            Timeout&apos;u ({timeoutSec} sn) aşan kopma yok.
          </p>
        ) : (
          <ol className="flex flex-col gap-3">
            {gaps.map((g) => (
              <li
                key={g.toId}
                className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 dark:border-red-900 dark:bg-red-950/40"
              >
                <p className="text-sm font-medium text-red-700 dark:text-red-300">
                  ⚠ {formatDuration(g.gapSeconds)} boşluk
                </p>
                <p className="text-xs text-zinc-500">
                  {formatTimestamp(g.fromTs)} → {formatTimestamp(g.toTs)}
                </p>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
