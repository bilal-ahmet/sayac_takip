"use client";

import { useState } from "react";
import type { Person } from "@/types";

interface Props {
  personnel: Person[]; // aktif + pasif (yönetim listesi)
  onChanged: () => void;
}

// Personel ekleme / pasife alma. DeviceAdmin'deki popover deseni.
// SİLME YOK: personel pasife alınır, böylece iş emirlerindeki FK kırılmaz ve
// geçmişte kimin ne yaptığı kaybolmaz.
export default function PersonnelAdmin({ personnel, onChanged }: Props) {
  const [open, setOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [role, setRole] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (fullName.trim() === "") return setError("Ad soyad girin");

    setBusy(true);
    try {
      const res = await fetch("/api/registry/personnel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          full_name: fullName.trim(),
          role: role.trim() || null,
        }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Kişi eklenemedi");
      setFullName("");
      setRole("");
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(person: Person) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/registry/personnel", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: person.id, active: !person.active }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Güncellenemedi");
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
        onClick={() => {
          setOpen(!open);
          setError(null);
        }}
        className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
      >
        {open ? "Kapat" : "Personel"}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-20 mt-2 w-80 rounded-xl border border-zinc-200 bg-white p-4 shadow-lg dark:border-zinc-800 dark:bg-zinc-900">
          <form onSubmit={handleAdd} className="flex flex-col gap-2">
            <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
              Yeni personel
            </span>
            <input
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Ad soyad"
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
            <input
              value={role}
              onChange={(e) => setRole(e.target.value)}
              placeholder="Görev (opsiyonel, ör. tekniker)"
              className="rounded-lg border border-zinc-300 px-2 py-1.5 text-xs dark:border-zinc-700 dark:bg-zinc-950"
            />
            <button
              type="submit"
              disabled={busy}
              className="rounded-lg bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {busy ? "Ekleniyor…" : "Ekle"}
            </button>
          </form>

          {personnel.length > 0 && (
            <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-zinc-800">
              <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                Kayıtlı personel
              </span>
              <ul className="mt-2 flex max-h-48 flex-col gap-1 overflow-y-auto">
                {personnel.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <span
                      className={
                        p.active
                          ? "text-zinc-700 dark:text-zinc-300"
                          : "text-zinc-400 line-through"
                      }
                    >
                      {p.full_name}
                      {p.role ? ` · ${p.role}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => toggleActive(p)}
                      disabled={busy}
                      className="shrink-0 text-xs text-zinc-500 underline transition hover:text-zinc-800 disabled:opacity-50 dark:hover:text-zinc-200"
                    >
                      {p.active ? "pasifleştir" : "aktifleştir"}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="mt-3 text-xs text-red-500">{error}</p>}
        </div>
      )}
    </div>
  );
}
