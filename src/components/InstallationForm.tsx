"use client";

import { useState } from "react";
import type { Person } from "@/types";

interface Props {
  deviceId: string | null; // seçili cihaz; alan yine de düzenlenebilir
  personnel: Person[]; // yalnızca aktifler
  onCreated: (deviceId: string) => void;
}

const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const labelCls = "text-xs font-medium text-zinc-500";

// datetime-local için "şimdi" (yerel saat, saniyesiz).
function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

// İlk kurulum kaydı. Montaj noktası + sayaç + cihaz eşleşmesini birlikte açar.
// Sonraki tüm değişiklikler iş emri formundan yapılır.
export default function InstallationForm({
  deviceId,
  personnel,
  onCreated,
}: Props) {
  const [facilityCode, setFacilityCode] = useState("");
  const [address, setAddress] = useState("");
  const [meterLocation, setMeterLocation] = useState("");
  const [serialNo, setSerialNo] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [pulsePerUnit, setPulsePerUnit] = useState("");
  const [techLabel, setTechLabel] = useState("");
  const [mac, setMac] = useState(deviceId ?? "");
  const [initialIndex, setInitialIndex] = useState("");
  const [sealNo, setSealNo] = useState("");
  const [performedById, setPerformedById] = useState("");
  const [performedAt, setPerformedAt] = useState(nowLocal());
  const [notes, setNotes] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Girdileri doğrula → gövdeyi üret. Geçersizse setError + null.
  function buildPayload(): Record<string, unknown> | null {
    if (address.trim() === "") {
      setError("Açık adres girin");
      return null;
    }
    if (serialNo.trim() === "") {
      setError("Sayaç seri numarası girin");
      return null;
    }
    if (mac.trim() === "") {
      setError("ESP32 MAC adresi girin");
      return null;
    }
    if (performedById === "") {
      setError("Kurulumu yapan kişiyi seçin");
      return null;
    }
    if (performedAt === "") {
      setError("Kurulum tarihini girin");
      return null;
    }

    const optionalNumber = (v: string, label: string): number | null | false => {
      if (v.trim() === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n)) {
        setError(`${label} geçerli bir sayı olmalı`);
        return false;
      }
      return n;
    };

    const idx = optionalNumber(initialIndex, "Başlangıç endeksi");
    if (idx === false) return null;
    const ppu = optionalNumber(pulsePerUnit, "Darbe sabiti");
    if (ppu === false) return null;

    return {
      facility_code: facilityCode.trim() || null,
      address: address.trim(),
      meter_location: meterLocation.trim() || null,
      serial_no: serialNo.trim(),
      brand: brand.trim() || null,
      model: model.trim() || null,
      pulse_per_unit: ppu,
      tech_label: techLabel.trim() || null,
      device_id: mac.trim(),
      initial_index: idx,
      seal_no: sealNo.trim() || null,
      performed_by_id: Number(performedById),
      performed_at: new Date(performedAt).toISOString(),
      notes: notes.trim() || null,
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload();
    if (payload === null) return;

    setSending(true);
    try {
      const res = await fetch("/api/registry/installations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Kurulum kaydedilemedi");
      onCreated(json.device_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Montaj noktası
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Tesisat ID</span>
            <input
              value={facilityCode}
              onChange={(e) => setFacilityCode(e.target.value)}
              placeholder="opsiyonel"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Sayacın adresteki konumu</span>
            <input
              value={meterLocation}
              onChange={(e) => setMeterLocation(e.target.value)}
              placeholder="ör. bodrum, kat girişi"
              className={inputCls}
            />
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className={labelCls}>Açık adres *</span>
          <textarea
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          Sayaç
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Seri numarası *</span>
            <input
              value={serialNo}
              onChange={(e) => setSerialNo(e.target.value)}
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Mühür numarası</span>
            <input
              value={sealNo}
              onChange={(e) => setSealNo(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Marka</span>
            <input
              value={brand}
              onChange={(e) => setBrand(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Model</span>
            <input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Başlangıç endeksi</span>
            <input
              value={initialIndex}
              onChange={(e) => setInitialIndex(e.target.value)}
              inputMode="decimal"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Darbe sabiti (imp/birim)</span>
            <input
              value={pulsePerUnit}
              onChange={(e) => setPulsePerUnit(e.target.value)}
              inputMode="decimal"
              placeholder="etiketten"
              className={inputCls}
            />
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className={labelCls}>Teknik etiket bilgileri</span>
          <textarea
            value={techLabel}
            onChange={(e) => setTechLabel(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
          ESP32 ve kurulum
        </h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>MAC adresi *</span>
            <input
              value={mac}
              onChange={(e) => setMac(e.target.value)}
              placeholder="188B0E88947C veya 18:8B:0E:88:94:7C"
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Kurulum tarihi *</span>
            <input
              type="datetime-local"
              value={performedAt}
              onChange={(e) => setPerformedAt(e.target.value)}
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Kurulumu yapan *</span>
            <select
              value={performedById}
              onChange={(e) => setPerformedById(e.target.value)}
              className={inputCls}
            >
              <option value="">Seçin…</option>
              {personnel.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.full_name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className={labelCls}>Not</span>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      <button
        type="submit"
        disabled={sending}
        className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
      >
        {sending ? "Kaydediliyor…" : "Kurulumu kaydet"}
      </button>
    </form>
  );
}
