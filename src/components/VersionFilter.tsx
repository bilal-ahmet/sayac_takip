"use client";

interface Props {
  versions: string[]; // sistemdeki benzersiz fw_version listesi
  selected: string | null; // null = tümü
  onSelect: (version: string | null) => void;
}

// Firmware versiyonuna göre cihaz listesini daraltan dropdown.
// fw_version cihaz başına tek değer olduğundan filtre cihaz seçicisini etkiler.
export default function VersionFilter({ versions, selected, onSelect }: Props) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-500">Firmware</span>
      <select
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value === "" ? null : e.target.value)}
        className="min-w-32 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        <option value="">Tümü</option>
        {versions.map((v) => (
          <option key={v} value={v}>
            {v}
          </option>
        ))}
      </select>
    </label>
  );
}
