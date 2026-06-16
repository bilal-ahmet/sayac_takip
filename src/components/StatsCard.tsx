interface Props {
  label: string;
  value: string;
  subtitle?: string;
  valueClassName?: string;
}

export default function StatsCard({ label, value, subtitle, valueClassName }: Props) {
  return (
    <div className="flex flex-col gap-1 rounded-xl border border-zinc-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <span
        className={`text-2xl font-semibold text-zinc-900 dark:text-zinc-100 ${
          valueClassName ?? ""
        }`}
      >
        {value}
      </span>
      {subtitle && (
        <span className="text-xs text-zinc-400">{subtitle}</span>
      )}
    </div>
  );
}
