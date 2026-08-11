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

**O rollout planejado (Fases 0-3) está 100% concluído.** Não há próximo
passo obrigatório — só um achado real que precisa de uma decisão sua:

⚠️ **Achado não resolvido, precisa de decisão do usuário**: o teste E2E
descobriu que clicar em `<Button type="submit">` sem `onClick` explícito
(`src/components/ui/button.tsx`, usa `@base-ui/react` — versão
`^1.6.0`) **não envia o formulário** — nenhuma requisição, nenhum toast,
nada acontece. `form.requestSubmit()` e a tecla Enter funcionam
perfeitamente. O teste de fumaça contorna isso submetendo com Enter (uma
interação real e válida), mas isso pode ser um bug real afetando
usuários reais clicando em botões "Salvar"/"Criar" no app inteiro — ou
pode ser específico do Playwright/Chromium headless e não reproduzir com
mouse de verdade num navegador de verdade. **Precisa de alguém testando
manualmente num navegador real pra confirmar se é um problema de
produção ou não.** Detalhes completos em
`docs/engineering-standards.md` → Testing, e no comentário no topo de
`e2e/smoke.spec.ts`. A Fase 4 (backlog futuro, não agendado) é o único
outro item pendente, e só entra em pauta se algum dos gatilhos
descritos lá acontecer de verdade.

---

## Fase 0 — Documento de padrões + ADRs — ✅ CONCLUÍDA

- [x] `docs/engineering-standards.md` criado
- [x] `docs/adr/0001-multi-tenant-rls.md`
- [x] `docs/adr/0002-ai-provider-abstraction.md`
- [x] `docs/adr/0003-background-jobs-polling-not-queue.md`
- [x] `CLAUDE.md` referencia `docs/engineering-standards.md`
- [x] `CONTRIBUTING.md` ganhou a seção "Definition of Done"

## Fase 1 — Gaps de segurança/correção de maior risco — ✅ CONCLUÍDA

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

### 1.4 — Critério de enforcement do CSP — ✅ FEITO
- [x] Decisão (usuário): ativar enforcing agora, já que este ambiente é
      só dev local, sem tráfego de produção — violação encontrada em
      dev é corrigida na hora, sem custo de esperar.
- [x] `docs/adr/0004-csp-enforcement-criteria.md` documenta a decisão.
- [x] `next.config.ts`: header trocado de `Content-Security-Policy-Report-Only`
      para `Content-Security-Policy` (nenhuma diretiva mudou de valor).
      Confirmado via `curl`/`Invoke-WebRequest` no servidor dev
      reiniciado: header correto sendo servido, header Report-Only
      ausente.
- [x] Gate completo rodado: 770/770 testes, build OK.

### 1.5 — Política de CORS para `/api/v1/*` — ✅ FEITO
- [x] Decisão (usuário): só server-to-server, sem CORS liberado —
      integrações chamam a API a partir de um backend, não do navegador
      do usuário final.
- [x] Nenhuma mudança de código necessária (a ausência de
      `Access-Control-Allow-Origin` já é o comportamento desejado —
      CORS é uma restrição do navegador, chamadas servidor-a-servidor
      não são afetadas).
- [x] Decisão documentada em `docs/engineering-standards.md` → Security,
      incluindo o aviso de não usar `Access-Control-Allow-Origin: *` se
      um dia precisar liberar (risco de vazamento de bearer key via
      script de terceiro).

## Fase 2 — Observabilidade — ✅ CONCLUÍDA

### 2.1 — `src/lib/logger.ts` — ✅ FEITO
- [x] `src/lib/logger.ts`: `logger.{debug,info,warn,error}(message, context?)`
      — uma linha JSON por chamada (`{ level, message, timestamp,
      ...context }`), sem dependência nova. `context.error` (uma
      instância de `Error`) é expandido pra `{ name, message, stack }`
      automaticamente — problema real que motivou isso: `Error` não
      serializa `message`/`stack` sozinho via `JSON.stringify`. Testado
      em `logger.test.ts` (5 casos).
- [x] Migrados os pontos de maior alavancagem (não todos os ~230
      call-sites — decisão de escopo explícita, ver nota abaixo):
  - `toErrorResponse()` (`src/lib/auth/account.ts`) — 3 call sites,
    incluindo o catch-all que praticamente toda rota de dashboard usa
  - `toApiErrorResponse()` (`src/lib/api/v1/respond.ts`) — o catch-all
    equivalente pra toda rota `/api/v1/*`
  - `src/app/api/flows/cron/route.ts` e
    `src/app/api/automations/cron/route.ts` — este último **não tinha
    log nenhum** antes (a falha só ia pro corpo HTTP 500, que o pinger
    externo provavelmente ignora); achado e corrigido pelo caminho
  - `src/app/api/whatsapp/webhook/route.ts` — só os 2 catches MAIS
    externos (falha não tratada no processamento inteiro), não os ~23
    logs internos já tageados (`[webhook] ...`) espalhados pelas
    funções auxiliares desse arquivo de ~1200 linhas
- [x] Decisão de escopo (documentada em `docs/engineering-standards.md`):
      migrar TODOS os ~230 call-sites de uma vez, principalmente dentro
      de um arquivo grande e crítico como o webhook, seria um diff
      grande e arriscado por pouco ganho adicional — os pontos migrados
      já cobrem os "funis" por onde a maioria dos erros passa. O resto
      migra organicamente quando cada arquivo for tocado por outro
      trabalho.
- [x] Gate completo: lint (0 erros), typecheck (0 erros), **775/775
      testes** (79 arquivos), build OK.

### 2.2 — Error tracking opcional (BYO Sentry DSN) — ✅ DECIDIDO (adiado)
- [x] Decisão (usuário): deixar pra quando houver produção de verdade.
      Ambiente ainda é local/dev; o logger estruturado (2.1) já cobre o
      que precisa por enquanto. Revisitar quando este fork for de fato
      implantado com tráfego real — seguir o mesmo padrão BYO-key já
      usado pra chaves de IA (`src/lib/ai/config.ts`), documentado em
      `docs/engineering-standards.md` → Observability.

## Fase 3 — Testes — ✅ CONCLUÍDA

### 3.1 — Completar lacunas em rotas externas/sensíveis — ✅ FEITO
- [x] Levantamento: só 3 rotas tinham teste de rota antes desta fase
      (`contacts/[id]/tags`, `whatsapp/send`, `whatsapp/webhook`) de
      ~50 rotas totais. As duas rotas de cron (`automations/cron`,
      `flows/cron`) — expostas a um scheduler externo via segredo
      compartilhado, sem nenhuma outra proteção — não tinham teste
      nenhum. Essas eram a lacuna de maior risco (rota externa +
      silenciosa: só o pinger externo chama, uma regressão não
      apareceria em uso normal do dashboard).
- [x] `src/app/api/automations/cron/route.test.ts` (4 casos: sem
      segredo configurado → 503, segredo errado → 401, nada pendente →
      `{processed:0}`, linha pendente é reivindicada e processada).
- [x] `src/app/api/flows/cron/route.test.ts` (6 casos: mesmos dois de
      auth, erro na varredura → 500, sem runs ativos → `{swept:0}`,
      run parado há mais tempo que o timeout → varrido, run recente →
      não varrido).
- [x] Gate completo: **785/785 testes** (81 arquivos), build OK.

### 3.2 — Rotas de mutação do dashboard mais usadas — ✅ FEITO
- [x] **Correção ao escopo original**: `contacts` e `deals` não têm
      rota de API própria — o dashboard escreve direto no Supabase a
      partir dos componentes React, protegido só por RLS (não por uma
      rota Next.js). Não há o que testar "de rota" ali; a proteção real
      já está nas policies RLS (cobertas pelas migrations, não por
      testes de rota). Ajustado o escopo para a rota de mutação real
      mais crítica sem teste: `POST /api/whatsapp/broadcast` (dispatch
      de broadcast do dashboard — distinta da rota pública
      `/api/v1/broadcasts`).
- [x] `src/app/api/whatsapp/broadcast/route.test.ts` (7 casos). O
      primeiro é um **teste de regressão pra uma vulnerabilidade real já
      documentada no próprio código**: essa rota não escreve nada no
      banco (manda direto pro Meta), então é o único lugar do app sem
      RLS como rede de segurança — o comentário da rota descreve que
      antes um `viewer` conseguia disparar broadcast pra qualquer
      número. `requireRole('agent')` corrigiu; o teste garante que
      continua corrigido. Demais casos: agent consegue disparar,
      validação (sem destinatários, sem template_name), rate limit
      (429 sem chamar o Meta), telefone inválido marcado como falha sem
      chamar o Meta, falha do Meta por destinatário não derruba a
      requisição toda.
- [x] Gate completo: **792/792 testes** (82 arquivos), build OK.

### 3.3 — Playwright E2E — ✅ FEITO
- [x] `@playwright/test` instalado como devDependency + binário do
      Chromium baixado (`npx playwright install chromium`).
      `playwright.config.ts` na raiz (1 browser só, sem `webServer`
      auto-start — Supabase não dá pra subir do mesmo jeito, então um
      stack pela metade daria erro confuso em vez de um "servidor não
      está rodando" limpo).
- [x] **Escopo ajustado**: o caminho "login → inbox → enviar mensagem"
      do plano original não é executável neste ambiente — não há
      credencial real da API do WhatsApp Business (`META_APP_SECRET` é
      placeholder). O teste de fumaça cobre o caminho que É executável
      sem credenciais externas: cadastro → autenticado no dashboard →
      criar um contato pela UI de verdade contra o Supabase local de
      verdade. Ainda é uma volta completa boot-até-banco por um
      navegador real, não mock.
- [x] `e2e/smoke.spec.ts` + `e2e/README.md` (como rodar localmente).
      `npm run test:e2e` roda a suíte. Rodado 2x seguidas pra confirmar
      estabilidade (não é flaky).
- [x] **Achado real #1 (corrigido)**: o CSP que acabamos de ativar na
      Fase 1.4 quebrou o cadastro de verdade — `connect-src` só
      permitia `https://*.supabase.co`, e o Supabase local roda em
      `http://127.0.0.1:54321` (HTTP puro, domínio diferente). Erro
      "Failed to fetch" sem nenhuma mensagem de violação de CSP no
      console — fácil de passar despercebido sem um teste E2E de
      verdade. Corrigido em `next.config.ts` (origem local do Supabase
      adicionada ao `connect-src`, só em dev — produção mantém a
      política mais restrita). Documentado como adendo no
      `docs/adr/0004-csp-enforcement-criteria.md`.
- [x] **Achado real #2 (não corrigido, precisa de decisão)**: ver aviso
      no topo deste arquivo ("Próximo passo") — botão de submit sem
      `onClick` explícito não envia o formulário ao ser clicado.
- [x] Não colocado no CI ainda (precisaria de um passo "subir Supabase
      no CI" que o `ci.yml` atual não tem) — documentado em
      `e2e/README.md` como trabalho futuro, não bloqueante.
- [x] Gate completo: **792/792 testes** (82 arquivos), typecheck,
      lint (0 erros), build — todos OK.

## Fase 4 — Backlog futuro (documentado, não agendado)

Sem checklist — são decisões conscientemente adiadas, revisitar só se o
gatilho descrito acontecer de verdade:

- Audit log genérico para contacts/deals (se surgir requisito de compliance)
- Rate limiting distribuído / Redis (se houver plano real de escalar
  horizontalmente — ver `docs/adr/0003-background-jobs-polling-not-queue.md`)
- `WhatsAppProvider` formal (se um segundo canal for adicionado)
- Fila/worker real (se o volume de automações atrasadas justificar)
