"use client";

import { useState } from "react";
import type { DeviceWithStats } from "@/types";

interface Props {
  selectedDevice?: DeviceWithStats;
  // Yeni cihaz oluşturulduysa id'si geçilir (parent onu seçebilsin diye).
  onChanged: (createdDeviceId?: string) => void;
}

export default function DeviceAdmin({ selectedDevice, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [deviceId, setDeviceId] = useState("");
  const [name, setName] = useState("");
  const [renameTo, setRenameTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  function toggle() {
    const next = !open;
    setOpen(next);
    setError(null);
    setInfo(null);
    // Panel açılırken yeniden adlandırma alanını cihazın mevcut adıyla doldur.
    if (next) setRenameTo(selectedDevice?.name ?? "");
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    const id = deviceId.trim();
    if (id === "") return setError("Cihaz kimliği (MAC) girin");

    setBusy(true);
    try {
      const res = await fetch("/api/devices", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: id, name: name.trim() || null }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Cihaz eklenemedi");
      setDeviceId("");
      setName("");
      setInfo(`${id} eklendi`);
      onChanged(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setBusy(false);
    }
  }

  async function handleRename(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedDevice) return;
    setError(null);
    setInfo(null);
    setBusy(true);
    try {
      const res = await fetch("/api/devices", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          device_id: selectedDevice.device_id,
          name: renameTo.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "İsim değiştirilemedi");
      setInfo("İsim güncellendi");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        className="rounded-lg border border-zinc-300 px-3 py-2 text-xs font-semibold text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
      >
        {open ? "Kapat" : "+ Cihaz"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <form onSubmit={handleCreate} className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Yeni cihaz
            </span>
            <input
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
              placeholder="Cihaz kimliği (ör. 188B0E88947C)"
              className="rounded-lg border border-zinc-300 px-2 py-1.5 font-mono text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="İsim (opsiyonel, ör. Bodrum su sayacı)"
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
            {/* Cihaz kimliği, cihazın gönderdiği "Device Id" ile birebir eşleşmeli;
                eşleşmezse gelen okumalar ayrı bir cihaz olarak görünür. */}
            <p className="text-xs text-zinc-400">
              Kimlik, cihazın gönderdiği değerle birebir aynı olmalı
              (büyük/küçük harf dahil).
            </p>
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy ? "Ekleniyor…" : "Ekle"}
            </button>
          </form>

          {selectedDevice && (
            <form
              onSubmit={handleRename}
              className="mt-4 flex flex-col gap-2 border-t border-zinc-200 pt-4 dark:border-zinc-800"
            >
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Seçili cihazı yeniden adlandır
              </span>
              <span className="font-mono text-xs text-zinc-400">
                {selectedDevice.device_id}
              </span>
              <input
                value={renameTo}
                onChange={(e) => setRenameTo(e.target.value)}
                placeholder="İsim (boş bırakılırsa kaldırılır)"
                className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
              />
              <button
                type="submit"
                disabled={busy}
                className="rounded-lg border border-zinc-300 px-3 py-1.5 text-xs font-semibold text-zinc-700 transition hover:bg-zinc-50 disabled:opacity-50 dark:border-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-800"
              >
                {busy ? "Kaydediliyor…" : "Kaydet"}
              </button>
            </form>
          )}

          {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
          {info && <p className="mt-3 text-xs text-emerald-600">{info}</p>}
        </div>
      )}
    </div>
  );
}
