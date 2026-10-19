import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, Card, EmptyState } from "@/components/ui";
import { useHousehold } from "@/data/household";
import {
  listJoanaSources,
  addJoanaSource,
  deleteJoanaSource,
  type JoanaSource,
} from "@/data/settings";

export function JoanaFontes() {
  const navigate = useNavigate();
  const { householdId } = useHousehold();
  const [sources, setSources] = useState<JoanaSource[]>([]);
  const [label, setLabel] = useState("");
  const [pattern, setPattern] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      setSources(await listJoanaSources(householdId));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function add() {
    if (!householdId || !label.trim() || !pattern.trim()) return;
    setBusy(true);
    try {
      await addJoanaSource(householdId, label.trim(), pattern.trim());
      setLabel("");
      setPattern("");
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    await deleteJoanaSource(id);
    setSources((s) => s.filter((x) => x.id !== id));
  }

  return (
    <div className="space-y-5">
      <button className="text-sm text-tinta/50 dark:text-creme/50" onClick={() => navigate("/definicoes")}>
        ‹ Definições
      </button>
      <PageHeader
        title="Contas de origem da Joana"
        subtitle="Para reconhecer depósitos/transferências dela (Revolut, numerário)."
      />

      <Card className="space-y-3">
        <div className="font-medium text-sm">Nova conta de origem</div>
        <input className="input" placeholder="Nome (ex: Revolut Joana)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input" placeholder="Texto no ordenante (ex: joana)" value={pattern} onChange={(e) => setPattern(e.target.value)} />
        <button className="btn-primary w-full" disabled={busy || !label.trim() || !pattern.trim()} onClick={add}>
          Adicionar
        </button>
      </Card>

      {loading ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : sources.length === 0 ? (
        <EmptyState title="Sem contas de origem" hint="Adiciona uma para as transferências da Joana serem reconhecidas." />
      ) : (
        <div className="card divide-y divide-areia/50 dark:divide-white/5">
          {sources.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
              <div>
                <div className="font-medium">{s.label}</div>
                <div className="text-xs text-tinta/50 dark:text-creme/50">contém «{s.name_pattern}»</div>
              </div>
              <button className="text-terracota" onClick={() => remove(s.id)}>Remover</button>
            </div>
          ))}
        </div>
      )}

      <p className="text-xs text-tinta/40 dark:text-creme/40 leading-relaxed">
        Quando entra um depósito destas contas, a app propõe em «Por rever» quais
        pagamentos de eventos «por transferir» ele liquida.
      </p>
    </div>
  );
}
