interface Props {
  page: number;
  totalPages: number;
  onPrev: () => void;
  onNext: () => void;
}

export default function Pagination({ page, totalPages, onPrev, onNext }: Props) {
  if (totalPages <= 1) return null;

  return (
    <div className="flex items-center justify-between border-t border-zinc-100 px-4 py-3 dark:border-zinc-800">
      <span className="text-xs text-zinc-500">
        {page} / {totalPages}
      </span>
      <div className="flex gap-2">
        <button
          onClick={onPrev}
          disabled={page === 1}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          ← Önceki
        </button>
        <button
          onClick={onNext}
          disabled={page === totalPages}
          className="rounded-md border border-zinc-300 bg-white px-3 py-1 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          Sonraki →
        </button>
      </div>
    </div>
  );
}
