"use client";

export type DeltaCol = "sayac" | "devir";

interface Props {
  deltaCol: DeltaCol;
  deltaThreshold: number;
  timeoutSec: number;
  onlyGaps: boolean;
  shownCount: number;
  totalCount: number;
  filterActive: boolean;
  onDeltaColChange: (v: DeltaCol) => void;
  onDeltaThresholdChange: (v: number) => void;
  onTimeoutChange: (v: number) => void;
  onOnlyGapsChange: (v: boolean) => void;
  onClear: () => void;
  onExport: () => void;
}

const inputCls =
  "w-24 rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

export default function ReadingsFilters({
  deltaCol,
  deltaThreshold,
  timeoutSec,
  onlyGaps,
  shownCount,
  totalCount,
  filterActive,
  onDeltaColChange,
  onDeltaThresholdChange,
  onTimeoutChange,
  onOnlyGapsChange,
  onClear,
  onExport,
}: Props) {
  return (
    <div className="flex flex-wrap items-end gap-4 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      {/* Delta filtresi */}
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-500">Delta sütunu</span>
        <select
          value={deltaCol}
          onChange={(e) => onDeltaColChange(e.target.value as DeltaCol)}
          className="rounded-lg border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
        >
          <option value="sayac">Δ Sayaç</option>
          <option value="devir">Δ Devir</option>
        </select>
      </label>

      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-500">Eşik (|Δ| &gt;)</span>
        <input
          type="number"
          min={0}
          value={deltaThreshold || ""}
          placeholder="0 = kapalı"
          onChange={(e) => onDeltaThresholdChange(Number(e.target.value) || 0)}
          className={inputCls}
        />
      </label>

      {/* Kopma filtresi */}
      <label className="flex flex-col gap-1 text-xs">
        <span className="font-medium text-zinc-500">Timeout (sn)</span>
        <input
          type="number"
          min={0}
          value={timeoutSec || ""}
          placeholder="0 = kapalı"
          onChange={(e) => onTimeoutChange(Number(e.target.value) || 0)}
          className={inputCls}
        />
      </label>

      <label className="flex items-center gap-2 pb-1.5 text-sm text-zinc-700 dark:text-zinc-300">
        <input
          type="checkbox"
          checked={onlyGaps}
          disabled={timeoutSec <= 0}
          onChange={(e) => onOnlyGapsChange(e.target.checked)}
          className="h-4 w-4 rounded border-zinc-300 disabled:opacity-40"
        />
        Sadece kopmalar
      </label>

      <div className="ml-auto flex items-center gap-3">
        {filterActive && (
          <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-950 dark:text-amber-300">
            Filtre aktif · yenileme duraklatıldı
          </span>
        )}
        <span className="text-xs text-zinc-400">
          {shownCount} / {totalCount} kayıt
        </span>
        {filterActive && (
          <button
            onClick={onClear}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
          >
            Filtreleri temizle
          </button>
        )}
        <button
          onClick={onExport}
          disabled={shownCount === 0}
          className="rounded-lg border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          CSV indir
        </button>
      </div>
    </div>
  );
}
