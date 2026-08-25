# Auditoria estrutural do módulo de Mensagens — agosto de 2026

## Integrações encontradas

- **Meta WhatsApp Cloud API oficial:** webhook assinado, templates oficiais,
  mídia, mensagens interativas, reply, reações e status de entrega.
- **WhatsApp pessoal via Baileys:** conexão persistente por QR, múltiplas
  sessões, ingestão contínua e sincronização de histórico suportado pelo
  protocolo. É um canal separado e não deve herdar a janela de atendimento
  da Cloud API.

Não foi encontrado um BSP adicional. A Cloud API oficial não oferece uma API
genérica para importar todo o histórico anterior à conexão; portanto, não é
correto fabricar ou prometer esse histórico. A importação real existente é
usada somente no canal pessoal, que fornece eventos de history sync.

## Estabilidade e dados já implementados

- HMAC `x-hub-signature-256` validado antes do processamento do webhook.
- ACK rápido e processamento garantido via `after()`, evitando perda em
  runtimes serverless.
- Deduplicação no banco por `(conversation_id, message_id)` e upsert
  idempotente na importação de histórico.
- Normalização de telefone, corrida de criação protegida por índices únicos e
  resolução de contato/conversa centralizada.
- Nome prioriza cadastro e aproveita o nome fornecido pelo WhatsApp quando o
  contato ainda não possui identificação melhor.
- Criação automática de contato e integração do novo lead foram preservadas.
- Status separados: pending, queued, sending, sent, delivered, read, replied,
  failed e cancelled; eventos e tentativas possuem tabelas de observabilidade.
- Retry controlado possui jobs próprios e cron, sem marcar HTTP aceito como
  entrega.
- Realtime já atualiza lista, thread, reações e presença sem polling agressivo.
- Histórico pessoal é ordenado pelo timestamp real e inserido em lotes de 200.
- Áudio, imagem, vídeo, documento, localização, reply, reações, templates,
  respostas rápidas, IA, notas, pins, atribuição e painel do contato já existem.

## Problemas encontrados

### P0/P1

- A janela de 24 horas era calculada no componente e bloqueava texto, mídia e
  ações para qualquer canal. Isso aplicava uma regra da Cloud API também ao
  WhatsApp pessoal.
- A interface usava “expirado”, fazendo uma regra de envio parecer perda da
  conversa, embora histórico e demais ações continuassem disponíveis.
- Os filtros confundiam estado administrativo (`open/pending/closed`) com
  estado operacional; não havia “aguardando minha resposta” nem “aguardando
  cliente”, apesar dos campos derivados já existirem no banco.
- Texto em edição era perdido ao trocar de conversa.

### P2

- Não havia busca local dentro da conversa.
- A thread ainda carrega todo o histórico de uma vez; deve migrar para cursor
  sem quebrar realtime nem posicionamento do scroll.
- Faltam snooze, favoritos, agendamento e multiseleção.
- Falhas podem ser inspecionadas e retentadas na bolha, mas ainda não formam
  uma fila dedicada na lista.
- Notas internas existem no painel, porém @menções ainda não existem.

### P3 / futuro condicionado ao provider

- Indicador “digitando” não pode ser simulado; a Cloud API atual não fornece
  um evento genérico confiável para isso.
- Transcrição de áudio precisa de provider, consentimento/custo e política de
  retenção antes de ser habilitada.

## Pacote executado nesta fase

1. Política visual de 24h agora é exclusiva da Cloud API.
2. Conversa nunca é tratada como vencida; a UI oferece “Continuar conversa”
   e abre somente templates aprovados quando a Meta exige reabertura.
3. WhatsApp pessoal permanece com compositor normal.
4. Filtros operacionais “Aguardando minha resposta” e “Aguardando cliente”.
5. Fila aguardando resposta ordenada pelo maior tempo de espera.
6. Rascunho automático local por conversa.
7. Pesquisa textual dentro da conversa, sem nova estrutura paralela.

## Próximas fases recomendadas

1. Cursor para mensagens e conversas, preservando posição do scroll.
2. Fila de falhas e busca global de mensagens com endpoint paginado.
3. Snooze e lembrete/follow-up direto no cabeçalho da conversa.
4. Métricas/SLA por responsável e painel de saúde da integração.
5. Transcrição e detecção de compromissos, condicionadas à configuração de IA.
