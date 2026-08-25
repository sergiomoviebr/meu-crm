# Handoff completo — Meu CRM

Atualizado em: 19/08/2026  
Workspace: `C:\Users\Usuario\Desktop\meu crm`

## Como continuar em outro chat

No novo chat, peça para ler este arquivo inteiro antes de alterar código:

> Leia `CONTINUAR-EM-OUTRO-CHAT.md`, respeite o `AGENTS.md`, preserve todas as alterações existentes e continue a partir da seção “Próximas prioridades”. Não reverta arquivos do worktree.

## Estado geral

O CRM é uma aplicação Next.js 16.2.12 com Supabase, TypeScript, Tailwind, Vitest e integrações Meta/WhatsApp. O `AGENTS.md` alerta que esta versão do Next possui mudanças incompatíveis; antes de escrever código Next, devem ser lidos os guias relevantes em `node_modules/next/dist/docs/`.

O worktree está intencionalmente muito modificado e contém diversas funcionalidades ainda não commitadas. Não usar `git reset`, `git checkout --` nem sobrescrever arquivos em massa. Alterações existentes pertencem ao usuário e devem ser preservadas.

Última validação completa:

- TypeScript: aprovado.
- ESLint do dashboard de Tráfego: aprovado.
- Vitest: 125 arquivos e 1.052 testes aprovados.
- Build de produção: aprovado.
- Avisos conhecidos do build: convenção `middleware` depreciada em favor de `proxy`; edge runtime desabilita geração estática em uma página.

Comandos usados para validação:

```powershell
npm.cmd run typecheck
npm.cmd test -- --run
npm.cmd run build
```

No Windows, Vitest/build podem falhar no sandbox com `spawn EPERM`; nesse caso precisam ser executados com permissão ampliada.

---

## 1. Revisão geral de UI/UX e estrutura do CRM

Foi feita uma evolução transversal do CRM com foco em navegação, contatos, pipeline, mensagens, configurações, dashboard, busca e responsividade.

Principais áreas alteradas:

- Sidebar e header.
- Central de comandos/busca.
- Dashboard e centro de atenção.
- Contatos, importação, deduplicação e inteligência de relacionamento.
- Pipeline, cards de negócio, analytics, configuração e prévia de conversa.
- Mensagens, ações, composer, thread e lista de conversas.
- Configurações e permissões.
- Módulos novos de Conteúdo, Tarefas e Tráfego.

Auditoria visual registrada em:

- `docs/ux-audit-2026-08.md`

Arquivos importantes:

- `src/components/layout/sidebar.tsx`
- `src/components/layout/header.tsx`
- `src/components/layout/command-center.tsx`
- `src/app/(dashboard)/dashboard/page.tsx`
- `src/components/dashboard/attention-center.tsx`
- `src/components/dashboard/awaiting-replies.tsx`
- `src/components/dashboard/upcoming-birthdays.tsx`

---

## 2. Mensagens e WhatsApp

### Funcionalidades implementadas

- Envio compartilhado por uma camada central em `src/lib/whatsapp/send-message.ts`.
- Suporte a WhatsApp oficial da Meta e WhatsApp pessoal conectado por QR/Baileys.
- Política da janela de 24 horas e exigência de template aprovado fora da janela.
- Observabilidade de entrega: enviando, aceito, entregue, lido, respondido e falhou.
- Histórico de tentativas e detalhes de erro.
- Reenvio de mensagens com falha e fila de retry.
- Mensagens interativas, mídia, localização, templates, resposta/quote e ações.
- Nova conversa e resolução segura de conversa por contato/canal.
- Conexões múltiplas de WhatsApp pessoal.
- Persistência criptografada da sessão, restauração e sincronização de histórico.
- Meta OAuth/Embedded Signup preparado nas configurações.

Documentação:

- `docs/messages-audit-2026-08.md`
- `docs/message-delivery.md`
- `docs/adr/0005-personal-whatsapp-persistent-connection.md`
- `docs/adr/0006-meta-oauth-connections.md`

### Incidente diagnosticado

As mensagens recentes para o contato **Loyane** não estavam sendo enviadas. O banco mostrou:

- Canal: `whatsapp_personal`.
- Erro: `whatsapp_personal_disconnected`.
- Mensagens anteriores haviam sido entregues normalmente.
- Duas tentativas estavam na fila `message_retry_jobs`.
- As duas sessões de WhatsApp pessoal estavam com `status = error`, credenciais presentes e mensagem “Conexão perdida — reconectando automaticamente…”.

Isso não era defeito do contato nem do composer. A sessão por QR havia caído. Para voltar a enviar, é necessário abrir **Configurações → WhatsApp pessoal**, tentar **Conectar** e, se necessário, gerar **Novo QR Code** e escanear pelo celular. Depois, usar **Tentar novamente** na mensagem.

Não apagar credenciais nem forçar logout sem autorização: isso exige novo pareamento físico.

Arquivos centrais:

- `src/lib/whatsapp/send-message.ts`
- `src/lib/whatsapp-personal/connection-manager.ts`
- `src/lib/whatsapp-personal/send.ts`
- `src/app/api/whatsapp/send/route.ts`
- `src/app/api/whatsapp/messages/[id]/delivery/route.ts`
- `src/app/api/whatsapp/messages/retry-cron/route.ts`
- `src/components/inbox/message-delivery-details.tsx`
- `src/components/settings/whatsapp-personal-connect.tsx`

---

## 3. Automações — Qualificação Comercial Inteligente

Foi auditado o motor atual, que já possuía gatilhos, condições, esperas persistentes, ramificações, logs e ações de WhatsApp.

### Regra comercial preservada

A empresa envia primeiro o “Oi”. A qualificação só começa depois que o lead responde. O sistema atua como copiloto, nunca como bot autônomo.

### Implementado

- Novo passo `sales_qualify` no motor e no construtor.
- Modo obrigatório `suggestion`; não envia mensagem automaticamente.
- Template **Qualificação Comercial Inteligente** com gatilho `first_inbound_message`.
- Classificador comercial determinístico e auditável.
- 18 intenções comerciais, incluindo preço, interesse, sem orçamento, experiência ruim, já possui agência/gestor, pediu reunião, resposta ambígua e necessidade de humano.
- Confiança, sinais encontrados, score, temperatura, dor principal, próxima melhor ação e handoff humano.
- Sugestão consultiva persistida para futura caixa de aprovação.
- Atualização estruturada do contato.
- Log por execução com intenção, transição de score e recomendação humana.
- Simulador no menu de Automações, sem enviar mensagem e sem alterar contato.
- Traduções do novo passo em português, inglês e coreano.

Arquivos principais:

- `src/lib/sales/intent-classifier.ts`
- `src/lib/sales/intent-classifier.test.ts`
- `src/lib/automations/engine.ts`
- `src/lib/automations/templates.ts`
- `src/lib/automations/validate.ts`
- `src/components/automations/automation-builder.tsx`
- `src/app/(dashboard)/automations/page.tsx`
- `src/app/api/automations/simulate-qualification/route.ts`
- `docs/automations-sales-audit-2026-08.md`

Migração:

- `060_sales_qualification_copilot.sql` — aplicada com sucesso no Supabase local.

Próxima prioridade desse módulo:

- Mostrar sugestões diretamente dentro da conversa com ações **usar**, **editar**, **ignorar** e **avaliar**.
- Depois: follow-ups seguros, agenda e dashboard de conversão.

---

## 4. Tráfego Pago — fundação existente

Antes das últimas alterações, o módulo já tinha uma base consistente:

- Contas Meta, Google e manuais vinculadas ao contato usado como cliente.
- Hierarquia conta → campanha → conjunto → anúncio/criativo.
- Tabela temporal normalizada `traffic_metrics_daily`.
- Métricas brutas: investimento, impressões, alcance, cliques, leads, conversões, receita e visitas.
- CPL, CPC, CPM, CPA, CTR, frequência e ROAS calculados em leitura.
- Importação manual e CSV.
- Adaptadores Meta Ads e Google Ads.
- Cron protegido por segredo.
- Diagnóstico com IA e contexto estruturado.
- Recomendações auditáveis, aprovação, plano de otimização e timeline.
- Sinais determinísticos de tendência, landing page, funil e fadiga criativa.
- RLS por conta e permissões por função.

Auditoria:

- `docs/traffic-performance-audit-2026-08.md`

Arquivos centrais da fundação:

- `src/lib/traffic/signals.ts`
- `src/lib/traffic/context.ts`
- `src/lib/traffic/diagnostic.ts`
- `src/lib/traffic/providers/dispatch.ts`
- `src/lib/traffic/providers/meta_ads.ts`
- `src/lib/traffic/providers/google_ads.ts`
- `src/app/api/traffic/cron/route.ts`
- `src/app/api/traffic/metrics/route.ts`
- `src/app/api/traffic/metrics/import/route.ts`

---

## 5. Tráfego Pago — dashboard executivo implementado

A tela principal foi transformada em uma Central de Performance voltada a apresentação para clientes.

Arquivo principal:

- `src/app/(dashboard)/traffic/page.tsx`

### Dados e filtros

- Seleção de cliente.
- Plataforma: todas, Meta Ads ou Google Ads.
- Período personalizado.
- Atalhos: Hoje, 7 dias, 14 dias, 30 dias, mês atual e mês anterior.
- Comparação automática com janela anterior de mesma duração.
- Resumo usa somente linhas `entity_type = ad_account` para não duplicar dados de conta/campanha/conjunto/anúncio.
- Métricas sem base confiável não são exibidas.
- Vendas, CAC e ROI não são inventados enquanto não houver atribuição anúncio → lead → negócio.

### UI/UX premium

- Hero executivo em gradiente com cliente, período, investimento, oportunidades e eficiência.
- Status semântico: saudável, atenção ou crítico.
- Principal insight no topo.
- Minha recomendação destacada no hero.
- Navegação por narrativa:
  - Visão geral.
  - Performance.
  - Diagnóstico.
  - Plano de ação.
- Barra de contexto fixa e translúcida.
- Cards executivos com tipografia forte, espaço, microinteração e sparklines.
- Gráfico principal alternável entre Investimento, Leads e CPL.
- Linha discreta do período anterior.
- Métricas técnicas expansíveis no modo Gestor.
- Recomendações clicáveis e card de ação estratégica.
- Análise do gestor e próximos passos editáveis.
- Skeleton correspondente ao layout.
- Empty state honesto, sem dados falsos.
- Responsividade e dark mode mantidos.

### Modos

- Modo Cliente: linguagem executiva e simplificada.
- Modo Gestor: camada técnica e edição.
- Modo Apresentação: oculta sidebar/header e amplia o relatório.
- Impressão/PDF: CSS específico para remover controles.

### Persistência

A análise e os próximos passos são salvos por:

- Conta.
- Cliente.
- Data inicial.
- Data final.
- Plataforma.

Migração:

- `061_traffic_executive_reports.sql` — aplicada com sucesso no Supabase local.

### Decisão importante

Não foi criado “Performance Score 82/100”, pois ainda não existe fórmula configurável e explicável. A saúde atual deriva das recomendações abertas já existentes. Não adicionar score arbitrário com aparência científica.

---

## 6. Outros módulos e migrações presentes

O worktree também contém implementações anteriores relacionadas a:

- Conteúdo e perfis sociais.
- Inteligência de conteúdo.
- Tráfego e performance.
- WhatsApp pessoal.
- Edição e observabilidade de mensagens.
- Retry de mensagens.
- Inteligência de relacionamento dos contatos.
- Inteligência do pipeline e integração com conversas.
- Sincronização de histórico do WhatsApp pessoal.
- Tarefas comerciais.

Migrações novas no worktree: `041` até `061`. Não renumerar nem recriar essas migrações. Antes de adicionar nova mudança de banco, usar `062_...sql`.

As migrações `060` e `061` foram explicitamente aplicadas nesta sessão com:

```powershell
npx.cmd supabase migration up
```

O Supabase local estava ativo em `127.0.0.1:54321`, com banco em `127.0.0.1:54322`.

---

## 7. Próximas prioridades recomendadas

### Prioridade 1 — atribuição comercial real

Criar a relação confiável:

`campaign_id / ad_id / UTM → contato lead → conversa → qualificação → negócio → venda`

Somente depois disso exibir:

- Leads atendidos.
- Tempo de primeira resposta.
- Leads sem atendimento.
- Qualificados.
- Agendamentos.
- Vendas.
- Receita real.
- CAC.
- ROI real.
- Marketing versus Comercial.

Não assumir que o `contact_id` do cliente gestor representa os leads gerados pelas campanhas.

### Prioridade 2 — campanhas e criativos premium

- Cards de campanhas com métricas, saúde explicável e recomendação.
- Cards de criativos com thumbnail.
- Ranking de criativos.
- Fadiga criativa com CTA para Conteúdo.
- Drawer lateral sem sair do dashboard.
- Comparação antes/depois.

### Prioridade 3 — storytelling e operação

- Timeline de otimizações usando `traffic_optimization_log`.
- Matriz impacto × esforço com campos persistentes.
- Transformar recomendação em tarefa do módulo geral de Tarefas.
- Histórico “a recomendação funcionou?”.
- Plano de ação visual por datas.

### Prioridade 4 — apresentação e compartilhamento

- Slides internos: Resumo, Resultados, Funil, Criativos, Diagnóstico, Próximos passos.
- Card compacto para WhatsApp.
- Exportação PNG de alta resolução.
- Templates de print por seção.
- Branding de agência/cliente.

### Prioridade 5 — inteligência

- Metas por cliente e KPI principal.
- Fórmula de saúde configurável/versionada.
- Forecast com faixa de incerteza.
- Anomalias com mínimo de amostra.
- Resumo executivo com IA citando os números usados.
- IA conversacional sobre dados reais.

---

## 8. Cuidados para o próximo chat

- Ler `AGENTS.md` e os guias Next relevantes antes de editar Next.js.
- Usar `apply_patch` para alterações manuais.
- Preservar o worktree sujo.
- Não criar dados fictícios de produção.
- Não somar métricas de níveis diferentes; isso duplica investimento/resultados.
- Meta e Google possuem atribuições diferentes; não misturar conceitos incompatíveis sem indicar metodologia.
- IA sugere; gestor decide. Nunca desligar campanha ou alterar orçamento automaticamente.
- Não exibir métricas comerciais sem fonte confiável.
- Manter RLS e escopo por `account_id` em toda nova tabela/rota.
- Validar ownership antes de usar cliente service-role.
- Testar proporcionalmente e executar typecheck, testes e build antes de concluir.
- Se o envio de WhatsApp pessoal falhar, verificar primeiro o status da sessão QR, não alterar o composer às cegas.

## 9. Situação do Git

Não foi criado commit nesta conversa. Há muitos arquivos modificados e novos. O próximo chat deve tratar tudo como trabalho válido em andamento e não deve limpar o repositório.

Antes de qualquer alteração grande, executar:

```powershell
git status --short
```

Depois, trabalhar somente nos arquivos necessários ao próximo objetivo.

