# Auditoria de UI/UX — agosto de 2026

Auditoria baseada na aplicação existente. A regra é preservar fluxos funcionais,
priorizar operação diária e não criar indicadores sem dados reais.

## Resumo executivo

O CRM já possui boa profundidade funcional, mas a experiência está organizada por
módulos. O usuário ainda precisa visitar várias telas para formar uma lista mental
do que exige atenção. O maior ganho não está em redesenhar cards: está em reunir
pendências reais, oferecer busca transversal e permitir iniciar ações sem procurar
o módulo responsável.

## Achados por prioridade

### P0 — confiabilidade

- A nova agenda comercial não participava do dashboard nem da navegação global.
- Não havia uma busca transversal; localizar um registro exigia conhecer seu módulo.
- Algumas ações rápidas apontavam apenas para a página, sem abrir o fluxo de criação.

### P1 — operação diária

- Dashboard começa por métricas históricas, enquanto pendências operacionais ficam
  distribuídas em widgets sem uma hierarquia única.
- Tarefas atrasadas, reuniões do dia, mensagens falhas, novos leads e oportunidades
  paradas não eram apresentados como uma lista decisória única.
- O cabeçalho não oferecia pesquisa nem criação rápida persistente entre telas.
- Sidebar cresceu como lista plana; conteúdo e tráfego já são agrupados, mas as áreas
  principais ainda competem visualmente sem separação semântica.

### P2 — produtividade

- Tarefas têm lista e filtros, mas ainda não possuem Kanban, snooze ou criação rápida
  dentro do contato/conversa.
- Contato é rico, porém tarefas e agenda ainda não formam abas do hub do cliente.
- Inbox carece de busca no histórico, rascunho persistente, agendamento e filtros
  completos para falhas/agendadas/arquivadas.
- Filtros de contatos são abrangentes, mas ainda não podem ser salvos nem ter colunas
  configuráveis.
- Sidebar ainda não possui modo recolhido persistente.

### P3 — refinamento

- Há textos novos em português fora do catálogo de tradução.
- Telas antigas usam padrões diferentes de loading; o shell ainda usa spinner cheio.
- Alguns botões somente com ícone usam `title`, mas o padrão deveria convergir para o
  componente Tooltip acessível.

## O que já existe e deve ser preservado

- Contatos: pesquisa com debounce, paginação server-side, 10/25/50/100 registros,
  seleção, selecionar todos da página, tags/status/responsável em massa, exportação,
  arquivamento, lixeira e confirmação para exclusão volumosa.
- Pipeline: drag and drop com teclado, feedback de drop, última mensagem, nome/empresa,
  origem, responsável, tempo aguardando e resposta direta pelo card.
- Inbox: atribuição, notas, pins, mídia, templates, reações, reply, IA e deep links.
- Dashboard: métricas, clientes aguardando, aniversários, gráficos e atividade.
- Tarefas: tipos, prioridade, prazo, responsável e vínculos com contato/negócio.
- Conteúdo e tráfego: espaços próprios, calendário editorial, publicação e diagnósticos.
- Integrações: Meta OAuth, WhatsApp oficial/pessoal, webhooks, API pública e MCP.

## Plano progressivo

1. UX Core: central de atenção, agenda de hoje, busca global e criação rápida.
2. Comunicação: filtros operacionais do inbox, falhas e notificações agrupadas.
3. Produtividade: tarefa rápida no contato/conversa, snooze e visão Kanban.
4. Inteligência: health score explicável e próxima melhor ação.
5. Personalização: sidebar recolhível, filtros salvos e colunas configuráveis.

Cada fase deve manter dados reais, RLS, acessibilidade, testes e build verde.
