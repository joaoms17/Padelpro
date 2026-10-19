import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { PageHeader, Card } from "@/components/ui";
import { useAuth } from "@/auth/AuthProvider";
import {
  ingestUrl,
  generateToken,
  listTokens,
  revokeToken,
  type IngestToken,
} from "@/data/applepay";

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be blocked */
    }
  }
  return (
    <div>
      <div className="label">{label}</div>
      <button
        onClick={copy}
        className="w-full text-left input font-mono text-xs break-all active:opacity-70"
        title="Tocar para copiar"
      >
        {value}
      </button>
      <div className="text-[11px] text-petroleo mt-1 h-4">
        {copied ? "Copiado ✓" : "Toca para copiar"}
      </div>
    </div>
  );
}

export function ApplePay() {
  const navigate = useNavigate();
  const { member } = useAuth();
  const [tokens, setTokens] = useState<IngestToken[]>([]);
  const [fresh, setFresh] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (member) setTokens(await listTokens(member.id));
  }, [member]);

  useEffect(() => {
    void load();
  }, [load]);

  async function create() {
    if (!member) return;
    setBusy(true);
    try {
      setFresh(await generateToken(member.id));
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function revoke(id: string) {
    await revokeToken(id);
    await load();
  }

  const active = tokens.filter((t) => !t.revoked_at);

  return (
    <div className="space-y-5">
      <button
        className="text-sm text-tinta/50 dark:text-creme/50"
        onClick={() => navigate("/definicoes")}
      >
        ‹ Definições
      </button>
      <PageHeader
        title="Atalho Apple Pay"
        subtitle="Cada pagamento com Apple Pay aparece na app em segundos."
      />

      <Card className="space-y-4">
        <CopyRow label="URL do pedido (POST)" value={ingestUrl()} />

        {fresh ? (
          <div className="space-y-2">
            <CopyRow label="O teu token pessoal (só aparece agora)" value={fresh} />
            <p className="text-xs text-terracota">
              Guarda-o já no Atalho — não volta a ser mostrado.
            </p>
          </div>
        ) : (
          <button className="btn-primary w-full" onClick={create} disabled={busy}>
            {busy ? "A gerar…" : "Gerar token pessoal"}
          </button>
        )}
      </Card>

      {active.length > 0 && (
        <Card>
          <div className="label">Tokens ativos</div>
          <div className="divide-y divide-areia/50 dark:divide-white/5">
            {active.map((t) => (
              <div key={t.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="text-tinta/60 dark:text-creme/60">
                  Criado {new Date(t.created_at).toLocaleDateString("pt-PT")}
                  {t.last_used_at && (
                    <> · usado {new Date(t.last_used_at).toLocaleDateString("pt-PT")}</>
                  )}
                </div>
                <button className="text-terracota" onClick={() => revoke(t.id)}>
                  Revogar
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <Card>
        <div className="label">Como configurar (uma vez por iPhone)</div>
        <ol className="text-sm text-tinta/70 dark:text-creme/70 space-y-1.5 list-decimal list-inside">
          <li>App Atalhos → Automação → Nova automação pessoal → <b>Transação</b></li>
          <li>Quando: um cartão Santander da Carteira · Executar imediatamente</li>
          <li>Ação <b>Receber transação como entrada</b> (dá comerciante e valor)</li>
          <li>
            Ação <b>Obter conteúdo do URL</b>: método POST para o URL acima, corpo
            JSON <code className="text-xs">{`{amount, merchant, card, occurred_at}`}</code>
          </li>
          <li>
            Cabeçalho <code className="text-xs">Authorization: Bearer &lt;token&gt;</code> com o
            teu token pessoal
          </li>
        </ol>
      </Card>

      <p className="text-xs text-tinta/40 dark:text-creme/40 leading-relaxed">
        O pagamento entra como provisório e funde-se automaticamente com o
        movimento do banco quando este chega (sem contar a dobrar).
      </p>
    </div>
  );
}
