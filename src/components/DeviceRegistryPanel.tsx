"use client";

import { useCallback, useEffect, useState } from "react";
import { formatTimestamp } from "@/lib/utils";
import StatsCard from "@/components/StatsCard";
import PersonnelAdmin from "@/components/PersonnelAdmin";
import InstallationForm from "@/components/InstallationForm";
import WorkOrderForm from "@/components/WorkOrderForm";
import type {
  Person,
  RegistryResponse,
  RegistrySearchResponse,
  WorkOrderType,
} from "@/types";

interface Props {
  deviceId: string | null;
  onSelectDevice: (deviceId: string) => void;
  onDevicesChanged: () => void; // yeni cihaz kaydedilince cihaz listesi tazelensin
}

// Envanter verisi yalnızca bu kullanıcı form gönderince değişir; DeviceHealthPanel'in
// aksine BİLEREK setInterval YOK. 5 saniyelik bir poll hem israf olur hem açık bir
// formu yazarken yeniden render ederdi. Tazeleme onChanged ile.

const TYPE_LABEL: Record<WorkOrderType, string> = {
  kurulum: "Kurulum",
  ariza: "Arıza",
  kontrol: "Kontrol",
  onarim: "Onarım",
  sayac_degisimi: "Sayaç değişimi",
  esp32_degisimi: "ESP32 değişimi",
  sokum: "Söküm",
};

const TYPE_STYLE: Record<WorkOrderType, string> = {
  kurulum:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  ariza: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  kontrol: "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  onarim: "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  sayac_degisimi:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  esp32_degisimi:
    "bg-violet-100 text-violet-700 dark:bg-violet-950/50 dark:text-violet-300",
  sokum: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function fmt(iso: string | null): string {
  if (!iso) return "—";
  return formatTimestamp(Math.floor(new Date(iso).getTime() / 1000));
}

const panelCls =
  "rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900";

export default function DeviceRegistryPanel({
  deviceId,
  onSelectDevice,
  onDevicesChanged,
}: Props) {
  const [data, setData] = useState<RegistryResponse | null>(null);
  const [personnel, setPersonnel] = useState<Person[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<RegistrySearchResponse | null>(null);

  const loadPersonnel = useCallback(async () => {
    try {
      const res = await fetch("/api/registry/personnel?all=1");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Personel yüklenemedi");
      setPersonnel(json.personnel);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    }
  }, []);

  const load = useCallback(async () => {
    if (!deviceId) {
      setData(null);
      return;
    }
    try {
      const res = await fetch(
        `/api/registry?device_id=${encodeURIComponent(deviceId)}`
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Envanter yüklenemedi");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    }
  }, [deviceId]);

  useEffect(() => {
    // setState fetch await'inden SONRA çalışır — set-state-in-effect uyarısı geçersiz.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPersonnel();
  }, [loadPersonnel]);

  async function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/registry/search?q=${encodeURIComponent(query.trim())}`
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Arama başarısız");
      setResults(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSearching(false);
    }
  }

  const activePersonnel = personnel.filter((p) => p.active);
  const point = data?.point ?? null;
  const current = data?.current ?? null;

  return (
    <div className="flex flex-col gap-6">
      {error && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Arama + personel yönetimi */}
      <div className={`${panelCls} p-4`}>
        <div className="flex flex-wrap items-end gap-3">
          <form onSubmit={handleSearch} className="flex flex-1 items-end gap-2">
            <label className="flex flex-1 flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">
                MAC veya sayaç seri numarası ile ara
              </span>
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="188B0E88947C · 18:8B:0E:88:94:7C · SN-2024-0031"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 font-mono text-sm shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
            <button
              type="submit"
              disabled={searching}
              className="rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
            >
              {searching ? "Aranıyor…" : "Ara"}
            </button>
          </form>
          <PersonnelAdmin personnel={personnel} onChanged={loadPersonnel} />
        </div>

        {results && (
          <div className="mt-4 border-t border-zinc-200 pt-3 dark:border-zinc-800">
            {results.results.length === 0 && results.devices.length === 0 ? (
              <p className="text-sm text-zinc-400">Sonuç yok.</p>
            ) : (
              <ul className="flex max-h-60 flex-col gap-1 overflow-y-auto">
                {results.results.map((r) => (
                  <li key={r.installation_id}>
                    <button
                      type="button"
                      disabled={!r.device_id}
                      onClick={() => r.device_id && onSelectDevice(r.device_id)}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-zinc-50 disabled:opacity-60 dark:hover:bg-zinc-800"
                    >
                      <span className="font-mono text-zinc-700 dark:text-zinc-300">
                        {r.serial_no}
                      </span>
                      <span className="text-zinc-400">
                        {" ↔ "}
                        {r.device_id ?? "cihaz yok"}
                      </span>
                      <span
                        className={`ml-2 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          r.active
                            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                            : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {r.active ? "aktif" : "kapalı"}
                      </span>
                      <span className="block truncate text-zinc-400">
                        {r.facility_code ? `${r.facility_code} · ` : ""}
                        {r.address}
                      </span>
                    </button>
                  </li>
                ))}
                {results.devices.map((d) => (
                  <li key={d.device_id}>
                    <button
                      type="button"
                      onClick={() => onSelectDevice(d.device_id)}
                      className="w-full rounded-lg px-2 py-1.5 text-left text-xs transition hover:bg-zinc-50 dark:hover:bg-zinc-800"
                    >
                      <span className="font-mono text-zinc-700 dark:text-zinc-300">
                        {d.device_id}
                      </span>
                      <span className="block text-zinc-400">
                        kayıtlı cihaz · henüz kurulum kaydı yok
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {!deviceId && (
        <p className="text-sm text-zinc-400">
          Cihaz seçin ya da yukarıdan MAC / seri numarası ile arayın.
        </p>
      )}

      {deviceId && !point && (
        <div className={panelCls}>
          <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
            <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
              Kurulum kaydı oluştur
            </h2>
            <p className="mt-1 text-xs text-zinc-400">
              <span className="font-mono">{deviceId}</span> için henüz kurulum kaydı
              yok.
            </p>
          </div>
          <div className="p-4">
            <InstallationForm
              deviceId={deviceId}
              personnel={activePersonnel}
              onCreated={(id) => {
                onDevicesChanged();
                onSelectDevice(id);
                load();
              }}
            />
          </div>
        </div>
      )}

      {point && (
        <>
          {/* Montaj noktası başlığı */}
          <div className={`${panelCls} p-4`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                  {point.address}
                </h2>
                <p className="mt-1 text-xs text-zinc-400">
                  {point.facility_code ? `Tesisat ${point.facility_code} · ` : ""}
                  {point.meter_location ?? "konum belirtilmemiş"}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                  current
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300"
                    : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"
                }`}
              >
                {current ? "eşleşme aktif" : "eşleşme yok"}
              </span>
            </div>
          </div>

          {/* Güncel eşleşme */}
          <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <StatsCard
              label="Sayaç Seri No"
              value={current?.meter.serial_no ?? "—"}
              subtitle={
                current?.meter.brand
                  ? `${current.meter.brand}${current.meter.model ? " " + current.meter.model : ""}`
                  : undefined
              }
            />
            <StatsCard label="ESP32 MAC" value={current?.device_id ?? "—"} />
            <StatsCard
              label="Başlangıç Endeksi"
              value={
                current?.initial_index != null
                  ? String(current.initial_index)
                  : "—"
              }
            />
            <StatsCard label="Mühür No" value={current?.seal_no ?? "—"} />
            <StatsCard
              label="Kurulum Tarihi"
              value={current ? fmt(current.started_at) : "—"}
              subtitle={current?.opened_by.performed_by_name}
            />
          </section>

          {/* İş geçmişi */}
          <div className={panelCls}>
            <div className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                İş geçmişi
              </h2>
              <span className="text-xs text-zinc-400">
                {data?.work_orders.length ?? 0} kayıt
              </span>
            </div>
            <div className="p-4">
              {!data || data.work_orders.length === 0 ? (
                <p className="text-sm text-zinc-400">Henüz iş kaydı yok.</p>
              ) : (
                <ol className="flex max-h-96 flex-col gap-2 overflow-y-auto">
                  {data.work_orders.map((w) => {
                    // performed_at kullanıcı girer, created_at sunucu saatidir.
                    // Bir günden fazla ayrışıyorlarsa geri tarihleme görünür olsun.
                    const backdated =
                      Math.abs(
                        new Date(w.created_at).getTime() -
                          new Date(w.performed_at).getTime()
                      ) > DAY_MS;
                    return (
                      <li
                        key={w.id}
                        className="flex items-start justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                      >
                        <div className="min-w-0">
                          <p className="text-xs text-zinc-700 dark:text-zinc-300">
                            <span className="font-medium">{w.performed_by_name}</span>
                            <span className="text-zinc-400">
                              {" · "}
                              {fmt(w.performed_at)}
                            </span>
                          </p>
                          {(w.reason || w.work_done) && (
                            <p className="mt-0.5 text-xs text-zinc-500">
                              {[w.reason, w.work_done].filter(Boolean).join(" — ")}
                            </p>
                          )}
                          {(w.old_meter_serial || w.new_meter_serial) &&
                            w.new_meter_serial && (
                              <p className="mt-0.5 font-mono text-xs text-zinc-400">
                                sayaç: {w.old_meter_serial ?? "—"} →{" "}
                                {w.new_meter_serial}
                              </p>
                            )}
                          {w.new_mac && (
                            <p className="mt-0.5 font-mono text-xs text-zinc-400">
                              ESP32: {w.old_mac ?? "—"} → {w.new_mac}
                            </p>
                          )}
                          {backdated && (
                            <p className="mt-0.5 text-xs text-amber-600 dark:text-amber-400">
                              geriye dönük girildi ({fmt(w.created_at)})
                            </p>
                          )}
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${TYPE_STYLE[w.type]}`}
                        >
                          {TYPE_LABEL[w.type]}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          </div>

          {/* Yeni iş emri */}
          <div className={panelCls}>
            <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
              <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
                Yeni iş kaydı
              </h2>
            </div>
            <div className="p-4">
              <WorkOrderForm
                installationPointId={point.id}
                personnel={activePersonnel}
                onCreated={() => {
                  load();
                  onDevicesChanged();
                }}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
