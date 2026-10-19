# Contas a Dois - Especificação da app (v1)

> Documento para o Claude Code. Lê tudo antes de começar. Constrói pela ordem dos marcos (secção 14) e, em cada marco, cumpre os critérios de aceitação antes de avançar. Se alguma decisão aqui não fizer sentido técnico, pergunta antes de te desviares.

---

## 1. O que é

App pessoal do casal **João e Joana** para gerir o dinheiro da casa a partir de **uma só conta (Santander)**, com o mínimo de trabalho manual e métricas claras.

A app:
- lê automaticamente os movimentos do Santander (open banking, só leitura);
- recebe em tempo real os pagamentos feitos com Apple Pay nos dois iPhones;
- categoriza tudo com regras + IA e aprende com as correções;
- gere os **eventos da Joana** (sinal, restante, numerário, MB Way, Revolut);
- mostra orçamento do mês, sobra, taxa de poupança, almofada e objetivos;
- avisa por notificação quando algo merece atenção.

**Princípios**
1. Automático primeiro, manual só quando não há alternativa.
2. Uma conta central: a Conta Casa (Santander).
3. As mesadas são privadas: a app regista a saída da mesada, mas nunca acompanha o que cada um faz com ela.
4. A app nunca mexe em dinheiro: não faz pagamentos nem transferências.
5. Interface em português de Portugal, euros em formato `1 234,56 €`, datas `dd/mm/aaaa`, fuso `Europe/Lisbon`.

---

## 2. Regras de negócio (modelo financeiro)

### 2.1 Conta
- **Uma só conta**: a conta à ordem do Santander (Conta Casa), com o João e a Joana como cotitulares.
- Tudo entra e sai daqui, e **o que sobra fica lá como almofada**. Não há contas poupança separadas na v1.
- O modelo de dados mantém o campo `role` nas contas (`casa`, `outra`) para se poder acrescentar outra conta no futuro sem mexer na estrutura.

### 2.2 Entradas
- Salário e extras do João (cai no Santander).
- Renda da casa arrendada (cai no Santander).
- Ganhos dos eventos da Joana: podem chegar por transferência, MB Way, numerário ou Revolut. Numerário e Revolut chegam ao Santander mais tarde, quando a Joana deposita ou transfere.

### 2.3 Saídas
- **Fixas e prestações** (débitos diretos: crédito habitação, luz, água, internet, seguros...).
- **Variáveis do casal** (supermercado, combustível, saídas, Maggie...).
- **Atividade da Joana** (material, deslocações, alojamento em trabalho). Saem da Conta Casa, mas ficam marcadas como gastos da atividade.
- **Mesadas**: transferência mensal fixa para a conta pessoal de cada um.
- **Investimento**: fora da app. Cada um investe com a sua mesada.

### 2.4 Base fixa
`Base fixa = salário do João + renda da casa arrendada`.
A base fixa tem de cobrir fixas + prestações + as duas mesadas. A app mostra esta cobertura e avisa se deixar de cobrir.

### 2.5 Ganhos da Joana
Cada pagamento de evento que chega à Conta Casa conta como entrada e reforça a almofada. Os gastos da atividade saem da Conta Casa e ficam identificados, para se saber quanto os eventos deixam de facto em casa.

### 2.6 Almofada
- A almofada **é o dinheiro que sobra na Conta Casa** depois de garantidos os compromissos do mês. Não há transferências para outra conta: o que sobra no fim de cada mês fica e vai acumulando.
- Alvo configurável em **meses de despesas** (ex.: `[__]` meses).
- Em meses fortes a almofada cresce; em meses fracos cobre a diferença.
- **Objetivos** (férias, concertos, amortização) são reservas virtuais dentro da almofada: o valor é marcado na app, o dinheiro não sai da conta.

---

## 3. Utilizadores e acesso

- Um **agregado** (`household`) com dois membros: João e Joana. Os dois veem e editam tudo.
- **Autenticação**: Supabase Auth com **código OTP de 6 dígitos por email** (não usar magic link: no iPhone o link abre no Safari e não na PWA instalada). Sessão persistente.
- **Bloqueio local** opcional com PIN de 4 dígitos ao abrir a app (como no Projeto Suarez).
- **RLS** em todas as tabelas: só membros do agregado leem/escrevem as linhas com o seu `household_id`.

---

## 4. Fontes de dados

### 4.1 Santander via Enable Banking (automático, diário)

Enable Banking em **modo restrito**: gratuito para ler as próprias contas, desde que as contas sejam ligadas no Control Panel.

**Configuração única (o João faz à mão, documentar no README):**
1. Registo em enablebanking.com e confirmação por email.
2. Control Panel > API Applications > nova aplicação em **Production**, chave privada gerada no browser (descarrega um `.pem`), redirect URL `https://<dominio-da-app>/ligar-banco/callback`.
3. Guardar o **Application ID**.
4. Na aplicação, **Link accounts**: ligar o Santander e autorizar (sem isto a API não devolve contas).
5. Guardar `EB_APP_ID` e `EB_PRIVATE_KEY` nos secrets das Edge Functions do Supabase. Nunca no frontend.

**API (base `https://api.enablebanking.com`):**
- Autenticação: JWT **RS256** no header `Authorization: Bearer`, com `kid` = Application ID, claims `iss: "enablebanking.com"`, `aud: "api.enablebanking.com"`, `iat`, `exp` (máximo 24 h). Em Deno usar `jose` (`importPKCS8` + `SignJWT`).
- `GET /aspsps?country=PT` para obter o nome exato do Santander e o `maximum_consent_validity`. Não fazer hardcode do nome do banco.
- `POST /auth` com `access.valid_until` (agora + validade máxima do banco), `aspsp {name, country}`, `state`, `redirect_url`, `psu_type: "personal"` → devolve URL para o utilizador autorizar na app do Santander.
- Callback com `code` → `POST /sessions {code}` → guardar `session_id`, `valid_until` e o `uid` da conta.
- `GET /accounts/{uid}/balances` e `GET /accounts/{uid}/transactions?date_from=...&date_to=...` com paginação por `continuation_key`.
- Campos a usar: `transaction_amount`, `credit_debit_indicator`, `booking_date`, `value_date`, `remittance_information`, `creditor.name`, `debtor.name`, `entry_reference`, `transaction_id`, `status`.

**Sincronização:**
- `pg_cron` às **07:00 e 19:00** (Lisboa) chama a Edge Function `eb-sync`, mais um botão "Sincronizar agora".
- Pede sempre desde `ultima_sync - 5 dias` para apanhar movimentos que passam de pendentes a contabilizados.
- **Deduplicação**: chave única `(account_id, external_id)`, com `external_id` = `transaction_id` ou `entry_reference` ou, em último caso, hash de `booking_date + amount + remittance`.
- Movimentos pendentes são atualizados quando passam a contabilizados (não criar duplicados).
- Atualizar o saldo da Conta Casa em cada sync.
- **Expiração do consentimento**: avisar 14 e 3 dias antes de `valid_until`; botão "Renovar ligação" repete o fluxo `POST /auth`.
- Erros de sync ficam visíveis em Definições > Ligação ao banco (último sucesso, último erro).

**Importação de extrato (complemento):** importar CSV/XLSX do Santander com mapeamento de colunas, mesma deduplicação. Serve para carregar o histórico dos últimos 12 meses (a API pode dar só um histórico curto) e como plano B se a ligação falhar.

### 4.2 Apple Pay via Atalhos do iPhone (tempo real)

Em cada iPhone (iOS 17+), automação pessoal **Transação**:
1. Quando: tocar num cartão da Carteira, filtrado aos cartões do Santander. Executar imediatamente, sem notificação.
2. Ação: "Receber transação como entrada" (dá cartão, comerciante e valor).
3. Ação: "Obter conteúdo do URL" → `POST https://<projeto>.supabase.co/functions/v1/ingest-applepay`, JSON `{amount, merchant, card, occurred_at}`, header `Authorization: Bearer <token pessoal>`.

**Edge Function `ingest-applepay`:**
- Valida o token pessoal (cada membro gera o seu em Definições; guardado só como hash SHA-256; pode ser revogado).
- Converte o valor (vem como texto, ex. `12,34 €`) para cêntimos.
- Cria movimento `source = 'applepay'`, `status = 'provisorio'`, categoriza logo e devolve 200.

**Reconciliação com o banco** (corre no fim de cada `eb-sync`):
- Um movimento Apple Pay provisório casa com um movimento do banco se: mesmo valor absoluto, data do banco entre -1 e +3 dias da compra, e comerciante semelhante (similaridade de texto normalizado).
- Ao casar: o movimento do banco fica como fonte de verdade, herda a categoria e a nota do provisório se o utilizador as tiver definido, e o provisório fica ligado (`matched_transaction_id`) e deixa de contar.
- Provisórios sem par ao fim de 7 dias vão para "Por rever".
- **As métricas contam**: movimentos do banco + manuais + provisórios ainda sem par. Nunca contar a dobrar.

O ecrã Definições > Atalho Apple Pay mostra o URL, o token (copiar com um toque) e os passos acima.

### 4.3 Registo manual
- Botão "+" sempre visível: despesa ou entrada (valor, categoria, data, nota, método).
- Usado sobretudo para numerário e para os pagamentos de eventos (secção 5).

---

## 5. Eventos da Joana

### 5.1 Evento
Campos: data, tipo, cliente, local, valor do serviço, ajudas de despesas (quando existem, ex. concertos), km de deslocação, despesas previstas, estado, notas.

- **Tipos** (lista editável, valores iniciais): `Noiva`, `Convidadas`, `Concerto`, `Outro`.
- **Estados**: `pedido` → `confirmado` → `realizado` → `pago` (ou `cancelado`).
- **Tabela de preços opcional** (Definições, editável) para sugerir o valor ao criar o evento. Valores iniciais a confirmar com a Joana: noiva (prova + dia) 200 €, convidada 50 €, deslocação 0,40 €/km.

### 5.2 Pagamentos do evento
Cada evento tem um ou mais pagamentos: `sinal`, `restante`, `outro`.
Campos: valor, data, método (`transferencia`, `mbway`, `numerario`, `revolut`), onde está o dinheiro (`conta_casa` ou `por_transferir`), movimento ligado.

- **Transferência e MB Way** chegam diretamente ao Santander:
  - a app tenta casar cada entrada com pagamentos em aberto (valor igual ao sinal ou ao restante, nome do ordenante parecido com o cliente, texto "MB WAY");
  - se houver correspondência provável, cria um cartão em "Por rever": "Isto é o sinal da noiva X?" (confirmar com um toque);
  - se a Joana já tiver registado o pagamento, a entrada liga-se a esse registo.
- Se o MB Way da Joana estiver associado à Revolut, esses pagamentos tratam-se como `revolut`.
- **Numerário e Revolut** ficam como `por_transferir` até chegarem ao Santander:
  - quando entra um depósito em numerário ou uma transferência vinda da Joana (contas de origem configuradas em Definições), a app propõe liquidar os pagamentos `por_transferir` mais antigos cuja soma bata com o valor;
  - a Joana confirma; o movimento fica categorizado como `Eventos Joana`.
  - Se a transferência da Joana não corresponder a eventos, vai para "Por rever" (pode ser dinheiro pessoal).
- **Indicador**: "Dinheiro dos eventos ainda fora da Conta Casa: X €" (com alerta se houver valores há mais de 7 dias).

### 5.3 Métricas da atividade
- Receita por mês (por data do evento e por data de recebimento).
- Número de eventos e valor médio por evento.
- Gastos da atividade (grupo "Atividade Joana").
- **Rentabilidade da atividade (€)** = receita - gastos da atividade (o que fica de facto em casa).
- **Margem da atividade (%)** = rentabilidade / receita.
- **A receber**: eventos confirmados nos próximos 3 e 6 meses (valor total - já pago).
- Sazonalidade: receita por mês dos últimos 12 meses.

> Nota de vocabulário: "margem" só para percentagens; valores em euros chamam-se "rentabilidade".

---

## 6. Categorias e categorização

### 6.1 Categorias iniciais (editáveis)
- **Entradas**: Salário e extras João · Renda casa arrendada · Eventos Joana · Reembolsos · Outras entradas
- **Fixas**: Crédito habitação e prestações · Condomínio · Luz · Água · Gás · Internet e telemóvel · Seguros · Subscrições · Impostos da casa (IMI, IUC) · Outras fixas
- **Variáveis do casal**: Supermercado · Restaurantes e saídas · Combustível e carregamentos · Transportes e portagens · Casa e manutenção · Saúde e farmácia · Maggie · Roupa e cuidado pessoal · Lazer e concertos · Viagens · Prendas · Outras variáveis
- **Atividade Joana**: Material · Deslocações · Alojamento em trabalho · Outras despesas da atividade
- **Mesadas**: Mesada João · Mesada Joana
- **Transferências internas** (fora das métricas): Entre contas

### 6.2 Motor de categorização (por esta ordem)
1. **Regras** do utilizador (comerciante, descrição, contraparte ou IBAN; igual, contém, regex; com prioridade).
2. **Histórico**: mesmo comerciante normalizado → última categoria confirmada.
3. **IA**: Claude API (`claude-haiku-5-5`), em lote, resposta JSON `{category_id, confidence, merchant_clean}`. Enviar só descrição, valor, data e lista de categorias (sem IBANs nem nomes completos).
4. Confiança < 0,7 → "Por rever".

- **Normalização do comerciante**: tirar prefixos ("COMPRA", "PAG.", "MB WAY"), números de cartão, datas, códigos e localidades.
- **Aprender**: ao mudar uma categoria, perguntar "Aplicar sempre a <comerciante>?" → cria regra, com opção de aplicar aos movimentos passados.
- **Dividir** um movimento por várias categorias (ex.: supermercado com parte para a atividade).
- **Mesadas**: saídas para as contas pessoais configuradas, perto do dia definido e com valor igual à mesada → categoria de mesada automática.
- **IBANs** guardados só como hash + últimos 4 dígitos.

### 6.3 Fixas recorrentes
- Detetar recorrência: mesma contraparte, cadência mensal (±5 dias), valor semelhante.
- Alertas: valor mudou (mais de 2% ou 2 €); fixa esperada não apareceu até 5 dias depois do habitual.
- As fixas previstas do mês alimentam o "comprometido no dia 1", a almofada disponível e a previsão de fim de mês.

---

## 7. Orçamentos

- Orçamento mensal por categoria de variáveis e por grupo; fixas previstas calculadas a partir das recorrentes.
- Mesadas: valor e dia do mês por pessoa (Definições).
- Opção por categoria "acumular o que sobra" para o mês seguinte.
- Alertas a 80% e 100%, e alerta de ritmo ("ao ritmo atual vão chegar a 115% em Supermercado").

---

## 8. Métricas (definições exatas)

Todas por mês civil, em `Europe/Lisbon`, excluindo transferências internas e provisórios já casados.

| Métrica | Definição |
|---|---|
| Entradas | Soma dos movimentos em categorias de Entradas |
| Despesas da casa | Fixas + Variáveis + Atividade Joana |
| Mesadas | Soma das categorias de Mesadas |
| **Sobra do mês** | Entradas - Despesas da casa - Mesadas |
| **Taxa de poupança** | Sobra do mês / Entradas |
| Comprometido no dia 1 | (Fixas previstas + Mesadas) / Base fixa prevista |
| Cobertura da base fixa | Base fixa / (Fixas previstas + Mesadas); abaixo de 1 gera alerta |
| Compromissos por sair | Fixas e prestações ainda por sair + mesadas ainda por sair + orçamento de variáveis ainda por gastar (só a parte positiva) |
| **Almofada disponível** | Saldo atual da Conta Casa - compromissos por sair |
| **Almofada (meses)** | Almofada disponível / média mensal de (Despesas da casa + Mesadas) dos últimos 3 meses |
| Almofada livre | Almofada disponível - total reservado em objetivos |
| Dinheiro fora da Conta Casa | Pagamentos de eventos em `por_transferir` |
| A receber de eventos | Eventos confirmados nos próximos 3 meses: total - pago |
| **Previsão de fim de mês** | Saldo atual da Conta Casa + entradas esperadas (base fixa ainda não recebida + pagamentos de eventos previstos) - fixas por sair - mesadas por sair - variáveis projetadas ao ritmo do mês |

Enquanto não houver 3 meses de histórico, a média usa os meses que existirem (ou o extrato importado).

**Objetivos** (férias, concertos, amortização do crédito...): valor alvo, data limite, valor reservado (marcado na app, o dinheiro fica na Conta Casa) e quanto falta reservar por mês para chegar a tempo.

**Fecho do mês**: no dia 1 de cada mês gerar um `monthly_snapshot` com todas as métricas e um resumo em texto (secção 11).

---

## 9. Ecrãs (PWA mobile-first)

1. **Início**
   - Cartão "Sobra este mês" + previsão de fim de mês.
   - Almofada disponível, em euros e em meses, face ao alvo.
   - Barras de orçamento por categoria (as que têm mais movimento primeiro).
   - Alertas ativos e contador de "Por rever".
   - Próximos eventos da Joana, valor a receber e dinheiro fora da Conta Casa (se > 0).
   - Estado da ligação ao banco (última sync, dias até expirar).
2. **Movimentos**: lista por dia, filtros (mês, categoria, origem, por rever), pesquisa; etiqueta de origem (Banco, Apple Pay, Manual, Extrato); tocar para mudar categoria, dividir, nota.
3. **Por rever**: categorias com baixa confiança, propostas de correspondência evento ↔ entrada, Apple Pay sem par, fixas que mudaram, transferências desconhecidas. Resolver com um toque.
4. **Orçamento**: definir e acompanhar por categoria e grupo.
5. **Eventos**: lista e calendário, criar evento, botão "Recebi" (regista pagamento em 3 toques), métricas da atividade.
6. **Métricas**: mês atual, fecho dos meses anteriores, evolução de 12 meses (entradas vs despesas), evolução da almofada, tendência por categoria, sazonalidade dos eventos.
7. **Objetivos**: progresso, reservar valor da almofada, quanto falta por mês.
8. **Pergunta à app**: chat (secção 11).
9. **Definições**: membros, conta, mesadas (valor, dia, conta de destino), contas de origem da Joana (Revolut), alvo da almofada, tabela de preços dos eventos, categorias e regras, ligação ao banco, Atalho Apple Pay, notificações, PIN, importar extrato, exportar dados (CSV).

**Visual** (igual à apresentação "Contas a Dois"):
- Cores: creme `#F6F1EA`, areia `#EAE1D3`, tinta `#1E2B2F`, terracota `#A64B25`, verde-petróleo `#2E6B66`; modo claro e escuro.
- Letra: Fraunces (títulos e números grandes) + DM Sans (texto).
- Números grandes e legíveis, cartões com cantos arredondados, nada de tabelas apertadas no telemóvel.

---

## 10. Notificações

Web Push (iPhone com iOS 16.4+, app adicionada ao ecrã principal, permissão pedida no primeiro uso). Chaves VAPID nos secrets. Preferências por membro.

| Quando | Mensagem (exemplo) |
|---|---|
| Entra salário ou renda | "Entrou a renda da casa arrendada" |
| Entrada parecida com pagamento de evento | "Recebeste 150 €. É o sinal da noiva X?" |
| Orçamento a 80% / 100% | "Supermercado já vai em 85%" |
| Fixa mudou ou falhou | "A prestação mudou de valor" |
| Almofada abaixo do alvo | "A almofada está em 1,5 meses (alvo: 3)" |
| Dinheiro de eventos fora da Conta Casa há 7+ dias | "Há 300 € de eventos por transferir" |
| Ligação ao banco a expirar | "A ligação ao Santander expira em 3 dias" |
| Domingo 20:00 | Resumo da semana |
| Dia 1, 09:00 | Fecho do mês |

Os valores nas mensagens acima são só exemplos de formato.

---

## 11. IA

- **Categorização**: `claude-haiku-5-5` (secção 6.2).
- **Pergunta à app**: chat com `claude-sonnet-5-5` e tool use sobre funções de leitura pré-definidas (nunca SQL livre): `resumo_mes(mes)`, `gastos_por_categoria(periodo, categoria?)`, `movimentos(filtros)`, `eventos(periodo, estado?)`, `almofada()`, `objetivos()`, `previsao_fim_mes()`. Exemplos: "Quanto gastámos em restaurantes este ano?", "Quanto falta receber dos eventos de maio?".
- **Resumo do fecho do mês**: texto curto e simpático com o que correu bem, o que fugiu ao orçamento e uma sugestão.
- A chave `ANTHROPIC_API_KEY` só existe nas Edge Functions.

---

## 12. Arquitetura técnica

- **Frontend**: React + Vite + TypeScript, TailwindCSS, Recharts, `vite-plugin-pwa`; deploy no Vercel.
- **Backend**: Supabase (Postgres, Auth, Edge Functions em Deno, `pg_cron` + `pg_net`, secrets).
- **Edge Functions**: `eb-auth-start`, `eb-callback`, `eb-sync`, `ingest-applepay`, `categorize`, `reconcile` (Apple Pay ↔ banco e eventos ↔ entradas), `import-statement`, `notify`, `monthly-close`, `ai-ask`.
- **Valores monetários** sempre em cêntimos (`bigint`); positivos = entrada, negativos = saída.
- **Segurança**: RLS em tudo; service role só nas Edge Functions; chave privada da Enable Banking, chave da Anthropic e VAPID nos secrets; tokens do Atalho guardados como hash; nada de dados financeiros nos logs; IBANs guardados como hash + últimos 4 dígitos.

---

## 13. Modelo de dados (resumo)

```sql
households (id, name, created_at)
members (id, household_id, user_id, display_name, mesada_cents, mesada_day,
         mesada_dest_iban_hash, pin_hash, notify_prefs jsonb)
accounts (id, household_id, name, role,               -- casa | outra
          iban_hash, iban_last4, eb_account_uid, balance_cents, balance_at)
bank_connections (id, household_id, aspsp_name, session_id, valid_until,
                  status, last_sync_at, last_error)
categories (id, household_id, grp,                    -- entrada | fixa | variavel | atividade | mesada | interna
            name, icon, budget_cents, rollover, sort, archived)
transactions (id, household_id, account_id, source,   -- banco | applepay | manual | extrato
              external_id, booking_date, value_date, amount_cents, description_raw,
              counterparty, merchant_clean, category_id, category_source, confidence,
              status,                                  -- provisorio | confirmado
              matched_transaction_id, recurring_id, event_payment_id, note,
              created_by, created_at, updated_at,
              unique (account_id, external_id))
transaction_splits (id, transaction_id, category_id, amount_cents)
rules (id, household_id, field, match_type, pattern, category_id, priority, created_by)
recurring (id, household_id, counterparty_key, category_id, expected_cents,
           tolerance_cents, expected_day, last_seen_at, active)
events (id, household_id, date, type, client_name, location, service_cents,
        expense_allowance_cents, km, expected_costs_cents, status, notes)
event_payments (id, event_id, kind, amount_cents, received_at, method, location,
                transaction_id)
joana_source_accounts (id, household_id, label, iban_hash, name_pattern)
goals (id, household_id, name, target_cents, due_date, reserved_cents)
settings (household_id, cushion_target_months, price_table jsonb)
ingest_tokens (id, member_id, token_hash, created_at, last_used_at, revoked_at)
push_subscriptions (id, member_id, endpoint, p256dh, auth, created_at)
review_items (id, household_id, type, ref jsonb, status, resolved_by, resolved_at)
monthly_snapshots (household_id, month, metrics jsonb, summary_text, created_at)
```

Criar views SQL para as métricas da secção 8 (`v_month_metrics`, `v_budget_progress`, `v_cushion`, `v_activity_metrics`) e testá-las com dados de exemplo.

---

## 14. Ordem de construção (tudo entra na v1, por marcos)

| Marco | Entrega | Critério de aceitação |
|---|---|---|
| M1 Base | Projeto, auth OTP, agregado com 2 membros, PWA instalável, visual, categorias iniciais, Definições | Os dois entram no iPhone e a app abre a partir do ecrã principal |
| M2 Movimentos | Registo manual, importação de extrato, lista, edição, divisão | Importar 12 meses de extrato sem duplicados |
| M3 Santander | Enable Banking (ligar, sync 2x/dia, saldo, renovar) | Movimentos e saldo da Conta Casa aparecem sozinhos; sync repetida não duplica |
| M4 Categorização | Regras, histórico, IA, Por rever, aprender | 90%+ dos movimentos de um mês categorizados sem toque humano |
| M5 Apple Pay | Atalho + `ingest-applepay` + reconciliação | Compra aparece em segundos e funde-se com o movimento do banco sem contar a dobrar |
| M6 Orçamentos | Orçamentos, fixas recorrentes, alertas | Alerta a 80% e alerta de fixa alterada funcionam com dados de teste |
| M7 Eventos | Eventos, pagamentos, correspondências, dinheiro fora da Conta Casa | Sinal por MB Way e restante em numerário fecham corretamente o evento |
| M8 Métricas | Início, Métricas, almofada, previsão, objetivos, fecho do mês | Valores batem certo com cálculo manual de um mês de teste |
| M9 Notificações | Web Push e resumos | Os dois iPhones recebem as notificações da secção 10 |
| M10 IA | Pergunta à app e resumo do fecho | Responde corretamente a 10 perguntas de teste |

Em todos os marcos:
- dados de exemplo fictícios para desenvolvimento (nunca dados reais no repositório);
- sandbox da Enable Banking durante o desenvolvimento e Production só no fim do M3;
- testes para deduplicação, reconciliação, correspondência de eventos e métricas.

---

## 15. Configuração inicial (checklist do João)

- [ ] Criar projeto no Supabase e no Vercel
- [ ] Registo na Enable Banking, aplicação Production, `.pem`, Application ID e **Link accounts** com o Santander
- [ ] Chave da Anthropic API
- [ ] Gerar chaves VAPID
- [ ] Joana como cotitular no Santander
- [ ] Instalar a PWA nos dois iPhones, ativar notificações e criar o Atalho "Transação" em cada um
- [ ] Preencher em Definições os valores combinados (secção 16)

---

## 16. Valores a definir pelo casal

| Valor | Onde |
|---|---|
| Mesada do João e da Joana: `[€__]`, dia `[__]` | Definições > Mesadas |
| Alvo da almofada: `[__]` meses (fica na conta à ordem) | Definições > Almofada |
| Orçamento por categoria de variáveis: `[€__]` | Orçamento |
| Objetivos 2027 (férias, concertos, amortização) | Objetivos |
| Tabela de preços dos eventos (confirmar valores iniciais) | Definições > Atividade |

---

## 17. Fora de âmbito

- Investimentos (cada um investe com a sua mesada).
- Acompanhar as contas pessoais e o uso das mesadas.
- Fazer pagamentos ou transferências.
- Reserva para impostos da atividade (por agora não se aplica).
- Outras moedas.

## 18. Ideias para depois

- Reserva para impostos dos eventos da Joana, com taxa configurável, se vier a ser precisa.
- Conta poupança separada para a almofada, se um dia a quiserem tirar da conta à ordem.
- Ligar a Revolut da Joana à app, só se ela quiser, para os pagamentos de eventos aparecerem sozinhos.
- Calendário dos eventos em `.ics` para subscrever no iPhone.
- Ajuda para o IRS da atividade (totais anuais por categoria).
- Widget no ecrã principal com a sobra do mês.
