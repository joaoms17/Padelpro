// One card per group of movements: "Por categorizar" (choose a category once
// for the whole group) and "Por validar" (confirm what the app filed).
import { useEffect, useState } from "react";
import { CategoryPicker } from "./CategoryPicker";
import { Eur, Pill } from "./kit";
import { setCategoryMany, confirmSuggested } from "@/data/transactions";
import { learnKeywordRule, previewKeyword } from "@/data/rules";
import { normalizeKeyword } from "@shared/categorize";
import { errorMessage } from "@/lib/errors";
import { formatSigned } from "@/lib/format";
import { ruleReach, type CategoryRows, type TriageGroup as Group } from "@/lib/triage";
import type { EngineTx } from "@/lib/month";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "21/09" (and the year when it isn't this one). */
function shortDate(iso: string, today: string): string {
  const d = `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
  return iso.slice(0, 4) === today.slice(0, 4) ? d : `${d}/${iso.slice(2, 4)}`;
}

/** Σ |amount|, with the sign when money came in. */
function GroupTotal({ total, net, hasCredits }: { total: number; net: number; hasCredits: boolean }) {
  if (!hasCredits) return <Eur cents={total} />;
  return <Eur cents={net} signed tone={net > 0 ? "pos" : "none"} />;
}

function TxLines({
  rows,
  today,
  first,
  onOpen,
}: {
  rows: EngineTx[];
  today: string;
  first: number;
  onOpen: (t: EngineTx) => void;
}) {
  const [open, setOpen] = useState(false);
  const shown = open ? rows : rows.slice(0, first);
  return (
    <div className="divide-y divide-areia/50 dark:divide-white/5">
      {shown.map((t) => (
        <button
          key={t.id}
          onClick={() => onOpen(t)}
          className="w-full flex items-center gap-2 py-2 text-left text-sm active:opacity-60"
        >
          <span className="shrink-0 tnum text-tinta/50 dark:text-creme/50">{shortDate(t.booking_date, today)}</span>
          <span className="min-w-0 flex-1 truncate">
            {t.description_raw || "Sem descrição"}
            {t.pontual && <span className="ml-1.5 text-xs text-tinta/50 dark:text-creme/50">· pontual</span>}
          </span>
          <span className={`shrink-0 tnum ${t.amount_cents > 0 ? "text-petroleo" : ""}`}>{formatSigned(t.amount_cents)}</span>
        </button>
      ))}
      {rows.length > first && (
        <button onClick={() => setOpen((v) => !v)} className="w-full py-2 text-left text-sm text-petroleo">
          {open ? "Mostrar menos" : `+ ${rows.length - first}`}
        </button>
      )}
    </div>
  );
}

/** A group without a category: one choice files every movement in it. */
export function TriageGroup({
  group,
  today,
  categoryName,
  quick,
  householdId,
  createdBy,
  onOpen,
  onDone,
}: {
  group: Group<EngineTx>;
  today: string;
  categoryName: (id: string) => string;
  /** Quick choices for a transfer (Para o João, Para a Joana, Poupança). */
  quick: { id: string; label: string }[];
  householdId: string;
  createdBy: string | null;
  onOpen: (t: EngineTx) => void;
  /** After saving (reload); `notice` tells the screen what happened. */
  onDone: (notice: { tone: "ok" | "error"; text: string }) => Promise<void> | void;
}) {
  const [catId, setCatId] = useState<string | null>(group.suggestion);
  // A rule is only made when asked (and never for transfers: a person's name
  // is in money in and out alike).
  const [applyRule, setApplyRule] = useState(false);
  const [preview, setPreview] = useState<{ keyword: string; matches: number } | "error" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = group.rows.map((r) => r.id);
  const n = group.rows.length;
  const hasCredits = group.rows.some((r) => r.amount_cents > 0);
  const ruleKeyword = group.keyword && !group.transfer ? group.keyword : "";

  // Like the movement sheet: how many movements the word catches today, so a
  // too broad one shows before it files what is to come.
  useEffect(() => {
    if (!applyRule || !ruleKeyword) return;
    setPreview(null);
    let active = true;
    previewKeyword(householdId, ruleKeyword)
      .then((p) => active && setPreview(p))
      .catch(() => active && setPreview("error"));
    return () => {
      active = false;
    };
  }, [applyRule, ruleKeyword, householdId, attempt]);

  // The rule is only saved once the count shown is for this word.
  const previewFresh = preview != null && preview !== "error" && preview.keyword === normalizeKeyword(ruleKeyword);
  const ruleBlocked = applyRule && !!ruleKeyword && !previewFresh;

  async function save(categoryId: string) {
    setBusy(true);
    setError(null);
    let saved = 0;
    try {
      saved = await setCategoryMany(ids, categoryId);
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      return;
    }
    const skipped = n - saved;
    const done =
      `${plural(saved, "movimento", "movimentos")} em ${categoryName(categoryId)}` +
      (skipped > 0 ? ` (${skipped} já tinham sido categorizados por um de vocês e ficaram como estavam)` : "");
    let notice: { tone: "ok" | "error"; text: string } = { tone: "ok", text: `Guardado: ${done}.` };
    if (applyRule && ruleKeyword) {
      try {
        // Only the movements still to come: the past is never re-filed from here.
        await learnKeywordRule({ householdId, keyword: ruleKeyword, categoryId, createdBy, applyToPast: false });
        notice = {
          tone: "ok",
          text: `Guardado: ${done}. Os próximos que contêm “${ruleKeyword}” ficam já nesta categoria.`,
        };
      } catch (e) {
        notice = { tone: "error", text: `Guardado: ${done}, mas a regra para “${ruleKeyword}” falhou: ${errorMessage(e)}` };
      }
    }
    setBusy(false);
    await onDone(notice);
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{group.label}</div>
          <div className="text-xs text-tinta/50 dark:text-creme/50">
            {plural(n, "movimento", "movimentos")}
            {group.transfer && (group.incoming ? " · transferência recebida" : " · transferência enviada")}
          </div>
        </div>
        <div className="shrink-0 font-medium">
          <GroupTotal total={group.totalCents} net={group.netCents} hasCredits={hasCredits} />
        </div>
      </div>

      <TxLines rows={group.rows} today={today} first={3} onOpen={onOpen} />

      {group.transfer && quick.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quick.map((q) => (
            <button key={q.id} disabled={busy} onClick={() => save(q.id)} className="btn-ghost px-3 py-1.5 text-sm">
              {q.label}
            </button>
          ))}
        </div>
      )}

      <div className="space-y-1">
        <CategoryPicker value={catId} onChange={setCatId} allowNone={false} placeholder="Escolher categoria…" />
        {catId && catId === group.suggestion && (
          <div className="flex items-center gap-1.5 text-xs text-tinta/50 dark:text-creme/50">
            <Pill tone="amber">sugestão</Pill> escolhida pela app — muda se não for esta.
          </div>
        )}
      </div>

      {ruleKeyword && (
        <div className="space-y-1">
          <label className="flex items-start gap-2 text-sm text-tinta/70 dark:text-creme/70">
            <input
              type="checkbox"
              className="mt-0.5 w-4 h-4 accent-terracota"
              checked={applyRule}
              onChange={(e) => setApplyRule(e.target.checked)}
            />
            <span className="min-w-0">
              Aplicar também aos próximos
              <span className="block text-xs text-tinta/50 dark:text-creme/50 break-words">
                Os próximos que contêm “{ruleKeyword}” ficam nesta categoria.
              </span>
            </span>
          </label>
          {applyRule && (
            <p className="pl-6 text-xs text-tinta/50 dark:text-creme/50" aria-live="polite">
              {preview === "error" ? (
                <>
                  Não consegui contar os movimentos.{" "}
                  <button type="button" className="font-medium text-petroleo" onClick={() => setAttempt((a) => a + 1)}>
                    Tentar outra vez
                  </button>
                </>
              ) : !previewFresh ? (
                "A contar…"
              ) : (
                ruleReach(preview.matches, n)
              )}
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-terracota">Não consegui guardar: {error}</p>}

      <button className="btn-primary w-full py-2.5" disabled={!catId || busy || ruleBlocked} onClick={() => catId && !ruleBlocked && save(catId)}>
        {busy ? "A guardar…" : n === 1 ? "Guardar" : `Guardar os ${n}`}
      </button>
    </div>
  );
}

/** Movements the app filed in one category: confirm them all, or open one to change it. */
export function ValidateGroup({
  group,
  name,
  today,
  onOpen,
  onDone,
}: {
  group: CategoryRows<EngineTx>;
  name: string;
  today: string;
  onOpen: (t: EngineTx) => void;
  onDone: (notice: { tone: "ok" | "error"; text: string }) => Promise<void> | void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const n = group.rows.length;
  const hasCredits = group.rows.some((r) => r.amount_cents > 0);

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      await confirmSuggested(group.rows.map((r) => r.id));
    } catch (e) {
      setError(errorMessage(e));
      setBusy(false);
      return;
    }
    setBusy(false);
    await onDone({ tone: "ok", text: `Confirmado: ${plural(n, "movimento", "movimentos")} em ${name}.` });
  }

  return (
    <div className="card p-4 space-y-2">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium truncate">{name}</div>
          <div className="text-xs text-tinta/50 dark:text-creme/50">{plural(n, "movimento", "movimentos")}</div>
        </div>
        <div className="shrink-0 font-medium">
          <GroupTotal total={group.totalCents} net={group.netCents} hasCredits={hasCredits} />
        </div>
      </div>
      <TxLines rows={group.rows} today={today} first={5} onOpen={onOpen} />
      {error && <p className="text-sm text-terracota">Não consegui confirmar: {error}</p>}
      <div className="flex items-center justify-between gap-3 pt-1">
        <span className="text-xs text-tinta/50 dark:text-creme/50">Toca num movimento para o mudar.</span>
        <button className="btn-ghost shrink-0 px-4 py-2 text-sm" disabled={busy} onClick={confirm}>
          {busy ? "A confirmar…" : "✓ Está certo"}
        </button>
      </div>
    </div>
  );
}
