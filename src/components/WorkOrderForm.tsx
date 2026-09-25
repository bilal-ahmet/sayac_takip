"use client";

import { useState } from "react";
import type { Person, WorkOrderType } from "@/types";

interface Props {
  installationPointId: number;
  personnel: Person[]; // yalnızca aktifler
  onCreated: () => void;
}

const inputCls =
  "rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const labelCls = "text-xs font-medium text-zinc-500";

// 'kurulum' burada yok: ilk kurulum kendi formundan açılır.
type FormType = Exclude<WorkOrderType, "kurulum">;

const TYPES: { value: FormType; label: string }[] = [
  { value: "ariza", label: "Arıza" },
  { value: "kontrol", label: "Kontrol" },
  { value: "onarim", label: "Onarım" },
  { value: "sayac_degisimi", label: "Sayaç değişimi" },
  { value: "esp32_degisimi", label: "ESP32 değişimi" },
  { value: "sokum", label: "Söküm" },
];

// Eşleşmeyi değiştiren tipler: gönderimden önce onay istenir.
const MUTATING: FormType[] = ["sayac_degisimi", "esp32_degisimi", "sokum"];

function nowLocal(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export default function WorkOrderForm({
  installationPointId,
  personnel,
  onCreated,
}: Props) {
  const [type, setType] = useState<FormType>("kontrol");
  const [performedById, setPerformedById] = useState("");
  const [performedAt, setPerformedAt] = useState(nowLocal());
  const [reason, setReason] = useState("");
  const [workDone, setWorkDone] = useState("");
  const [newSerial, setNewSerial] = useState("");
  const [newInitialIndex, setNewInitialIndex] = useState("");
  const [newSealNo, setNewSealNo] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [pulsePerUnit, setPulsePerUnit] = useState("");
  const [newMac, setNewMac] = useState("");
  const [sending, setSending] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsMeter = type === "sayac_degisimi";
  const needsMac = type === "esp32_degisimi";
  const needsConfirm = MUTATING.includes(type);

  // Tip değişince onay ve hata sıfırlanır; yanlış tip için asılı kalmasın.
  function handleTypeChange(next: FormType) {
    setType(next);
    setConfirming(false);
    setError(null);
  }

  function buildPayload(): Record<string, unknown> | null {
    if (performedById === "") {
      setError("İşlemi yapan kişiyi seçin");
      return null;
    }
    if (performedAt === "") {
      setError("İşlem tarihini girin");
      return null;
    }
    if (needsMeter && newSerial.trim() === "") {
      setError("Yeni sayaç seri numarası girin");
      return null;
    }
    if (needsMac && newMac.trim() === "") {
      setError("Yeni ESP32 MAC adresi girin");
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

    const idx = optionalNumber(newInitialIndex, "Başlangıç endeksi");
    if (idx === false) return null;
    const ppu = optionalNumber(pulsePerUnit, "Darbe sabiti");
    if (ppu === false) return null;

    return {
      installation_point_id: installationPointId,
      type,
      performed_by_id: Number(performedById),
      performed_at: new Date(performedAt).toISOString(),
      reason: reason.trim() || null,
      work_done: workDone.trim() || null,
      ...(needsMeter
        ? {
            new_meter_serial: newSerial.trim(),
            new_initial_index: idx,
            new_seal_no: newSealNo.trim() || null,
            brand: brand.trim() || null,
            model: model.trim() || null,
            pulse_per_unit: ppu,
          }
        : {}),
      ...(needsMac ? { new_mac: newMac.trim() } : {}),
    };
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload();
    if (payload === null) return;

    // Fiziksel eşleşmeyi değiştiren işlemlerde önce onay.
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/registry/work-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "İş emri kaydedilemedi");
      setReason("");
      setWorkDone("");
      setNewSerial("");
      setNewInitialIndex("");
      setNewSealNo("");
      setBrand("");
      setModel("");
      setPulsePerUnit("");
      setNewMac("");
      setConfirming(false);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSending(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>İşlem türü</span>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as FormType)}
            className={inputCls}
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>İşlemi yapan *</span>
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
        <label className="flex flex-col gap-1">
          <span className={labelCls}>İşlem tarihi *</span>
          <input
            type="datetime-local"
            value={performedAt}
            onChange={(e) => {
              setPerformedAt(e.target.value);
              setConfirming(false);
            }}
            className={inputCls}
          />
        </label>
      </div>

      {needsMeter && (
        <div className="grid grid-cols-1 gap-3 rounded-lg border border-zinc-200 p-3 sm:grid-cols-3 dark:border-zinc-800">
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Yeni sayaç seri no *</span>
            <input
              value={newSerial}
              onChange={(e) => {
                setNewSerial(e.target.value);
                setConfirming(false);
              }}
              className={`${inputCls} font-mono`}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Başlangıç endeksi</span>
            <input
              value={newInitialIndex}
              onChange={(e) => setNewInitialIndex(e.target.value)}
              inputMode="decimal"
              className={inputCls}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className={labelCls}>Yeni mühür no</span>
            <input
              value={newSealNo}
              onChange={(e) => setNewSealNo(e.target.value)}
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
            <span className={labelCls}>Darbe sabiti</span>
            <input
              value={pulsePerUnit}
              onChange={(e) => setPulsePerUnit(e.target.value)}
              inputMode="decimal"
              className={inputCls}
            />
          </label>
        </div>
      )}

      {needsMac && (
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Yeni ESP32 MAC *</span>
          <input
            value={newMac}
            onChange={(e) => {
              setNewMac(e.target.value);
              setConfirming(false);
            }}
            placeholder="188B0E88947C veya 18:8B:0E:88:94:7C"
            className={`${inputCls} font-mono`}
          />
        </label>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Neden</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className={labelCls}>Yapılan iş</span>
          <textarea
            value={workDone}
            onChange={(e) => setWorkDone(e.target.value)}
            rows={2}
            className={inputCls}
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-600 dark:text-red-400">{error}</p>}

      {needsConfirm && confirming ? (
        <div className="flex items-center gap-2">
          <span className="whitespace-nowrap text-xs text-zinc-500">
            Bu işlem sayaç–MAC eşleşmesini değiştirir. Emin misin?
          </span>
          <button
            type="submit"
            disabled={sending}
            className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
          >
            {sending ? "Kaydediliyor…" : "Evet, kaydet"}
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-xs font-medium text-zinc-700 shadow-sm transition hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"
          >
            Vazgeç
          </button>
        </div>
      ) : (
        <button
          type="submit"
          disabled={sending}
          className="self-start rounded-lg bg-zinc-900 px-4 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-zinc-700 disabled:opacity-50 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
        >
          {sending ? "Kaydediliyor…" : "İş emri kaydet"}
        </button>
      )}
    </form>
  );
}
