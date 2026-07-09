"use client";

import { useState } from "react";
import type {
  DeviceCommand,
  MeterReading,
  CommandStatus,
  CommandType,
} from "@/types";
import { formatTimestamp } from "@/lib/utils";

interface Props {
  deviceId: string;
  latest: MeterReading | null;
  readings: MeterReading[]; // son okumalar (en yeni önce) — son "gerçek" threshold/mid için
  commands: DeviceCommand[];
  onChanged: () => void; // başarılı komut sonrası listeyi tazelemek için
}

// Komut durumuna göre rozet rengi.
const STATUS_STYLE: Record<CommandStatus, string> = {
  pending:
    "bg-amber-100 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300",
  delivered:
    "bg-blue-100 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300",
  applied:
    "bg-emerald-100 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300",
  failed: "bg-red-100 text-red-700 dark:bg-red-950/50 dark:text-red-300",
  cancelled: "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400",
};

const STATUS_LABEL: Record<CommandStatus, string> = {
  pending: "bekliyor",
  delivered: "iletildi",
  applied: "uygulandı",
  failed: "başarısız",
  cancelled: "iptal",
};

// Oluşturulabilecek komut türleri. Her tür kendi giriş alanını gösterir.
const TYPES: { value: CommandType; label: string }[] = [
  { value: "calibration", label: "Kalibrasyon" },
  { value: "set_counter", label: "Sayacı Ayarla" },
  { value: "set_devir", label: "Deviri Ayarla" },
  { value: "reset_counter", label: "Sayacı Sıfırla" },
  { value: "reset_devir", label: "Deviri Sıfırla" },
];

// Komut türünün insan-okunur etiketi (bilinmeyen tür ham değeriyle gösterilir).
function typeLabel(value: string): string {
  return TYPES.find((t) => t.value === value)?.label ?? value;
}

// Sayaç/devir set eden tipler → sayısal "value" alanı ister.
const VALUE_TYPES: CommandType[] = ["set_counter", "set_devir"];
// Fiziksel cihaz register'ını değiştiren tipler → gönderimden önce onay ister.
const CONFIRM_TYPES: CommandType[] = [
  "set_counter",
  "set_devir",
  "reset_counter",
  "reset_devir",
];

export default function DeviceConfigPanel({
  deviceId,
  latest,
  readings,
  commands,
  onChanged,
}: Props) {
  // Cihaz threshold/mid'i her pakette anlamlı göndermez (çoğu pakette 0 gelir).
  // Bu yüzden "en son gerçek (0 olmayan) değeri" gösterip sabit tutuyoruz;
  // readings en yeni önce sıralı olduğundan ilk eşleşen en güncel gerçek değerdir.
  const lastThreshold = readings.find(
    (r) => r.threshold_y != null && r.threshold_y !== 0
  );
  const lastMid = readings.find((r) => r.mid_y != null && r.mid_y !== 0);

  const [type, setType] = useState<CommandType>("calibration");
  const [period, setPeriod] = useState("");
  const [value, setValue] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Fiziksel komutlar için iki adımlı onay: true iken "Emin misin?" gösterilir.
  const [confirming, setConfirming] = useState(false);

  const needsValue = VALUE_TYPES.includes(type);
  const needsConfirm = CONFIRM_TYPES.includes(type);

  // Tip değişince onay/hatayı sıfırla (yanlış tip için asılı kalmasın).
  function handleTypeChange(next: CommandType) {
    setType(next);
    setConfirming(false);
    setError(null);
  }

  // Girdileri tipe göre doğrula → cihaza gönderilecek payload'ı üret.
  // Geçersizse hata metni döner (null payload).
  function buildPayload(): Record<string, number> | null {
    if (type === "calibration") {
      if (period.trim() === "") {
        setError("Süre (period) girin");
        return null;
      }
      const n = Number(period);
      if (!Number.isFinite(n) || n < 0) {
        setError("Süre geçerli bir saniye değeri olmalı");
        return null;
      }
      return { period: n };
    }
    if (needsValue) {
      if (value.trim() === "") {
        setError("Bir değer girin");
        return null;
      }
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0) {
        setError("Değer geçerli bir sayı olmalı (>= 0)");
        return null;
      }
      return { value: n };
    }
    // reset_counter / reset_devir → payload taşımaz.
    return {};
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const payload = buildPayload();
    if (payload === null) return;

    // Fiziksel cihazı etkileyen komutlarda önce onay iste.
    if (needsConfirm && !confirming) {
      setConfirming(true);
      return;
    }

    setSending(true);
    try {
      const res = await fetch("/api/commands", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ device_id: deviceId, type, payload }),
      });
      const json = await res.json();
      if (!json.success) throw new Error(json.error ?? "Komut gönderilemedi");
      setPeriod("");
      setValue("");
      setConfirming(false);
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bilinmeyen hata");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="rounded-xl border border-zinc-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          Kalibrasyon / Konfigürasyon
        </h2>
      </div>

      <div className="flex flex-col gap-4 p-4">
        {/* Süre (period) her pakette gelir → en son okumadan. Threshold/Mid ise
            seyrek gelir (çoğu pakette 0) → en son GERÇEK (0 olmayan) değeri sabit göster. */}
        <div className="grid grid-cols-3 gap-3">
          <CurrentValue label="Süre (period)" value={latest?.period} suffix="sn" />
          <CurrentValue
            label="Threshold y"
            value={lastThreshold?.threshold_y}
            hint={
              lastThreshold
                ? `en son ${formatTimestamp(lastThreshold.timestamp_unix)}`
                : "henüz değer yok"
            }
          />
          <CurrentValue
            label="Mid y"
            value={lastMid?.mid_y}
            hint={
              lastMid
                ? `en son ${formatTimestamp(lastMid.timestamp_unix)}`
                : "henüz değer yok"
            }
          />
        </div>

        {/* Yeni bildirim oluştur: tür seç → alanları doldur → gönder */}
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-zinc-500">
              Bildirim türü
            </span>
            <select
              value={type}
              onChange={(e) => handleTypeChange(e.target.value as CommandType)}
              className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
            >
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          {/* Kalibrasyon: süre girişi (cihaz bu süreden threshold/mid'i dinamik hesaplar) */}
          {type === "calibration" && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">
                Süre / period (saniye)
              </span>
              <input
                type="number"
                step="any"
                min={0}
                value={period}
                onChange={(e) => {
                  setPeriod(e.target.value);
                  setConfirming(false);
                }}
                placeholder="örn. 120"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          )}

          {/* Sayacı/Deviri Ayarla: hedef değer girişi (cihaz register'a bu değeri yazar) */}
          {needsValue && (
            <label className="flex flex-col gap-1">
              <span className="text-xs font-medium text-zinc-500">
                {type === "set_counter" ? "Yeni sayaç değeri" : "Yeni devir değeri"}
              </span>
              <input
                type="number"
                step="any"
                min={0}
                value={value}
                onChange={(e) => {
                  setValue(e.target.value);
                  setConfirming(false);
                }}
                placeholder="örn. 100"
                className="rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm focus:border-zinc-400 focus:outline-none dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              />
            </label>
          )}

          {/* Sıfırlama: giriş yok; yalnızca bilgi notu. */}
          {(type === "reset_counter" || type === "reset_devir") && (
            <p className="text-xs text-zinc-500">
              {type === "reset_counter"
                ? "Cihazın sayacı sıfırlanacak."
                : "Cihazın devri sıfırlanacak."}
            </p>
          )}

          {error && (
            <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
          )}

          {/* Fiziksel komutlarda iki adımlı onay; kalibrasyon tek adımda gider. */}
          {needsConfirm && confirming ? (
            <div className="flex items-center gap-2">
              <span className="whitespace-nowrap text-xs text-zinc-500">
                Cihaza gönderilsin mi?
              </span>
              <button
                type="submit"
                disabled={sending}
                className="rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white shadow-sm transition hover:bg-red-700 disabled:opacity-50"
              >
                {sending ? "Gönderiliyor…" : "Evet, gönder"}
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
              {sending ? "Gönderiliyor…" : "Gönder"}
            </button>
          )}
        </form>

        {/* Komut geçmişi */}
        <div className="border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
            Komut Geçmişi
          </h3>
          {commands.length === 0 ? (
            <p className="text-sm text-zinc-400">Henüz komut yok.</p>
          ) : (
            <ol className="flex max-h-72 flex-col gap-2 overflow-y-auto">
              {commands.map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs text-zinc-700 dark:text-zinc-300">
                      <span className="font-medium">{typeLabel(c.type)}</span>
                      <span className="font-mono text-zinc-500">
                        {" · "}
                        {Object.entries(c.payload)
                          .map(([k, v]) => `${k}=${v}`)
                          .join(" · ")}
                      </span>
                    </p>
                    <p className="text-xs text-zinc-400">
                      {formatTimestamp(
                        Math.floor(new Date(c.created_at).getTime() / 1000)
                      )}
                      {c.error ? ` · ${c.error}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[c.status]}`}
                  >
                    {STATUS_LABEL[c.status]}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}

function CurrentValue({
  label,
  value,
  suffix,
  hint,
}: {
  label: string;
  value: number | null | undefined;
  suffix?: string;
  hint?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-zinc-200 px-3 py-2 dark:border-zinc-800">
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        {value != null ? `${value}${suffix ? ` ${suffix}` : ""}` : "—"}
      </span>
      {hint && <span className="text-[11px] text-zinc-400">{hint}</span>}
    </div>
  );
}
