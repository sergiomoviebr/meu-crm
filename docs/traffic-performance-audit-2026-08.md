# Auditoria — Central de Performance e Inteligência de Tráfego

Data: 19/08/2026

## Fundação encontrada

- Contas Meta, Google e manuais vinculadas ao contato usado como cliente.
- Hierarquia conta → campanha → conjunto → anúncio/criativo.
- Tabela diária normalizada com investimento, impressões, alcance, cliques, leads, conversões, receita e visitas.
- Métricas derivadas calculadas em leitura, evitando CPL/CPA/ROAS desatualizados.
- Importação manual e CSV, adaptadores de sync e cron protegido por segredo.
- Diagnóstico assistido por IA, recomendações auditáveis, aprovação, plano de otimização e timeline.
- Sinais determinísticos para tendência, funil, landing page e fadiga criativa.
- RLS e permissões por conta/agente.

## Lacunas prioritárias encontradas

- A página inicial somava todas as contas em uma janela fixa de sete dias.
- Não havia filtro por cliente, plataforma e período nem comparação equivalente.
- A visão executiva não distinguia indicador confiável de ausência de dados.
- Não havia modo Cliente, Gestor ou Apresentação.
- Análise do gestor e próximos passos não eram persistidos por período.
- O funil comercial existente é um snapshot de negócios e ainda não possui atribuição UTM/ad id suficiente para declarar ROI real por campanha.
- O cron existe, mas depende de configuração externa; não há garantia de atualização automática apenas por existir no código.

## Decisões desta fase

- Somar somente métricas de nível `ad_account` no resumo para não duplicar campanha/conjunto/anúncio.
- Comparar janelas de mesma duração imediatamente anteriores.
- Ocultar métricas cuja base é zero ou não confiável.
- Não inventar vendas, CAC, ROI ou qualidade de lead sem atribuição comprovada.
- Saúde é derivada das recomendações abertas já explicáveis, não de score arbitrário.
- A apresentação usa os mesmos dados reais da tela, com navegação e controles ocultos por CSS de impressão.

## Próximas fases

1. Atribuição UTM/campaign/ad entre lead, conversa e negócio.
2. Metas configuráveis por cliente e fórmula de saúde versionada.
3. Funil marketing × comercial, tempo de resposta e leads sem atendimento.
4. Ranking e drill-down de campanhas/criativos no dashboard executivo.
5. Exportação PNG e PDF renderizada no servidor.
6. Portal seguro do cliente e aprovação externa de recomendações.

