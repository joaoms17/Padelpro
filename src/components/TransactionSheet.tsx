import { useEffect, useMemo, useState } from "react";
import { Sheet } from "./Sheet";
import { CategoryPicker } from "./CategoryPicker";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import { setCategory, setNote, setPontual } from "@/data/transactions";
import { learnKeywordRule, previewKeyword } from "@/data/rules";
import { supabase } from "@/lib/supabase";
import { displayMerchant, isUsableKeyword, normalizeKeyword, suggestRuleKeyword } from "@shared/categorize";
import { isTransfer, type SuggestMember } from "@shared/suggest";
import { rowTitle, transferTargets } from "@/lib/triage";
import { formatSigned, formatDate } from "@/lib/format";
import { errorMessage } from "@/lib/errors";
import type { TransactionSource } from "@/lib/types";

/** What the sheet needs of a movement (an engine row or a full Transaction). */
export interface SheetTx {
  id: string;
  booking_date: string;
  amount_cents: number;
  description_raw: string | null;
  category_id: string | null;
  category_source?: string | null;
  pontual?: boolean | null;
  /** undefined: not loaded (the sheet reads it). */
  note?: string | null;
  source: TransactionSource;
  merchant_clean?: string | null;
}

const SUGGESTED = new Set(["sugestao", "ai"]);

const ORIGIN: Record<string, string> = {
  banco: "Banco",
  applepay: "Apple Pay (ainda sem par no banco)",
  extrato: "Extrato importado",
  manual: "Manual",
};

export function TransactionSheet({
  tx,
  onClose,
  onSaved,
  members = [],
}: {
  tx: SheetTx | null;
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  /** For the quick "Para o João / Para a Joana" buttons on a transfer. */
  members?: SuggestMember[];
}) {
  const { session } = useAuth();
  const { householdId, categories, categoriesById } = useHousehold();
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [pontual, setPontualOn] = useState(false);
  const [note, setNoteText] = useState("");
  // The stored note and clean name (read from the database when the row given has none).
  const [stored, setStored] = useState<{ note: string; merchant: string | null } | null>(null);
  const [applyAlways, setApplyAlways] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [preview, setPreview] = useState<{ keyword: string; matches: number; willChange: number } | "error" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCategoryId(tx?.category_id ?? null);
    setPontualOn(!!tx?.pontual);
    setApplyAlways(false);
    setKeyword(suggestRuleKeyword(tx?.description_raw ?? null));
    setPreview(null);
    setError(null);
    if (!tx) {
      setStored(null);
      setNoteText("");
      return;
    }
    if (tx.note !== undefined) {
      setStored({ note: tx.note ?? "", merchant: tx.merchant_clean ?? null });
      setNoteText(tx.note ?? "");
      return;
    }
    // An engine row has no note: read it, so typing one never wipes the old one.
    setStored(null);
    setNoteText("");
    let active = true;
    supabase
      .from("transactions")
      .select("id, note, merchant_clean")
      .eq("id", tx.id)
      .limit(1)
      .then(({ data, error: e }) => {
        if (!active) return;
        const row = ((data ?? []) as { id: string; note: string | null; merchant_clean: string | null }[]).find((r) => r.id === tx.id);
        if (e || !row) {
          setStored({ note: "", merchant: null });
          return;
        }
        setStored({ note: row.note ?? "", merchant: row.merchant_clean });
        setNoteText(row.note ?? "");
      });
    return () => {
      active = false;
    };
  }, [tx]);

  // Live count of the movements the keyword catches (debounced). The preview
  // records which keyword it is for, so a stale count is never shown/saved.
  useEffect(() => {
    if (!applyAlways || !householdId) return;
    setPreview(null);
    if (!isUsableKeyword(keyword)) return;
    let active = true;
    const t = setTimeout(() => {
      previewKeyword(householdId, keyword)
        .then((p) => active && setPreview(p))
        .catch(() => active && setPreview("error"));
    }, 350);
    return () => {
      active = false;
      clearTimeout(t);
    };
  }, [applyAlways, keyword, householdId]);

  const quick = useMemo(() => transferTargets(categories, members), [categories, members]);

  if (!tx) return null;

  const merchant = stored?.merchant || tx.merchant_clean || displayMerchant(tx.description_raw);
  const title = stored?.merchant || tx.merchant_clean || rowTitle(tx.description_raw) || "Movimento";
  const credit = tx.amount_cents > 0;
  const suggested = !!tx.category_id && SUGGESTED.has(tx.category_source ?? "");
  const categoryChanged = categoryId !== (tx.category_id ?? null);
  const pontualChanged = pontual !== !!tx.pontual;
  // "Aplicar sempre" when choosing (or confirming a suggested) category.
  const canRule = !!categoryId && !!merchant && (categoryChanged || suggested);
  // "Aplicar sempre" is only saved once the count shown is for this keyword.
  const previewFresh = preview != null && preview !== "error" && preview.keyword === normalizeKeyword(keyword);
  const ruleBlocked = applyAlways && canRule && (!isUsableKeyword(keyword) || !previewFresh);
  const current = tx.category_id ? categoriesById.get(tx.category_id) : undefined;

  async function save() {
    if (!tx) return;
    setBusy(true);
    setError(null);
    try {
      // A new category, or saving a suggested one (confirms it), makes it the
      // couple's own; changing only the note or Pontual leaves it as it was.
      if (categoryChanged || (suggested && categoryId)) await setCategory(tx.id, categoryId);
      if (applyAlways && canRule && categoryId && householdId) {
        await learnKeywordRule({
          householdId,
          keyword,
          categoryId,
          createdBy: session?.user.id ?? null,
          applyToPast: true,
        });
      }
      if (pontualChanged) await setPontual(tx.id, pontual);
      if (stored && note !== stored.note) await setNote(tx.id, note);
      await onSaved();
      onClose();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={!!tx} onClose={onClose} title="Movimento">
      <div className="space-y-4">
        <div className="card p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium truncate">{title}</div>
              {tx.description_raw && tx.description_raw !== title && (
                <div className="text-xs text-tinta/50 dark:text-creme/50 break-words">{tx.description_raw}</div>
              )}
              <div className="text-sm text-tinta/50 dark:text-creme/50">
                {formatDate(tx.booking_date)} · {ORIGIN[tx.source] ?? tx.source}
              </div>
            </div>
            <div className={`shrink-0 text-xl font-display tnum ${credit ? "text-petroleo" : ""}`}>{formatSigned(tx.amount_cents)}</div>
          </div>
        </div>

        {isTransfer(tx.description_raw) && quick.length > 0 && (
          <div>
            <div className="label">É uma transferência:</div>
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => (
                <button
                  key={q.id}
                  type="button"
                  onClick={() => setCategoryId(q.id)}
                  className={`rounded-full px-3 py-1.5 text-sm border ${
                    categoryId === q.id
                      ? "bg-tinta text-creme border-tinta dark:bg-creme dark:text-tinta dark:border-creme"
                      : "border-areia dark:border-white/10 text-tinta/70 dark:text-creme/70"
                  }`}
                >
                  {q.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <label className="label" htmlFor="tx-cat">Categoria</label>
          <CategoryPicker id="tx-cat" value={categoryId} onChange={setCategoryId} />
          {suggested && !categoryChanged && (
            <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-300">Sugerido pela app — guarda para confirmar.</p>
          )}
          {credit && (
            <p className="mt-1.5 text-xs text-tinta/50 dark:text-creme/50">Devolução de uma compra? Põe na categoria da compra.</p>
          )}
        </div>

        {canRule && (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm text-tinta/70 dark:text-creme/70">
              <input
                type="checkbox"
                className="w-4 h-4 accent-terracota"
                checked={applyAlways}
                onChange={(e) => setApplyAlways(e.target.checked)}
              />
              Aplicar sempre a movimentos que contêm…
            </label>
            {applyAlways && (
              <div className="pl-6 space-y-1">
                <input
                  className="input"
                  value={keyword}
                  onChange={(e) => setKeyword(e.target.value)}
                  placeholder="ex.: amazon"
                  aria-label="Texto que a descrição tem de conter"
                />
                <p className="text-xs text-tinta/50 dark:text-creme/50">
                  {!isUsableKeyword(keyword)
                    ? "Escreve uma parte da descrição com pelo menos 3 letras (sem códigos)."
                    : preview === "error"
                      ? "Não consegui contar os movimentos — tenta outra vez."
                      : !previewFresh
                        ? "A contar…"
                        : `Apanha ${preview.matches} movimento${preview.matches === 1 ? "" : "s"}` +
                          (preview.willChange > 0
                            ? ` · ${preview.willChange} passa${preview.willChange === 1 ? "" : "m"} a esta categoria`
                            : "") +
                          ". Os que categorizaste à mão ficam como estão."}
                </p>
              </div>
            )}
          </div>
        )}

        <label className="flex items-start gap-2 text-sm">
          <input
            type="checkbox"
            className="mt-0.5 w-4 h-4 accent-terracota"
            checked={pontual}
            onChange={(e) => setPontualOn(e.target.checked)}
          />
          <span>
            Pontual <span className="text-tinta/50 dark:text-creme/50">(não conta para as médias nem para o plano)</span>
          </span>
        </label>

        <div>
          <label className="label" htmlFor="tx-note">Nota</label>
          <input
            id="tx-note"
            className="input"
            placeholder={stored ? "Opcional" : "A carregar…"}
            disabled={!stored}
            value={note}
            onChange={(e) => setNoteText(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-terracota">Não consegui guardar: {error}</p>}

        <button className="btn-primary w-full" disabled={busy || ruleBlocked} onClick={save}>
          {busy ? "A guardar…" : "Guardar"}
        </button>
        {current && <p className="text-center text-xs text-tinta/40 dark:text-creme/40">Atual: {current.name}</p>}
      </div>
    </Sheet>
  );
}
