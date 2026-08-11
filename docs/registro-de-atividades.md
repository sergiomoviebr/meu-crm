# Registro de atividades — ambiente + hardening (agosto/2026)

Este documento resume tudo que foi feito até agora nas sessões de setup e
hardening do fork `meu crm` (baseado no template wacrm). **Nada aqui
adicionou funcionalidade nova visível no dashboard** — foi tudo
infraestrutura, correções e blindagem do que o template já trazia
pronto. Funcionalidades novas de verdade começam depois deste documento.

---

## 1. Ambiente de desenvolvimento

- Instalado: WSL2, Docker Desktop, Git, Node (já presente), Supabase CLI
  (como devDependency do projeto).
- Repositório `wacrm` (ArnasDon/wacrm) clonado para dentro de
  `c:\Users\Usuario\Desktop\meu crm` — este diretório é um clone real,
  com histórico de commits do próprio wacrm.
- Stack Supabase local rodando via Docker (`supabase start`): Postgres,
  Auth, Storage, Realtime, Studio, Mailpit (e-mails de teste) — todas as
  37 migrations do projeto aplicadas.
- `.env.local` configurado com as chaves da instância local.

## 2. Localização pt-BR

- `messages/pt-BR.json`: tradução completa (1453 chaves) de toda a
  interface — menus, formulários, mensagens de erro, tudo.
- `NEXT_PUBLIC_APP_LOCALE=pt-BR` ativo — `<html lang="pt-BR">`, e
  formatação de datas/horas relativas também em português
  (`src/lib/date-fns-locale.ts`).
- Código-fonte, comentários e documentação técnica continuam em inglês
  (convenção já existente no repositório) — só o que o usuário final vê
  está em português.

## 3. Bugs corrigidos pelo caminho

Nenhum destes foi pedido diretamente — apareceram durante o setup/testes
e foram corrigidos porque bloqueavam o funcionamento normal do sistema:

| Bug | Onde | Causa |
|---|---|---|
| Cadastro preso em "verifique seu e-mail" | `signup/page.tsx` | Confirmação de e-mail desativada localmente, mas a tela não checava se a sessão já vinha ativa |
| `permission denied for table X` no dashboard inteiro | `supabase/config.toml` | Supabase CLI local não concede GRANTs automáticos por padrão; as migrations do wacrm dependem desse comportamento legado |
| 2 testes falhando (moeda e dia-da-semana) | `currency.test.ts`, `date-utils.test.ts` | Testes presos ao locale (pt-BR) e timezone (America/Sao_Paulo) desta máquina — não é bug de produção, só teste frágil |
| ESLint com ~150 erros | `eslint.config.mjs` | Estava tentando lintar um arquivo temporário gerado pelo próprio Supabase CLI |
| CSP bloqueando login/cadastro | `next.config.ts` | Ao ativar CSP enforcing, a política não liberava o Supabase local (`http://127.0.0.1:54321`) |

## 4. Rollout de padrões de engenharia (a pedido do usuário)

Documento de padrões de engenharia sênior fornecido pelo usuário,
adaptado e aplicado em 4 fases — tudo documentado em
[`docs/engineering-standards.md`](./engineering-standards.md),
[`docs/adr/`](./adr) e o histórico completo, passo a passo, em
[`docs/engineering-standards-progress.md`](./engineering-standards-progress.md).

**Resumo do que mudou (tudo invisível no dashboard — segurança e
qualidade interna):**

- **Segurança**: teste automatizado garantindo que a API pública
  (`/api/v1/*`) nunca vaza dado de uma conta pra outra; validação de
  entrada com `zod` em todas as rotas de escrita da API pública; CSP
  (Content-Security-Policy) mudou de "só monitorar" pra "bloquear de
  verdade"; decisão documentada sobre CORS.
- **Observabilidade**: `src/lib/logger.ts` — logs estruturados nos
  pontos mais críticos (webhook do WhatsApp, rotas de cron, tratamento
  de erro central).
- **Testes**: rotas de cron e de broadcast antes sem nenhum teste agora
  cobertas; suíte de testes unitários foi de 757 pra **792**; primeiro
  teste End-to-End (Playwright) rodando num navegador de verdade contra
  o Supabase local de verdade.

**Achado em aberto, precisa de decisão sua** (não é bloqueante, mas é
importante): botões de "Salvar"/"Criar" que dependem só de
`type="submit"` (sem `onClick` próprio) não estão respondendo a clique
no teste automatizado — só Enter ou envio programático funcionam. Pode
ser um bug real da biblioteca de UI (`@base-ui/react`) afetando qualquer
botão desse tipo no app, ou pode ser específico do navegador headless do
teste. **Vale confirmar clicando de verdade em algum formulário do
dashboard** (ex: criar um contato, clicando no botão "Criar" com o
mouse) pra saber se afeta uso real.

---

## O que isso significa pra você, hoje

- O dashboard tem exatamente as mesmas telas e funcionalidades de antes
  — inbox, contatos, pipelines, transmissões, automações, fluxos,
  agentes de IA, configurações. Nada foi adicionado, só protegido e
  traduzido.
- O sistema está mais seguro, mais testado, e documentado de um jeito
  que qualquer pessoa (ou IA) trabalhando nele depois entende o
  "porquê" das decisões, não só o "o quê".
- A partir daqui, o trabalho vira sobre construir funcionalidade nova de
  verdade.
