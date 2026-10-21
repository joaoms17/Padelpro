import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { PageHeader, Card } from "@/components/ui";
import { useHousehold } from "@/data/household";
import { loadMembers, updateMesada } from "@/data/settings";
import { parseCents, formatCents } from "@/lib/format";
import type { Member } from "@/lib/types";

export function Dinheiro() {
  const navigate = useNavigate();
  const { householdId } = useHousehold();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(false);

  const load = useCallback(async () => {
    if (!householdId) return;
    setLoading(true);
    try {
      setMembers(await loadMembers(householdId));
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    void load();
  }, [load]);

  function flash() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  async function saveMesada(m: Member, valor: string, dia: string) {
    const cents = parseCents(valor) ?? 0;
    const day = dia.trim() ? Math.min(28, Math.max(1, Number(dia))) : null;
    await updateMesada(m.id, cents, day);
    await load();
    flash();
  }

  return (
    <div className="space-y-6">
      <button
        className="text-sm text-tinta/50 dark:text-creme/50"
        onClick={() => navigate("/definicoes")}
      >
        ‹ Definições
      </button>
      <PageHeader title="Mesadas" subtitle="Quanto vai para cada um, e quando." />

      <Link to="/mesadas" className="card p-4 block active:scale-[0.99] transition-transform">
        <div className="font-medium">Módulo Mesadas →</div>
        <div className="text-xs text-tinta/50 dark:text-creme/50 mt-0.5">
          Mês a mês, simulador e mesada sustentável
        </div>
      </Link>

      {saved && <p className="text-sm text-petroleo">Guardado ✓</p>}

      {loading ? (
        <div className="py-6 text-center text-tinta/50 dark:text-creme/50">A carregar…</div>
      ) : (
        <section>
          <div className="space-y-3">
            {members.map((m) => (
              <MesadaRow key={m.id} member={m} onSave={saveMesada} />
            ))}
          </div>
          <p className="text-xs text-tinta/40 dark:text-creme/40 mt-2">
            A transferência mensal para a conta pessoal de cada um. A app regista
            a saída, mas não acompanha o que fazes com ela.
          </p>
        </section>
      )}
    </div>
  );
}

function MesadaRow({
  member,
  onSave,
}: {
  member: Member;
  onSave: (m: Member, valor: string, dia: string) => void;
}) {
  const [valor, setValor] = useState(
    member.mesada_cents ? (member.mesada_cents / 100).toString() : "",
  );
  const [dia, setDia] = useState(member.mesada_day ? String(member.mesada_day) : "");

  return (
    <Card>
      <div className="font-medium mb-2">{member.display_name}</div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="label">Valor</label>
          <input
            inputMode="decimal"
            className="input"
            placeholder="0,00 €"
            value={valor}
            onChange={(e) => setValor(e.target.value)}
            onBlur={() => onSave(member, valor, dia)}
          />
        </div>
        <div>
          <label className="label">Dia do mês</label>
          <input
            inputMode="numeric"
            className="input"
            placeholder="1–28"
            value={dia}
            onChange={(e) => setDia(e.target.value.replace(/\D/g, ""))}
            onBlur={() => onSave(member, valor, dia)}
          />
        </div>
      </div>
      {member.mesada_cents > 0 && (
        <div className="text-xs text-tinta/40 dark:text-creme/40 mt-2">
          Atual: {formatCents(member.mesada_cents)}
          {member.mesada_day ? ` · dia ${member.mesada_day}` : ""}
        </div>
      )}
    </Card>
  );
}
