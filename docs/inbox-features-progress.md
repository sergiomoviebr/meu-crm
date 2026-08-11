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

**Funcionalidade 2 — Notas internas por conversa.** Funcionalidade 1
concluída.

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

## 2 — Notas internas por conversa (Produtividade) — ⬜ NÃO INICIADO

- [ ] Migration `039_conversation_notes.sql`: cópia estrutural de
      `contact_notes`, trocando `contact_id` por `conversation_id`.
- [ ] Nova seção "Notas da conversa" em
      `src/components/inbox/message-thread.tsx`, reaproveitando o
      padrão de UI de `contact-sidebar.tsx`.
- [ ] Chaves i18n (`Inbox.notes` ou similar) nos 3 idiomas.
- [ ] Teste de isolamento RLS.
- [ ] Gate completo verde.

## 3 — Enviar localização (Mais tipos de mensagem) — ⬜ NÃO INICIADO

- [ ] `src/lib/whatsapp/meta-api.ts`: função de envio de localização
      (payload `{type:'location', location:{...}}`).
- [ ] `src/lib/whatsapp/send-message.ts`: `messageType: 'location'` +
      validação de lat/lng em `validateSendMessageParams`.
- [ ] `message-composer.tsx`: item "Enviar localização" no menu "+",
      diálogo com geolocalização do navegador + entrada manual.
- [ ] Confirmar que `message-bubble.tsx` renderiza location outbound
      (já renderiza inbound).
- [ ] Chaves i18n nos 3 idiomas.
- [ ] Teste de validação (lat/lng inválidos rejeitados).
- [ ] Gate completo verde.

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
