import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, EmptyState } from "@/components/ui";
import { Sheet } from "@/components/Sheet";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import {
  applyKeywordToPast,
  deleteRule,
  learnKeywordRule,
  listRules,
  updateRule,
} from "@/data/rules";
import { isUsableKeyword, normalizeKeyword } from "@shared/categorize";
import { GROUP_ORDER } from "@/lib/categories";
import type { Rule } from "@/lib/types";
import { errorMessage } from "@/lib/errors";

const FIELD_LABEL: Record<Rule["field"], string> = {
  merchant: "Descrição",
  description: "Descrição exata",
  counterparty: "Contraparte",
  iban: "IBAN",
};
const MATCH_LABEL: Record<Rule["match_type"], string> = {
  equals: "igual a",
  contains: "contém",
  regex: "regex",
};

const isKeywordRule = (r: Rule) => r.field === "merchant" && r.match_type === "contains";

export function Regras() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { householdId, categories, categoriesById, groupLabels } = useHousehold();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<Rule | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      setRules(await listRules(householdId));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Run a change and reload; true if it worked (the error is shown otherwise). */
  async function act(fn: () => Promise<string | void>): Promise<boolean> {
    setBusy(true);
    setError(null);
    setMsg(null);
    try {
      const m = await fn();
      if (m) setMsg(m);
      await load();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }

  function edit(r: Rule | null) {
    setError(null);
    setEditing(r);
  }

  function add() {
    if (!householdId || !categoryId) return;
    return act(async () => {
      const n = await learnKeywordRule({
        householdId,
        keyword: pattern,
        categoryId,
        createdBy: session?.user.id ?? null,
        applyToPast: true,
      });
      setPattern("");
      setCategoryId(null);
      return `Regra criada · ${n} movimento${n === 1 ? "" : "s"} categorizado${n === 1 ? "" : "s"}.`;
    });
  }

  // Rules grouped by their category, in the same order as the category picker.
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = rules.filter((r) => {
      if (!q) return true;
      const cat = categoriesById.get(r.category_id)?.name.toLowerCase() ?? "";
      return r.pattern.toLowerCase().includes(q) || cat.includes(q);
    });
    const order = new Map(
      [...categories]
        .sort((a, b) => GROUP_ORDER.indexOf(a.grp) - GROUP_ORDER.indexOf(b.grp) || a.sort - b.sort)
        .map((c, i) => [c.id, i]),
    );
    const byCat = new Map<string, Rule[]>();
    for (const r of visible) byCat.set(r.category_id, [...(byCat.get(r.category_id) ?? []), r]);
    return [...byCat.entries()].sort(
      ([a], [b]) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9),
    );
  }, [rules, query, categories, categoriesById]);

  return (
    <div className="space-y-5">
      <button
        className="text-sm text-tinta/50 dark:text-creme/50"
        onClick={() => navigate("/definicoes")}
      >
        ‹ Definições
      </button>
      <PageHeader
        title="Regras"
        subtitle="O que cada regra põe em que categoria. Toca numa regra para a mudar."
      />

      <div className="card p-5 space-y-3">
        <div className="font-medium text-sm">Nova regra</div>
        <input
          className="input"
          placeholder="Se a descrição contém… (ex: amazon)"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <CategoryPicker value={categoryId} allowNone={false} onChange={setCategoryId} />
        <button
          className="btn-primary w-full"
          disabled={busy || !isUsableKeyword(pattern) || !categoryId}
          onClick={add}
        >
          Criar e aplicar aos movimentos
        </button>
        {pattern && !isUsableKeyword(pattern) && (
          <p className="text-xs text-tinta/50 dark:text-creme/50">Pelo menos 3 letras, sem códigos.</p>
        )}
      </div>

      {msg && <p className="text-sm text-petroleo">{msg}</p>}
      {error && !editing && <p className="text-sm text-terracota">{error}</p>}

      {rules.length > 0 && (
        <input
          className="input"
          placeholder="Procurar regra ou categoria…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      )}

      {loading ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : rules.length === 0 ? (
        <EmptyState
          title="Sem regras"
          hint="Cria uma aqui ou usa «Aplicar sempre» ao categorizar um movimento."
        />
      ) : groups.length === 0 ? (
        <p className="text-sm text-tinta/50 dark:text-creme/50 text-center">Nada encontrado.</p>
      ) : (
        groups.map(([catId, list]) => {
          const cat = categoriesById.get(catId);
          return (
            <section key={catId}>
              <h2 className="text-sm font-semibold text-tinta/60 dark:text-creme/60 mb-2">
                {cat?.name ?? "Categoria removida"}
                {cat && (
                  <span className="font-normal text-tinta/40 dark:text-creme/40"> · {groupLabels[cat.grp]}</span>
                )}
              </h2>
              <div className="card divide-y divide-areia/50 dark:divide-white/5">
                {list.map((r) => (
                  <button
                    key={r.id}
                    className="w-full text-left px-4 py-3 text-sm flex items-center justify-between gap-3"
                    onClick={() => edit(r)}
                  >
                    <span className="min-w-0 truncate">
                      {!isKeywordRule(r) && (
                        <span className="text-tinta/50 dark:text-creme/50">
                          {FIELD_LABEL[r.field]} {MATCH_LABEL[r.match_type]}{" "}
                        </span>
                      )}
                      «{r.pattern}»
                    </span>
                    <span className="text-xs text-petroleo shrink-0">Editar</span>
                  </button>
                ))}
              </div>
            </section>
          );
        })
      )}

      <EditRule
        rule={editing}
        busy={busy}
        error={error}
        onClose={() => edit(null)}
        onSave={(r, patch) =>
          act(async () => {
            const reapply = patch.reapply && !!householdId && isKeywordRule(r);
            await updateRule(r, { ...patch, toTop: reapply });
            if (reapply) {
              const n = await applyKeywordToPast(
                householdId!,
                patch.pattern != null ? normalizeKeyword(patch.pattern) : r.pattern,
                patch.categoryId ?? r.category_id,
              );
              return `Regra guardada · ${n} movimento${n === 1 ? "" : "s"} atualizado${n === 1 ? "" : "s"}.`;
            }
            return "Regra guardada.";
          })
        }
        onDelete={(r) =>
          act(async () => {
            await deleteRule(r.id);
            return "Regra apagada. Os movimentos já categorizados ficam como estão.";
          })
        }
      />
    </div>
  );
}

function EditRule({
  rule,
  busy,
  error,
  onClose,
  onSave,
  onDelete,
}: {
  rule: Rule | null;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (r: Rule, patch: { pattern?: string; categoryId?: string; reapply: boolean }) => Promise<boolean>;
  onDelete: (r: Rule) => Promise<boolean>;
}) {
  const { categoriesById } = useHousehold();
  const [pattern, setPattern] = useState("");
  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [reapply, setReapply] = useState(true);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    setPattern(rule?.pattern ?? "");
    // A rule whose category was removed must get a new one chosen.
    setCategoryId(rule && categoriesById.has(rule.category_id) ? rule.category_id : null);
    setReapply(true);
    setConfirmDelete(false);
    // Reset only when another rule opens, not on a background category reload.
  }, [rule]);

  if (!rule) return null;
  const keyword = isKeywordRule(rule);
  const patternChanged = pattern !== rule.pattern;
  // Only a changed text is checked: an old rule that is fine as it is stays editable.
  const valid = !patternChanged || (keyword ? isUsableKeyword(pattern) : !!pattern.trim());
  const categoryChanged = !!categoryId && categoryId !== rule.category_id;
  const canReapply = keyword && reapply;

  return (
    <Sheet open={!!rule} onClose={onClose} title="Regra">
      <div className="space-y-4">
        <div>
          <label className="label" htmlFor="rule-pattern">
            {keyword ? "Quando a descrição contém" : `${FIELD_LABEL[rule.field]} ${MATCH_LABEL[rule.match_type]}`}
          </label>
          <input
            id="rule-pattern"
            className="input"
            value={pattern}
            onChange={(e) => setPattern(e.target.value)}
          />
          {!valid && (
            <p className="text-xs text-terracota mt-1">
              {keyword ? "Pelo menos 3 letras, sem códigos." : "Não pode ficar vazia."}
            </p>
          )}
        </div>
        <div>
          <label className="label" htmlFor="rule-cat">Vai para a categoria</label>
          <CategoryPicker id="rule-cat" value={categoryId} allowNone={false} onChange={setCategoryId} />
          {!categoriesById.has(rule.category_id) && (
            <p className="text-xs text-terracota mt-1">A categoria desta regra foi removida — escolhe outra.</p>
          )}
        </div>
        {keyword && (
          <label className="flex items-center gap-2 text-sm text-tinta/70 dark:text-creme/70">
            <input
              type="checkbox"
              className="w-4 h-4 accent-terracota"
              checked={reapply}
              onChange={(e) => setReapply(e.target.checked)}
            />
            Aplicar também aos movimentos que já existem — e passa a ter prioridade sobre as outras regras
          </label>
        )}
        <button
          className="btn-primary w-full"
          disabled={busy || !valid || !categoryId || (!patternChanged && !categoryChanged && !canReapply)}
          onClick={async () => {
            const ok = await onSave(rule, {
              pattern: patternChanged ? pattern : undefined,
              categoryId: categoryChanged ? categoryId! : undefined,
              reapply: canReapply,
            });
            if (ok) onClose();
          }}
        >
          Guardar
        </button>

        {error && <p className="text-sm text-terracota">{error}</p>}

        <div className="pt-2 border-t border-areia/50 dark:border-white/5">
          {!confirmDelete ? (
            <button className="text-sm text-terracota" onClick={() => setConfirmDelete(true)}>
              Apagar regra…
            </button>
          ) : (
            <button
              className="btn-ghost w-full text-terracota"
              disabled={busy}
              onClick={async () => {
                if (await onDelete(rule)) onClose();
              }}
            >
              Confirmar: apagar esta regra
            </button>
          )}
        </div>
      </div>
    </Sheet>
  );
}
