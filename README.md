# Meu CRM — CRM completo para WhatsApp

> Inbox compartilhada (WhatsApp oficial + WhatsApp pessoal), pipeline de
> vendas, automações com um copiloto de IA que qualifica leads sozinho,
> e um dashboard de tráfego pago com atribuição de verdade — campanha
> → lead → venda. Tudo rodando em uma única stack, com dados 100% seus.

[![License: MIT](https://img.shields.io/badge/License-MIT-violet.svg)](./LICENSE)
[![CI](https://github.com/sergiomoviebr/meu-crm/actions/workflows/ci.yml/badge.svg)](https://github.com/sergiomoviebr/meu-crm/actions/workflows/ci.yml)
[![Next.js 16](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)](https://nextjs.org)
[![Supabase](https://img.shields.io/badge/Supabase-Postgres%20%2B%20Auth-3ecf8e?logo=supabase)](https://supabase.com)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178c6?logo=typescript)](https://www.typescriptlang.org)

Repositório **privado**. Este é o CRM real do negócio — não um template
para terceiros forkarem.

## O que tem aqui

- **Inbox compartilhada** — WhatsApp Business oficial (Meta Cloud API)
  e WhatsApp pessoal via QR code (múltiplas conexões simultâneas),
  tudo na mesma caixa de entrada. Assinatura de conversa por agente,
  notas internas, respostas com citação, mensagens de localização,
  resumo de conversa sob demanda por IA.
- **Contatos** — tags, campos customizados, importação de CSV/Excel
  com detecção automática de delimitador, deduplicação, inteligência
  de relacionamento por contato.
- **Pipeline de vendas** (Kanban) — negócios ligados a conversas,
  analytics de funil, prévia de conversa direto no card.
- **Automações no-code** — gatilhos por mensagem recebida, novo
  contato, palavra-chave ou agenda; condições, ramificações, esperas
  persistentes, tags, webhooks, envio de WhatsApp.
- **Qualificação Comercial com IA** — copiloto que lê a primeira
  resposta do lead, classifica entre 18 intenções comerciais (preço,
  interesse, sem orçamento, já tem agência, pediu reunião, precisa de
  humano...), calcula score e temperatura do lead, sugere a próxima
  melhor ação — sempre como sugestão para o time aprovar, nunca como
  bot autônomo disparando sozinho.
- **Resposta com IA** — chave própria (OpenAI ou Anthropic, criptografada),
  rascunhos com um clique no inbox, auto-resposta opcional com limite por
  conversa, base de conhecimento (FAQs, políticas, produtos) respondida
  por busca híbrida.
- **Tráfego Pago** — contas Meta/Google Ads, campanhas, conjuntos,
  anúncios/criativos, métricas diárias, diagnóstico por IA (fadiga de
  criativo, sinais de landing page, tendências), dashboard executivo
  por cliente com modo Cliente/Gestor/Apresentação. **Atribuição
  comercial real**: todo lead que chega por um anúncio Click-to-WhatsApp
  (oficial ou pessoal) é automaticamente ligado à campanha/anúncio de
  origem, permitindo funil completo até CAC e ROI de verdade — não
  estimativa.
- **Conteúdo & Redes Sociais** — calendário editorial, ideias, perfis
  sociais (Instagram/Facebook/LinkedIn), publicação agendada.
- **Tarefas** — follow-ups comerciais com prazo e responsável.
- **Dashboard em tempo real** — tempo de resposta, volume diário,
  valor em pipeline, feed de atividade entre módulos.
- **Contas em equipe** — múltiplos usuários por conta, papéis
  (owner/admin/agent/viewer), RLS em toda tabela sensível.
- **API pública** (`/api/v1`) com chaves escopadas e revogáveis — ver
  [docs/public-api.md](./docs/public-api.md).
- **Servidor MCP** — controle o CRM a partir do Claude, Cursor e
  outros assistentes de IA via [Model Context Protocol](https://modelcontextprotocol.io) —
  ver [docs/mcp.md](./docs/mcp.md).

## Stack

- **App** — Next.js 16 (App Router), React 19, TypeScript (strict), Tailwind v4.
- **Dados** — Supabase (Postgres + Auth + Storage + RLS).
- **WhatsApp** — Meta Cloud API (oficial) e Baileys (pessoal, via QR).
- **IA** — OpenAI ou Anthropic, chave própria, sem taxa por assento.

## Como rodar localmente

```bash
git clone git@github.com:sergiomoviebr/meu-crm.git
cd meu-crm
npm install
cp .env.local.example .env.local   # preencha Supabase + Meta
npx supabase start                 # stack local do Supabase
npx supabase db reset              # aplica todas as migrations
npm run dev
```

Abra <http://localhost:3000>. Você será redirecionado para `/login`
(ou `/dashboard` se já estiver logado).

Prefere containers? Veja [docs/docker.md](./docs/docker.md).

## Documentação

Toda a documentação vive dentro deste repositório, em [`docs/`](./docs):

- [Padrões de engenharia](./docs/engineering-standards.md) — a regra de
  ouro do projeto: arquitetura, segurança, testes, convenções de API.
- [API pública](./docs/public-api.md) · [Servidor MCP](./docs/mcp.md) ·
  [Docker](./docs/docker.md)
- [Decisões de arquitetura (ADRs)](./docs/adr)
- Auditorias e handoffs de cada módulo: [Mensagens/WhatsApp](./docs/messages-audit-2026-08.md),
  [Automações comerciais](./docs/automations-sales-audit-2026-08.md),
  [Tráfego Pago](./docs/traffic-performance-audit-2026-08.md),
  [UX geral](./docs/ux-audit-2026-08.md)
- [Claudex](./docs/claudex.md) — loop de planejamento com revisão
  adversarial (Claude + Codex) usado no desenvolvimento deste projeto.

## Origem

Este projeto nasceu do template open-source
[wacrm](https://github.com/ArnasDon/wacrm) (MIT, por Arnas Donauskas)
e foi customizado e estendido de forma extensa e contínua — módulos de
tráfego pago, qualificação comercial com IA, WhatsApp pessoal,
conteúdo, tarefas e atribuição de leads não existem no template
original. O remoto `upstream` deste repositório aponta para o projeto
original, mantido apenas como referência histórica — não há intenção
de sincronizar ou contribuir de volta.

## Licença

O código herdado do template original permanece sob [MIT](./LICENSE).
Como este repositório agora contém lógica de negócio proprietária,
vale revisar essa licença antes de compartilhar o código com terceiros.
