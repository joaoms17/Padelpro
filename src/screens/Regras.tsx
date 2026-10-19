import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, EmptyState } from "@/components/ui";
import { CategoryPicker } from "@/components/CategoryPicker";
import { useAuth } from "@/auth/AuthProvider";
import { useHousehold } from "@/data/household";
import { listRules, createRule, deleteRule } from "@/data/rules";
import type { Rule } from "@/lib/types";

const FIELD_LABEL: Record<Rule["field"], string> = {
  merchant: "Comerciante",
  description: "Descrição",
  counterparty: "Contraparte",
  iban: "IBAN",
};
const MATCH_LABEL: Record<Rule["match_type"], string> = {
  equals: "igual a",
  contains: "contém",
  regex: "regex",
};

export function Regras() {
  const navigate = useNavigate();
  const { session } = useAuth();
  const { householdId, categoriesById } = useHousehold();
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function add() {
    if (!householdId || !pattern.trim() || !categoryId) return;
    setBusy(true);
    try {
      await createRule({
        householdId,
        field: "merchant",
        matchType: "contains",
        pattern: pattern.trim().toLowerCase(),
        categoryId,
        createdBy: session?.user.id ?? null,
      });
      setPattern("");
      setCategoryId(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await deleteRule(id);
    setRules((r) => r.filter((x) => x.id !== id));
  }

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
        subtitle="Categorização automática por comerciante."
      />

      <div className="card p-5 space-y-3">
        <div className="font-medium text-sm">Nova regra</div>
        <input
          className="input"
          placeholder="Se o comerciante contém… (ex: continente)"
          value={pattern}
          onChange={(e) => setPattern(e.target.value)}
        />
        <CategoryPicker value={categoryId} allowNone={false} onChange={setCategoryId} />
        <button
          className="btn-primary w-full"
          disabled={busy || !pattern.trim() || !categoryId}
          onClick={add}
        >
          Criar regra
        </button>
      </div>

      {loading ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : rules.length === 0 ? (
        <EmptyState
          title="Sem regras"
          hint="Cria uma aqui ou usa «Aplicar sempre» ao categorizar um movimento."
        />
      ) : (
        <div className="card divide-y divide-areia/50 dark:divide-white/5">
          {rules.map((r) => (
            <div key={r.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 text-sm">
                <div className="truncate">
                  <span className="text-tinta/50 dark:text-creme/50">
                    {FIELD_LABEL[r.field]} {MATCH_LABEL[r.match_type]}
                  </span>{" "}
                  «{r.pattern}»
                </div>
                <div className="text-xs text-petroleo">
                  → {categoriesById.get(r.category_id)?.name ?? "—"}
                </div>
              </div>
              <button
                className="text-sm text-terracota shrink-0"
                onClick={() => remove(r.id)}
              >
                Remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
