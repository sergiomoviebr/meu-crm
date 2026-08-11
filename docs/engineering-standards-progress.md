# Engineering standards — progress tracker

**Este arquivo é o checkpoint oficial do rollout.** Se uma sessão for
interrompida (limite de tokens, fechar o chat, etc.), a próxima sessão deve
ler este arquivo primeiro — ele diz exatamente o que já foi feito, o que
está em andamento, e qual o próximo passo concreto. Não redescobrir isso
lendo o código do zero.

Plano completo (contexto, decisões de escopo, o que deliberadamente não
fazer): [`docs/engineering-standards.md`](./engineering-standards.md) e os
ADRs em [`docs/adr/`](./adr).

Regra de ouro de todo este rollout: **cada passo é aditivo e deixa o
sistema 100% funcional ao final** — nunca commitar/parar num estado quebrado.
Cada passo roda `npm run lint && npm run typecheck && npm test && npm run build`
antes de ser marcado como concluído.

---

## Como retomar

1. Ler a seção "Próximo passo" abaixo.
2. Ler o item correspondente na tabela de fases para o contexto completo.
3. Rodar `npm test` para confirmar que o estado atual está verde antes de
   continuar.
4. Ao terminar um passo: marcar `[x]`, mover "Próximo passo" para o
   próximo item, rodar a suíte completa, e (se possível) `git commit`
   local com uma mensagem descrevendo o passo.

## Próximo passo

**Fase 1, Passo 1.4** — decidir COM O USUÁRIO o critério de enforcement
do CSP (não é um passo de execução autônoma — precisa de uma decisão de
produto/ops que só o usuário pode tomar). Se a sessão for retomada sem
essa decisão ainda tomada, perguntar antes de continuar. Alternativa: se
o usuário preferir, pular para a Fase 2 (observabilidade) e voltar ao
CSP/CORS depois — nenhuma das duas depende da outra.

---

## Fase 0 — Documento de padrões + ADRs — ✅ CONCLUÍDA

- [x] `docs/engineering-standards.md` criado
- [x] `docs/adr/0001-multi-tenant-rls.md`
- [x] `docs/adr/0002-ai-provider-abstraction.md`
- [x] `docs/adr/0003-background-jobs-polling-not-queue.md`
- [x] `CLAUDE.md` referencia `docs/engineering-standards.md`
- [x] `CONTRIBUTING.md` ganhou a seção "Definition of Done"

## Fase 1 — Gaps de segurança/correção de maior risco — 🔄 EM ANDAMENTO

### 1.1 — Teste de isolamento cross-tenant para `/api/v1/*` — ✅ FEITO
- [x] Investigação: todas as rotas `/api/v1/*` por-id (`contacts/[id]`,
      `conversations/[id]`, `conversations/[id]/messages`,
      `broadcasts/[id]`, `webhooks/[id]`) já seguem o padrão
      `.eq('id', id).eq('account_id', ctx.accountId)` — não há bug
      encontrado, mas não havia teste algum guardando essa disciplina.
  - `messages/route.ts` (POST) e `broadcasts/route.ts` (POST) constroem
    tudo a partir de `ctx.accountId`, sem receber um id "estranho" do
    cliente — exceto `reply_to_message_id`, que já é validado contra
    `conversation_id` em `src/lib/whatsapp/send-message.ts:287-301`.
  - Decisão de escopo: o suite de testes do projeto é 100% mock/unit
    (`vitest.config.ts` — "Tests never hit a real Meta/Supabase service"),
    sem infraestrutura de teste de integração com banco real. Criar essa
    infraestrutura agora seria uma mudança maior, fora do pedido — em vez
    disso, o teste usa um fake query-builder que **respeita os filtros
    `.eq()`** (diferente do mock mais simples de
    `whatsapp/send/route.test.ts`, que retorna dado enlatado por tabela
    sem checar filtros) — isso é o suficiente pra pegar a classe real de
    bug (alguém remove um `.eq('account_id', ...)` num refactor futuro).
- [x] Arquivo criado: `src/app/api/v1/tenant-isolation.test.ts`

### 1.2 — Rodar o teste e corrigir o que falhar — ✅ FEITO
- [x] `npx vitest run src/app/api/v1/tenant-isolation.test.ts` → 8/8 verde
      de primeira (nenhuma rota precisou de correção — a disciplina de
      `account_id` já estava certa; o teste agora é a rede de segurança
      contra regressão futura).
- [x] Gate completo rodado (`npm run lint && npm run typecheck && npm test
      && npm run build`) e **dois bugs pré-existentes, não relacionados a
      este rollout**, foram encontrados e corrigidos pelo caminho (achados
      só porque foi a primeira vez que a suíte completa rodou nesta
      máquina — confirmado via `git status` que nenhum desses arquivos
      tinha sido tocado antes):
  - `src/lib/currency.test.ts` — 3 asserts assumiam formatação en-US
    (`"1,234"`) de `Intl.NumberFormat(undefined, …)`, que na verdade
    segue o locale do SISTEMA OPERACIONAL do host. Nesta máquina (locale
    `pt-BR`) o output real é `"US$ 1.234"` — funcionalmente correto, só a
    asserção do teste era frágil. Corrigido para uma regex
    locale-invariante (`/1[.,\s]234/`) que aceita qualquer separador de
    milhar.
  - `src/lib/dashboard/date-utils.test.ts` — `mondayIndex` testado com
    `new Date("2026-05-18")` (string ISO só-data → parseada como **UTC**
    meia-noite). Nesta máquina (timezone `America/Sao_Paulo`, UTC-3) isso
    desloca pro dia local anterior, quebrando o cálculo de dia-da-semana.
    Corrigido para construtor de data local (`new Date(2026, 4, 18)`),
    igual ao padrão já usado no resto do arquivo.
  - Nenhuma das duas correções tocou a lógica de produção
    (`src/lib/currency.ts`, `src/lib/dashboard/date-utils.ts`) — só os
    testes ficaram mais robustos a variações de locale/timezone da
    máquina de quem roda.
  - `eslint.config.mjs` — `npm run lint` estava falhando com ~150 erros
    de `prefer-const` vindos de
    `supabase/.temp/start-secrets/.../index.ts`, um arquivo gerado
    automaticamente pelo Supabase CLI (bootstrap do edge-runtime local,
    criado quando rodamos `supabase start` nesta sessão) — não é código
    nosso e já está no `supabase/.gitignore`, mas o ESLint (flat config)
    não lê `.gitignore` sozinho. Adicionado `supabase/.temp/**` e
    `supabase/.branches/**` aos `globalIgnores`.
- [x] Suíte completa confirmada verde: lint (0 erros), typecheck (0
      erros), 757/757 testes (76 arquivos), build de produção OK.

### 1.3 — Validação de entrada com zod — ✅ FEITO
- [x] `npm install zod`
- [x] `src/lib/api/v1/validate.ts`: helper `parseJsonBody(request, schema)`
      compartilhado — parseia JSON, valida contra o schema zod, lança
      `ApiError('bad_request', …)` no formato que toda rota v1 já mapeia
      via `toApiErrorResponse`. Testado em `validate.test.ts` (7 casos).
- [x] Migradas todas as 6 rotas de escrita `/api/v1/*`:
      `contacts/route.ts` (POST), `contacts/[id]/route.ts` (PATCH),
      `messages/route.ts` (POST), `broadcasts/route.ts` (POST),
      `webhooks/route.ts` (POST), `webhooks/[id]/route.ts` (PATCH).
- [x] Decisão de escopo aplicada em todas: os schemas zod validam só
      **forma/presença** (string vs array vs boolean, obrigatório vs
      opcional) — regras de negócio que já existiam em módulos de
      domínio (E.164 em `findOrCreateContact`, cap de 1..1000
      destinatários + `template_name` em `createBroadcast`, nomes de
      evento válidos em `normalizeEvents`, URL válida em
      `normalizeWebhookUrl`) permanecem exatamente onde estavam — zod
      não duplica essas regras.
- [x] `docs/engineering-standards.md` → seção Security atualizada
      (não é mais "a fazer", descreve o padrão real).
- [x] Testes de rejeição: `src/app/api/v1/validation.test.ts` (6 casos,
      um por rota, cada um confirma 400 antes de tocar o banco).
- [x] Gate completo rodado de novo ao final: lint (0 erros), typecheck
      (0 erros), **770/770 testes** (78 arquivos), build OK.
- [ ] **Não migrado (fora do escopo deste passo, ver nota no doc de
      padrões)**: rotas de dashboard (`/api/*`, sessão por cookie) —
      ficam com a validação manual atual; migrar é um passo separado,
      de prioridade menor, só quando cada rota for tocada por outro
      trabalho.

### 1.4 — Critério de enforcement do CSP — ⬜ NÃO INICIADO
- [ ] Decidir com o usuário: qual critério objetivo aciona a troca de
      `Content-Security-Policy-Report-Only` para `Content-Security-Policy`
      enforcing em `next.config.ts` (ex.: N dias em produção sem
      violação relatada — mas hoje não há coleta de `report-uri`, então
      a primeira sub-tarefa real pode ser decidir SE vale configurar um
      endpoint de report antes de conseguir medir isso)
- [ ] Documentar a decisão em `docs/adr/0004-csp-enforcement-criteria.md`
- [ ] Se o critério já puder ser satisfeito (ex.: usuário confirma que
      não há necessidade de coletar reports, é ambiente de dev único),
      aplicar a mudança em `next.config.ts`

### 1.5 — Política de CORS para `/api/v1/*` — ⬜ NÃO INICIADO
- [ ] Decidir com o usuário: a API pública deve aceitar chamadas
      cross-origin do navegador (ex.: um app de terceiros rodando no
      browser do integrador) ou é só server-to-server (nesse caso CORS
      explícito é desnecessário, o bearer token já não é enviado
      automaticamente por navegador em cross-origin sem CORS liberado)
- [ ] Documentar a decisão (mesmo que seja "não fazer nada", documentar
      o porquê) em `docs/engineering-standards.md` → Security

## Fase 2 — Observabilidade — ⬜ NÃO INICIADO

### 2.1 — `src/lib/logger.ts`
- [ ] Wrapper estruturado sobre `console.*`: `{ level, message, accountId?,
      requestId?, operation, timestamp, ...extra }`
- [ ] Migrar os pontos mais críticos primeiro: webhook do WhatsApp
      (`src/app/api/whatsapp/webhook/route.ts`), rotas de cron
      (`src/app/api/automations/cron/route.ts`,
      `src/app/api/flows/cron/route.ts`), `toErrorResponse()`
      (`src/lib/auth/account.ts`), `toApiErrorResponse()`
      (`src/lib/api/v1/respond.ts`)
- [ ] Não migrar os ~230 call-sites de uma vez — só os críticos acima
      neste rollout; o resto migra organicamente quando cada arquivo for
      tocado por outro trabalho

### 2.2 — Error tracking opcional (BYO Sentry DSN) — decisão pendente
- [ ] Perguntar ao usuário se isso é prioridade agora ou fica pra depois
      (é opcional no plano aprovado — só vale a pena se o usuário for
      operar isso em produção de fato)

## Fase 3 — Testes — ⬜ NÃO INICIADO

### 3.1 — Completar lacunas em rotas externas/sensíveis
- [ ] Levantar quais rotas de webhook/cron ainda não têm teste de rota
      (não só de `src/lib`) e fechar essas lacunas

### 3.2 — Rotas de mutação do dashboard mais usadas
- [ ] `contacts`, `deals`, `broadcasts` — seguir o padrão de
      `src/app/api/whatsapp/send/route.test.ts`

### 3.3 — Playwright E2E
- [ ] Adicionar Playwright como devDependency
- [ ] Um teste de fumaça: login → inbox → enviar mensagem → aparece na
      conversa
- [ ] Job separado no CI, não bloqueante inicialmente

## Fase 4 — Backlog futuro (documentado, não agendado)

Sem checklist — são decisões conscientemente adiadas, revisitar só se o
gatilho descrito acontecer de verdade:

- Audit log genérico para contacts/deals (se surgir requisito de compliance)
- Rate limiting distribuído / Redis (se houver plano real de escalar
  horizontalmente — ver `docs/adr/0003-background-jobs-polling-not-queue.md`)
- `WhatsAppProvider` formal (se um segundo canal for adicionado)
- Fila/worker real (se o volume de automações atrasadas justificar)
