import { useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { useHousehold } from "@/data/household";
import {
  parseDelimited,
  detectTable,
  buildImport,
  type Mapping,
} from "@/lib/import";
import { importTransactions, type ImportOutcome } from "@/data/transactions";
import { runCategorize } from "@/data/rules";
import { formatSigned, formatDate } from "@/lib/format";

type Stage = "pick" | "map" | "done";

export function ImportStatement({
  open,
  onClose,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { householdId, contaCasa } = useHousehold();
  const [stage, setStage] = useState<Stage>("pick");
  const [rows, setRows] = useState<string[][]>([]);
  const [headerIndex, setHeaderIndex] = useState(0);
  const [mapping, setMapping] = useState<Mapping | null>(null);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function close() {
    setStage("pick");
    setRows([]);
    setMapping(null);
    setOutcome(null);
    setError(null);
    onClose();
  }

  async function onFile(file: File) {
    setError(null);
    try {
      let parsed: string[][];
      if (/\.(xlsx|xls)$/i.test(file.name)) {
        const XLSX = await import("xlsx"); // lazy: keeps SheetJS out of the main bundle
        const buf = await file.arrayBuffer();
        const wb = XLSX.read(buf, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        parsed = XLSX.utils.sheet_to_json(ws, {
          header: 1,
          raw: false,
          defval: "",
        }) as string[][];
        parsed = parsed.map((r) => r.map((c) => String(c ?? "").trim()));
      } else {
        parsed = parseDelimited(await file.text());
      }
      const det = detectTable(parsed);
      setRows(parsed);
      if (det) {
        setHeaderIndex(det.headerIndex);
        setMapping(det.mapping);
      } else {
        setHeaderIndex(0);
        setMapping({
          dateCol: 0,
          descCol: 1,
          amountMode: "single",
          amountCol: 2,
          dateFormat: "dmy",
        });
      }
      setStage("map");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const header = rows[headerIndex] ?? [];
  const preview = useMemo(() => {
    if (!mapping) return { items: [], skippedRows: 0 };
    return buildImport(rows, mapping, headerIndex + 1);
  }, [rows, mapping, headerIndex]);

  async function runImport() {
    if (!mapping || !householdId || !contaCasa) return;
    setBusy(true);
    setError(null);
    try {
      const built = buildImport(rows, mapping, headerIndex + 1);
      const res = await importTransactions(householdId, contaCasa.id, built.items);
      setOutcome(res);
      setStage("done");
      // Auto-categorize the freshly imported movements (best-effort).
      if (res.inserted > 0) {
        runCategorize(householdId).catch(() => {});
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function updateMapping(patch: Partial<Mapping>) {
    setMapping((m) => (m ? { ...m, ...patch } : m));
  }

  const colOptions = header.map((h, i) => ({ i, label: h || `Coluna ${i + 1}` }));

  return (
    <Sheet open={open} onClose={close} title="Importar extrato">
      {stage === "pick" && (
        <div className="space-y-4">
          <p className="text-sm text-tinta/60 dark:text-creme/60">
            Escolhe o ficheiro do extrato do Santander (CSV ou Excel). Os
            movimentos repetidos não são importados duas vezes.
          </p>
          <label className="btn-primary w-full cursor-pointer">
            Escolher ficheiro
            <input
              type="file"
              accept=".csv,.tsv,.txt,.xlsx,.xls"
              className="hidden"
              onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
            />
          </label>
          {error && <p className="text-sm text-terracota">{error}</p>}
        </div>
      )}

      {stage === "map" && mapping && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Data">
              <ColSelect
                value={mapping.dateCol}
                options={colOptions}
                onChange={(i) => updateMapping({ dateCol: i })}
              />
            </Field>
            <Field label="Descrição">
              <ColSelect
                value={mapping.descCol}
                options={colOptions}
                onChange={(i) => updateMapping({ descCol: i })}
              />
            </Field>
          </div>

          <Field label="Valor">
            <div className="flex rounded-full border border-areia dark:border-white/10 overflow-hidden text-sm mb-2">
              {(["single", "split"] as const).map((mode) => (
                <button
                  key={mode}
                  onClick={() => updateMapping({ amountMode: mode })}
                  className={`flex-1 py-2 ${
                    mapping.amountMode === mode
                      ? "bg-terracota text-creme"
                      : "text-tinta/60 dark:text-creme/60"
                  }`}
                >
                  {mode === "single" ? "Uma coluna" : "Débito/Crédito"}
                </button>
              ))}
            </div>
            {mapping.amountMode === "single" ? (
              <ColSelect
                value={mapping.amountCol ?? 0}
                options={colOptions}
                onChange={(i) => updateMapping({ amountCol: i })}
              />
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <ColSelect
                  value={mapping.outCol ?? 0}
                  options={colOptions}
                  onChange={(i) => updateMapping({ outCol: i })}
                  placeholder="Débito"
                />
                <ColSelect
                  value={mapping.inCol ?? 0}
                  options={colOptions}
                  onChange={(i) => updateMapping({ inCol: i })}
                  placeholder="Crédito"
                />
              </div>
            )}
          </Field>

          <div>
            <div className="label">
              Pré-visualização ({preview.items.length} movimentos
              {preview.skippedRows > 0 && `, ${preview.skippedRows} linhas ignoradas`})
            </div>
            <div className="card divide-y divide-areia/50 dark:divide-white/5 max-h-52 overflow-y-auto">
              {preview.items.slice(0, 8).map((it) => (
                <div
                  key={it.external_id}
                  className="flex items-center justify-between gap-3 px-3 py-2 text-sm"
                >
                  <span className="min-w-0">
                    <span className="block truncate">{it.description_raw}</span>
                    <span className="text-xs text-tinta/50 dark:text-creme/50">
                      {formatDate(it.booking_date)}
                    </span>
                  </span>
                  <span
                    className={`tnum ${
                      it.amount_cents >= 0 ? "text-petroleo" : "text-terracota"
                    }`}
                  >
                    {formatSigned(it.amount_cents)}
                  </span>
                </div>
              ))}
              {preview.items.length === 0 && (
                <div className="px-3 py-4 text-sm text-tinta/50 dark:text-creme/50">
                  Nenhum movimento reconhecido — ajusta as colunas acima.
                </div>
              )}
            </div>
          </div>

          {error && <p className="text-sm text-terracota">{error}</p>}
          <button
            className="btn-primary w-full"
            disabled={busy || preview.items.length === 0}
            onClick={runImport}
          >
            {busy ? "A importar…" : `Importar ${preview.items.length} movimentos`}
          </button>
        </div>
      )}

      {stage === "done" && outcome && (
        <div className="space-y-4 text-center">
          <div className="text-4xl">✅</div>
          <div className="space-y-1">
            <p className="font-medium">{outcome.inserted} movimentos novos</p>
            {outcome.duplicates > 0 && (
              <p className="text-sm text-tinta/60 dark:text-creme/60">
                {outcome.duplicates} já existiam e foram ignorados.
              </p>
            )}
          </div>
          <button className="btn-primary w-full" onClick={close}>
            Concluir
          </button>
        </div>
      )}
    </Sheet>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="label">{label}</div>
      {children}
    </div>
  );
}

function ColSelect({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: number;
  options: { i: number; label: string }[];
  onChange: (i: number) => void;
  placeholder?: string;
}) {
  return (
    <select
      className="input appearance-none"
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    >
      {placeholder && <option value={-1}>{placeholder}</option>}
      {options.map((o) => (
        <option key={o.i} value={o.i}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
