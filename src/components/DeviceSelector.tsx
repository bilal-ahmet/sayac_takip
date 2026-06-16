"use client";

import type { DeviceWithStats } from "@/types";

interface Props {
  devices: DeviceWithStats[];
  selected: string | null;
  onSelect: (deviceId: string) => void;
}

export default function DeviceSelector({ devices, selected, onSelect }: Props) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="font-medium text-zinc-500">Cihaz</span>
      <select
        value={selected ?? ""}
        onChange={(e) => onSelect(e.target.value)}
        className="min-w-56 rounded-lg border border-zinc-300 bg-white px-3 py-2 text-base text-zinc-900 shadow-sm outline-none focus:border-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
      >
        {devices.length === 0 && <option value="">Cihaz yok</option>}
        {devices.map((d) => (
          <option key={d.device_id} value={d.device_id}>
            {d.name ? `${d.name} (${d.device_id})` : d.device_id}
          </option>
        ))}
      </select>
    </label>
  );
}
