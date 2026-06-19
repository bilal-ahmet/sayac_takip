"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DeviceWithStats, MeterReading } from "@/types";
import {
  formatTimestamp,
  computeGaps,
  readingsToCSV,
  downloadCSV,
} from "@/lib/utils";
import DeviceSelector from "@/components/DeviceSelector";
import StatsCard from "@/components/StatsCard";
import DeltaChart from "@/components/DeltaChart";
import ReadingsTable from "@/components/ReadingsTable";
import TimelineView from "@/components/TimelineView";
import ReadingsFilters, { type DeltaCol } from "@/components/ReadingsFilters";
import GapReport from "@/components/GapReport";

const REFRESH_MS = 5_000;

export default function Home() {
  const [devices, setDevices] = useState<DeviceWithStats[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [readings, setReadings] = useState<MeterReading[]>([]);
  // Stat kartları için gerçek son okuma. Yalnızca canlı yüklemede güncellenir;
  // filtre modunda korunur (filtrelenmiş sonuçların en yenisi değil).
  const [latest, setLatest] = useState<MeterReading | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  // "Verileri Sıfırla" onay adımı: null → onay beklenmiyor, string → onay bekleniyor
  const [confirmReset, setConfirmReset] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  // "Cihazı Sil" onay adımı
  const [confirmDeleteDevice, setConfirmDeleteDevice] = useState<string | null>(null);
  const [deletingDevice, setDeletingDevice] = useState(false);
  // Okumalar filtre/analiz state'leri
  const [deltaCol, setDeltaCol] = useState<DeltaCol>("sayac");
  const [deltaThreshold, setDeltaThreshold] = useState(0);
  const [timeoutSec, setTimeoutSec] = useState(0);
  const [onlyGaps, setOnlyGaps] = useState(false);

  // Filtre aktif mi? Aktifse: sunucu tüm geçmişi tarar + otomatik yenileme durur.
  const filterActive = deltaThreshold > 0 || (onlyGaps && timeoutSec > 0);

  // Cihaz listesini çek.
  const loadDevices = useCallback(async () => {
    try {
      const res = await fetch("/api/devices");
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Cihazlar yüklenemedi");
      const list: DeviceWithStats[] = json.devices;
      setDevices(list);
      setError(null);
      // İlk yüklemede seçili cihaz yoksa ilkini seç.
      setSelected((cur) => cur ?? list[0]?.device_id ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    }
  }, []);

  // Canlı mod: son 200 okumayı çek (filtre yokken, 5 sn'de bir).
  const loadLive = useCallback(async (deviceId: string) => {
    try {
      const res = await fetch(
        `/api/readings?device_id=${encodeURIComponent(deviceId)}&limit=200`
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Okumalar yüklenemedi");
      setReadings(json.readings);
      setLatest(json.readings[0] ?? null);
      setError(null);
      setLastRefresh(new Date());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    }
  }, []);

  // Filtre modu: sunucuda tüm geçmişi tara, sadece eşleşenleri çek (poll yok).
  const loadFiltered = useCallback(
    async (deviceId: string) => {
      try {
        const qs = new URLSearchParams({ device_id: deviceId });
        if (deltaThreshold > 0) {
          qs.set("delta_col", deltaCol);
          qs.set("delta_threshold", String(deltaThreshold));
        }
        if (onlyGaps && timeoutSec > 0) {
          qs.set("only_gaps", "1");
          qs.set("timeout_sec", String(timeoutSec));
        }
        const res = await fetch(`/api/readings?${qs.toString()}`);
        const json = await res.json();
        if (!json.success) throw new Error(json.error ?? "Okumalar yüklenemedi");
        setReadings(json.readings);
        setError(null);
        setLastRefresh(new Date());
      } catch (e) {
        setError(e instanceof Error ? e.message : "Bilinmeyen hata");
      }
    },
    [deltaCol, deltaThreshold, onlyGaps, timeoutSec]
  );

  // İlk yükleme: cihazları çek. setState'ler fetch await'inden SONRA çalışır
  // (senkron değil), bu yüzden set-state-in-effect uyarısı burada geçerli değil.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDevices();
  }, [loadDevices]);

  // Seçili cihaz/filtre değişince yükle.
  //  - Filtre aktif: bir kez filtreli sorgu, otomatik yenileme YOK.
  //  - Filtre yok: canlı yükle + her 5 sn'de bir okuma ve cihazları yenile.
  useEffect(() => {
    if (!selected) return;
    if (filterActive) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadFiltered(selected);
      return;
    }
    loadLive(selected);
    const id = setInterval(() => {
      loadLive(selected);
      loadDevices();
    }, REFRESH_MS);
    return () => clearInterval(id);
  }, [selected, filterActive, loadLive, loadFiltered, loadDevices]);

  // Seçili cihazın tüm okumalarını sil.
  async function handleReset() {
    if (!selected) return;
    setResetting(true);
    setConfirmReset(null);
    try {
      const res = await fetch(
        `/api/readings?device_id=${encodeURIComponent(selected)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Silinemedi");
      setReadings([]);
      setLatest(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setResetting(false);
    }
  }

  // Seçili cihazı ve tüm okumalarını sil.
  async function handleDeleteDevice() {
    if (!selected) return;
    setDeletingDevice(true);
    setConfirmDeleteDevice(null);
    try {
      const res = await fetch(
        `/api/devices?device_id=${encodeURIComponent(selected)}`,
        { method: "DELETE" }
      );
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Cihaz silinemedi");
      setReadings([]);
      setLatest(null);
      setSelected(null); // loadDevices ardından yeni ilk cihazı seçer
      setError(null);
      await loadDevices();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bilinmeyen hata");
    } finally {
      setDeletingDevice(false);
    }
  }

  // Kopma tespiti (sunucudan gelen gap_sec'e göre, timeout aşanlar).
  const gaps = useMemo(
    () => computeGaps(readings, timeoutSec),
    [readings, timeoutSec]
  );
  const gapToIds = useMemo(
    () => new Set(gaps.map((g) => g.toId)),
    [gaps]
  );

  // Seçili cihazın toplam okuma sayısı (filtre öncesi referans).
  const totalCount =
    devices.find((d) => d.device_id === selected)?.reading_count ??
    readings.length;

  // Filtreleri temizle → filterActive false olur → effect canlı poll'ü sürdürür.
  function clearFilters() {
    setDeltaThreshold(0);
    setTimeoutSec(0);
    setOnlyGaps(false);
  }

  // Gösterilen okumaları CSV olarak indir.
  function handleExportCSV() {
    const name = `okumalar-${selected ?? "cihaz"}.csv`;
    downloadCSV(name, readingsToCSV(readings));
  }

  return (
    <div className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
      <header className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-zinc-900 dark:text-zinc-50">
            Sayaç Takip
          </h1>
          <p className="text-sm text-zinc-500">
            {filterActive
              ? "Filtre aktif · otomatik yenileme duraklatıldı"
              : lastRefresh
              ? `Son yenileme: ${lastRefresh.toLocaleTimeString(
                  "tr-TR"
                )} · 5 sn'de bir otomatik`
              : "Yükleniyor…"}
          </p>
        </div>
        <div className="flex items-end gap-3">
          <DeviceSelector
            devices={devices}
            selected={selected}
            onSelect={(id) => {
              setSelected(id);
              setConfirmReset(null);
              setConfirmDeleteDevice(null);
              clearFilters();
            }}
          />
          {/* Sıfırlama butonu — iki adımlı onay */}
          {selected && (
            confirmReset === selected ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 whitespace-nowrap">Emin misin?</span>
                <button
                  onClick={handleReset}
                  disabled={resetting}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                >
                  {resetting ? "Siliniyor…" : "Evet, sil"}
                </button>
                <button
                  onClick={() => setConfirmReset(null)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  İptal
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmReset(selected)}
                disabled={readings.length === 0}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-600 shadow-sm transition hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                Verileri Sıfırla
              </button>
            )
          )}
          {/* Cihazı Sil butonu — iki adımlı onay */}
          {selected && (
            confirmDeleteDevice === selected ? (
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500 whitespace-nowrap">
                  Cihaz silinsin mi?
                </span>
                <button
                  onClick={handleDeleteDevice}
                  disabled={deletingDevice}
                  className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
                >
                  {deletingDevice ? "Siliniyor…" : "Evet, sil"}
                </button>
                <button
                  onClick={() => setConfirmDeleteDevice(null)}
                  className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
                >
                  İptal
                </button>
              </div>
            ) : (
              <button
                onClick={() => setConfirmDeleteDevice(selected)}
                className="rounded-lg border border-red-300 bg-white px-3 py-2 text-xs font-medium text-red-600 shadow-sm transition hover:bg-red-50 dark:border-red-900 dark:bg-zinc-900 dark:text-red-400 dark:hover:bg-red-950"
              >
                Cihazı Sil
              </button>
            )
          )}
        </div>
      </header>

      {error && (
        <div className="mb-6 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {error}
        </div>
      )}

      {/* Özet kartlar */}
      <section className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard
          label="Son Okuma Zamanı"
          value={latest ? formatTimestamp(latest.timestamp_unix) : "—"}
        />
        <StatsCard
          label="Sayaç Değeri"
          value={latest ? String(latest.sayac) : "—"}
        />
        <StatsCard label="Devir" value={latest ? String(latest.devir) : "—"} />
        <StatsCard
          label="Toplam Sayaç Değeri"
          value={latest?.toplam != null ? String(latest.toplam) : "—"}
          subtitle={latest ? `Başlangıç: ${latest.baslangic}` : undefined}
        />
      </section>

      {/* Grafik */}
      <section className="mb-6">
        <DeltaChart readings={readings} />
      </section>

      {/* Okumalar: filtreler + tablo (sol) · zaman çizelgesi + kopma raporu (sağ) */}
      <section className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ReadingsFilters
            deltaCol={deltaCol}
            deltaThreshold={deltaThreshold}
            timeoutSec={timeoutSec}
            onlyGaps={onlyGaps}
            shownCount={readings.length}
            totalCount={totalCount}
            filterActive={filterActive}
            onDeltaColChange={setDeltaCol}
            onDeltaThresholdChange={setDeltaThreshold}
            onTimeoutChange={setTimeoutSec}
            onOnlyGapsChange={setOnlyGaps}
            onClear={clearFilters}
            onExport={handleExportCSV}
          />
          <ReadingsTable readings={readings} gapToIds={gapToIds} />
        </div>
        <div className="flex flex-col gap-6 lg:col-span-1">
          <TimelineView readings={readings} />
          <GapReport gaps={gaps} timeoutSec={timeoutSec} />
        </div>
      </section>
    </div>
  );
}
