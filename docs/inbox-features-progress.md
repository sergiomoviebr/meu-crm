# Novas funcionalidades do Inbox — progress tracker

Checkpoint desta iniciativa, mesmo formato/propósito de
[`docs/engineering-standards-progress.md`](./engineering-standards-progress.md):
se a sessão for interrompida, a próxima retoma lendo este arquivo, sem
precisar redescobrir nada.

Plano completo (contexto, decisões de escopo):
`C:\Users\Usuario\.claude\plans\partitioned-forging-pancake.md` (plano
aprovado da sessão que iniciou esta iniciativa).

Regra de ouro: cada sub-feature é aditiva, deixa o sistema 100%
funcional ao final, e roda `npm run lint && npm run typecheck && npm
test && npm run build` verde antes de ser marcada concluída.

## Contexto rápido

Usuário pediu para "turbinar" as trocas de mensagem. Investigação
mostrou que áudio, mensagens prontas, reações, resposta a mensagem
específica, templates, mensagens interativas e status de
entrega/leitura **já existem e funcionam** — só não são visíveis sem um
WhatsApp real conectado. As 4 funcionalidades abaixo são as lacunas
reais confirmadas, uma por categoria que o usuário escolheu.

## Próximo passo

**Funcionalidade 4 — Resumir conversa por IA.** Funcionalidades 1, 2 e 3
concluídas.

## 1 — Fixar conversas (Organização) — ✅ FEITO

- [x] Migration `038_pinned_conversations.sql`: tabela
      `pinned_conversations (id, account_id, user_id, conversation_id,
      created_at)`, `UNIQUE(user_id, conversation_id)`, RLS (leitura/
      exclusão restrita a `auth.uid() = user_id`; inserção também exige
      `is_account_member(account_id)` + confirmação de que a conversa
      referenciada realmente pertence à conta informada), índice em
      `user_id`. Realtime habilitado na tabela. Aplicada via
      `supabase migration up` (sem resetar dados existentes).
- [x] `src/components/inbox/conversation-list.tsx`: busca os pins do
      usuário atual ao montar, ordena fixadas primeiro (mantendo
      `last_message_at DESC` dentro de cada grupo — sort estável),
      botão de fixar/desfixar por linha (ícone `Pin`, visível sempre
      quando fixada, aparece no hover quando não). A linha inteira
      deixou de ser um `<button>` nativo (não pode aninhar botão) e
      virou um `<div role="button" tabIndex>` com `onKeyDown` pra
      manter a navegação por teclado.
- [x] Chaves i18n (`pin`/`unpin`) em `Inbox.conversationList` nos 3
      idiomas (en/ko/pt-BR).
- [x] **Verificação real, não só automatizada**: como este ambiente de
      dev não tem WhatsApp conectado (inbox vazio), não dava pra testar
      clicando em conversas reais. Rodado um script Playwright
      descartável (criava conta nova, semeava 2 conversas via SQL
      direto, testava fixar → vai pro topo → sobrevive a reload →
      desfixar → volta a ordem padrão) — passou nas 3 asserções. Script
      apagado depois (não faz parte da suíte permanente, seguindo o
      mesmo raciocínio do `e2e/smoke.spec.ts`: suíte permanente fica
      enxuta, script de verificação pontual não precisa virar teste
      fixo).
- [x] Gate completo: lint (0 erros), typecheck (0 erros), 792/792
      testes, build OK.

## 2 — Notas internas por conversa (Produtividade) — ✅ FEITO

- [x] Migration `039_conversation_notes.sql`: cópia estrutural de
      `contact_notes` (mesma RLS via `is_account_member`, min-role
      'agent' pra escrever), trocando `contact_id` por
      `conversation_id`, com checagem extra no INSERT de que a
      conversa referenciada pertence mesmo à conta informada. Realtime
      habilitado. Aplicada via `supabase migration up`.
- [x] **Correção ao plano original**: em vez de colocar a seção nova
      dentro de `message-thread.tsx`, ela foi pra `contact-sidebar.tsx`
      — é o painel lateral que já existe especificamente pra
      informação de apoio (tags, negócios, notas do contato); criar um
      segundo lugar de "notas" dentro do thread principal duplicaria
      UI. `ContactSidebar` ganhou um novo prop opcional
      `conversationId`, passado por `src/app/(dashboard)/inbox/page.tsx`.
      Nova seção "Notas desta conversa" logo abaixo do telefone/e-mail,
      antes das tags — o contexto mais imediato pro atendente. A seção
      de notas do contato (mais abaixo) foi rotulada "Notas do
      contato" nos 3 idiomas pra não ficar ambíguo com a nova.
- [x] Novo tipo `ConversationNote` em `src/types/index.ts`.
- [x] Chaves i18n em `Inbox.sidebar` nos 3 idiomas.
- [x] Corrigido durante o gate: `setConversationNotes([])` síncrono no
      corpo do effect disparava a regra `react-hooks/set-state-in-effect`
      como erro (não warning) — resolvido com o mesmo
      `eslint-disable-next-line` já usado em `fetchContactData` no
      mesmo arquivo, mesmo padrão.
- [x] Verificação real (mesmo raciocínio da funcionalidade 1 — inbox
      vazio neste ambiente): script Playwright descartável criou conta
      + conversa via SQL, abriu o painel lateral, confirmou os dois
      rótulos distintos ("Notas desta conversa" vs "Notas do
      contato"), adicionou uma nota, confirmou que apareceu e que
      sobrevive a reload. Passou nas 3 asserções, script apagado depois.
- [x] Gate completo: lint (0 erros), typecheck (0 erros), 792/792
      testes, build OK.

## 3 — Enviar localização (Mais tipos de mensagem) — ✅ FEITO

- [x] `src/lib/whatsapp/meta-api.ts`: `sendLocationMessage()` — payload
      `{type:'location', location:{latitude, longitude, name?, address?}}`,
      mesmo formato de `sendTextMessage`.
- [x] `src/lib/whatsapp/send-message.ts`: `'location'` adicionado a
      `VALID_MESSAGE_TYPES` (não é `MediaKind` — não é um link que o
      Meta busca, é lat/lng inline no payload). Validação de lat
      (-90..90) e lng (-180..180) em `validateSendMessageParams`. Texto
      persistido (`content_text`) e o preview da conversa
      (`last_message_text`) usam a MESMA formatação que o webhook já
      usa pra localização recebida (`[nome, endereço, "lat,lon"].filter(Boolean).join(' - ')`)
      — bolha de enviado e recebido ficam visualmente idênticas.
- [x] `src/app/api/whatsapp/send/route.ts`: repassa `location` do corpo
      da requisição pro core de envio.
- [x] `message-composer.tsx`: item "Enviar localização" no menu de
      anexos, diálogo com botão "Usar minha localização atual"
      (`navigator.geolocation`) + campos manuais de latitude/longitude/
      nome/endereço, validação client-side antes de enviar.
- [x] `message-thread.tsx`: `handleSendLocation` (mesmo padrão de
      `handleSendMedia`/`handleSendInteractive` — bolha otimista, POST
      pra `/api/whatsapp/send`, marca `sent`/`failed`).
- [x] `message-bubble.tsx` já renderizava location — confirmado que
      cobre outbound sem mudança (é só `content_text` + ícone de pin).
- [x] Chaves i18n (`sendLocation`, `useMyLocation`, `latitude`,
      `longitude`, etc.) nos 3 idiomas.
- [x] **Testes de verdade** (não só verificação manual — essa
      funcionalidade tem lógica de validação pura, testável): 4 casos
      novos em `send-message.test.ts` (location ausente, latitude
      inválida, longitude inválida, valores de fronteira ±90/±180
      aceitos).
- [x] Verificação end-to-end via script Playwright descartável: abriu
      o diálogo, confirmou rejeição client-side com campos vazios,
      preencheu lat/lng válidos, confirmou que a bolha otimista
      renderiza o texto composto corretamente. Script apagado depois.
- [x] Gate completo: lint (0 erros), typecheck (0 erros), **796/796
      testes**, build OK.

## 4 — Resumir conversa sob demanda (IA) — ⬜ NÃO INICIADO

- [ ] `src/lib/ai/summarize.ts`: `generateSummary()` reaproveitando os
      adapters existentes de `src/lib/ai/providers/*` — nenhum adapter
      novo.
- [ ] `src/app/api/ai/summarize/route.ts`: espelha
      `src/app/api/ai/draft/route.ts` (auth, rate limit, erros).
- [ ] Novo bucket `aiSummary` em `src/lib/rate-limit.ts`.
- [ ] Botão "Resumir conversa" no header de `message-thread.tsx`,
      popover/dialog com o resultado + botão "Salvar como nota" (usa a
      funcionalidade 2).
- [ ] Log de uso via `src/lib/ai/usage.ts` (mesmo padrão do draft).
- [ ] Chaves i18n nos 3 idiomas.
- [ ] Teste com providers mockados (padrão de `src/lib/ai/**.test.ts`).
- [ ] Gate completo verde.

## Backlog (Fase 2+, não agendado)

- Busca dentro do histórico de mensagens
- Indicador de "cliente esperando há X min"
- Notificações mais completas (nova mensagem, @menção) — precisa
  alargar o `CHECK` de `notifications` e decidir critério anti-spam
- Respostas sugeridas pela IA (avaliar sobreposição com "Draft with
  AI" antes de construir)
- Envio de cartão de contato (Meta `type: contacts`)
- Envio de figurinha — descartado por enquanto (baixo valor pra CRM de
  atendimento, exige stickers webp pré-prontos)
