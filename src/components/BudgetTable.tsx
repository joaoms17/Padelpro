// Plano: what each category cost in the last months, its average and the
// value the plan counts on (expected value for contas fixas, limit for the
// dia a dia). Narrow enough for a phone: fixed layout, small text.
import { useEffect, useRef, useState } from "react";
import { centsInput, euroNum, parseInput, type BudgetRow } from "@/lib/planView";
import { monthShort } from "@/lib/format";

/**
 * A euro amount typed by hand. `onChange` on every valid keystroke (live
 * totals), `onCommit` on blur or Enter with the final value (null: empty).
 */
export function EuroInput({
  value,
  onChange,
  onCommit,
  size = "md",
  id,
  label,
  placeholder,
  disabled,
}: {
  value: number | null;
  onChange?: (cents: number | null) => void;
  onCommit?: (cents: number | null) => void;
  size?: "sm" | "md";
  id?: string;
  /** Accessible name when there is no visible <label>. */
  label?: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  const [text, setText] = useState(centsInput(value));
  const focused = useRef(false);

  // Follow the value from outside ("Usar as médias", a reload) unless typing.
  useEffect(() => {
    if (!focused.current) setText(centsInput(value));
  }, [value]);

  const cls =
    size === "sm"
      ? "w-full rounded-lg border border-areia dark:border-white/10 bg-white/80 dark:bg-white/[0.04] px-1.5 py-1 text-right text-xs tnum text-tinta dark:text-creme outline-none focus:border-petroleo focus:ring-2 focus:ring-petroleo/20 disabled:opacity-50"
      : "input tnum text-right pr-9";

  const input = (
    <input
      id={id}
      aria-label={label}
      className={cls}
      inputMode="decimal"
      enterKeyHint="done"
      placeholder={placeholder ?? (size === "sm" ? "—" : "0")}
      value={text}
      disabled={disabled}
      onFocus={() => {
        focused.current = true;
      }}
      onChange={(e) => {
        setText(e.target.value);
        const v = parseInput(e.target.value);
        if (v !== "invalid") onChange?.(v);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") (e.target as HTMLInputElement).blur();
      }}
      onBlur={() => {
        focused.current = false;
        const v = parseInput(text);
        if (v === "invalid") {
          setText(centsInput(value));
          return;
        }
        setText(centsInput(v));
        onCommit?.(v);
      }}
    />
  );
  if (size === "sm") return input;
  return (
    <div className="relative">
      {input}
      <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-tinta/50 dark:text-creme/50">€</span>
    </div>
  );
}

export function BudgetTable({
  rows,
  extraRows = [],
  months,
  averageMonths,
  limitLabel,
  covered = [],
  onCommit,
}: {
  /** The rows that add up to the total. */
  rows: BudgetRow[];
  /** Shown after the total (e.g. Trabalho da Joana under the dia a dia). */
  extraRows?: BudgetRow[];
  /** The months shown as columns (the last closed ones). */
  months: string[];
  /** The months the average comes from (others get a "*"). */
  averageMonths: string[];
  limitLabel: string;
  /** Categories paid from the mesadas: no limit here. */
  covered?: string[];
  onCommit: (categoryId: string, cents: number | null) => void;
}) {
  const counted = rows.filter((r) => !covered.includes(r.id));
  const sum = (f: (r: BudgetRow) => number) => counted.reduce((a, r) => a + f(r), 0);
  const outOfAverage = months.some((m) => !averageMonths.includes(m));

  const row = (r: BudgetRow) => {
    const isCovered = covered.includes(r.id);
    return (
      <tr key={r.id} className={`border-t border-areia/50 dark:border-white/5 ${isCovered ? "text-tinta/40 dark:text-creme/40" : ""}`}>
        <td className="py-1.5 pr-1 text-xs leading-tight break-words">{r.name}</td>
        {months.map((m) => (
          <td key={m} className="py-1.5 px-0.5 text-right text-xs tnum text-tinta/60 dark:text-creme/60">
            {euroNum(r.perMonth[m] ?? 0)}
          </td>
        ))}
        <td className="py-1.5 px-0.5 text-right text-xs tnum font-medium">{euroNum(r.mean)}</td>
        <td className="py-1 pl-1.5">
          {isCovered ? (
            <span className="block text-right text-[11px] leading-tight">na mesada</span>
          ) : (
            <EuroInput size="sm" value={r.budget} label={`${limitLabel} ${r.name}`} onCommit={(v) => v !== r.budget && onCommit(r.id, v)} />
          )}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <table className="w-full table-fixed">
        <colgroup>
          <col />
          {months.map((m) => (
            <col key={m} className="w-11" />
          ))}
          <col className="w-12" />
          <col className="w-[4.5rem]" />
        </colgroup>
        <thead>
          <tr className="text-[11px] text-tinta/50 dark:text-creme/50">
            <th className="pb-1 text-left font-medium">Categoria</th>
            {months.map((m) => (
              <th key={m} className="pb-1 px-0.5 text-right font-medium">
                {monthShort(m)}
                {!averageMonths.includes(m) && "*"}
              </th>
            ))}
            <th className="pb-1 px-0.5 text-right font-medium">Média</th>
            <th className="pb-1 pl-1.5 text-right font-medium">{limitLabel} €</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(row)}
          <tr className="border-t-2 border-areia dark:border-white/10 font-semibold">
            <td className="py-1.5 pr-1 text-xs">Total</td>
            {months.map((m) => (
              <td key={m} className="py-1.5 px-0.5 text-right text-xs tnum">
                {euroNum(sum((r) => r.perMonth[m] ?? 0))}
              </td>
            ))}
            <td className="py-1.5 px-0.5 text-right text-xs tnum">{euroNum(sum((r) => r.mean))}</td>
            <td className="py-1.5 pl-1.5 text-right text-xs tnum">{euroNum(sum((r) => r.budget ?? 0))}</td>
          </tr>
          {extraRows.map(row)}
        </tbody>
      </table>
      {outOfAverage && (
        <p className="mt-2 text-[11px] text-tinta/50 dark:text-creme/50">* fora da média: ainda com movimentos sem categoria.</p>
      )}
    </div>
  );
}
