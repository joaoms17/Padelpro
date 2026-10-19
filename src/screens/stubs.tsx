import { Stub } from "./Stub";

export function PorRever() {
  return (
    <Stub
      title="Por rever"
      subtitle="O que precisa de um toque teu."
      milestone="M4"
      points={[
        "Categorias com baixa confiança da IA",
        "Correspondências evento ↔ entrada por confirmar",
        "Apple Pay sem par ao fim de 7 dias",
        "Fixas que mudaram de valor",
      ]}
    />
  );
}

export function Metricas() {
  return (
    <Stub
      title="Métricas"
      subtitle="Sobra, poupança, almofada e previsão."
      milestone="M8"
      points={[
        "Sobra do mês e taxa de poupança",
        "Almofada disponível em euros e em meses",
        "Previsão de fim de mês",
        "Evolução de 12 meses e sazonalidade",
      ]}
    />
  );
}

export function Objetivos() {
  return (
    <Stub
      title="Objetivos"
      subtitle="Reservas virtuais dentro da almofada."
      milestone="M8"
      points={[
        "Férias, concertos, amortização do crédito",
        "Valor alvo, data limite e valor reservado",
        "Quanto falta reservar por mês para chegar a tempo",
      ]}
    />
  );
}

export function Pergunta() {
  return (
    <Stub
      title="Pergunta à app"
      subtitle="Faz perguntas sobre as vossas contas."
      milestone="M10"
      points={[
        '"Quanto gastámos em restaurantes este ano?"',
        '"Quanto falta receber dos eventos de maio?"',
        "Respostas da IA sobre funções de leitura seguras (sem SQL livre)",
      ]}
    />
  );
}
