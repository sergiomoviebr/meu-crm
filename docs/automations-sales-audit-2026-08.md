# Auditoria de Automações — qualificação comercial

Data: 19/08/2026

## O que já existia

- Motor persistente com gatilhos de mensagem, primeiro inbound, palavra-chave, resposta interativa, contato, atribuição, tag e tempo.
- Etapas de mensagem, botões, lista, template, tags, atribuição, atualização de contato, negócio, espera, condição, webhook e encerramento.
- Esperas retomáveis por fila, ramificações e logs por etapa.
- Isolamento por conta nas leituras e operações do motor.
- Provedor de IA e contexto de conversa disponíveis para evoluções posteriores.

## Lacunas encontradas

- O qualificador antigo dependia de palavras-chave e enviava mensagens automaticamente.
- Não havia taxonomia comercial consistente, confiança, pontuação, temperatura, dor ou próxima melhor ação.
- Não havia uma sugestão persistente para o atendente revisar, editar ou ignorar.
- O teste do fluxo exigia execução real; não havia simulador sem efeitos colaterais.
- A regra operacional “a empresa envia o primeiro Oi; só analisar após o lead responder” não estava representada por um fluxo comercial próprio.

## Implementado nesta fase

- Novo passo `sales_qualify`, restrito a `mode: suggestion`.
- Template “Qualificação Comercial Inteligente”, disparado em `first_inbound_message`.
- Classificação semântica inicial em intenções comerciais, com confiança, sinais detectados, variação de score, temperatura, dor, próxima ação e indicação de intervenção humana.
- Atualização estruturada do contato e persistência da sugestão para futura caixa de aprovação.
- Simulador no menu de Automações, sem envio e sem alteração de contatos.
- Log de execução informa intenção, transição de score e recomendação de atendimento humano.
- Políticas RLS e escopo por conta para sugestões e dados comerciais.

## Limites intencionais

- Nenhuma resposta é enviada automaticamente pelo qualificador.
- A classificação desta primeira fase é determinística e auditável. O provedor de IA poderá enriquecer contexto e linguagem depois, sempre com fallback seguro.
- O template reage somente à primeira mensagem recebida do contato. Follow-ups recorrentes, agenda e nutrição devem ser adicionados em fases separadas para evitar disparos indevidos.

## Próximas fases recomendadas

1. Caixa de sugestões dentro da conversa, com aceitar, editar, ignorar e feedback do atendente.
2. Contexto ampliado com histórico, dados do contato, negócio e consentimento; fallback determinístico quando a IA estiver indisponível.
3. Follow-ups configuráveis por intenção, horário comercial e limite de tentativas, sempre cancelados quando o lead responde.
4. Agendamento com disponibilidade real e confirmação humana.
5. Dashboard de conversão por intenção, temperatura, sugestão aceita e reunião marcada.
6. Versionamento de fluxo, publicação separada de rascunho e rollback.

