# Entrega e observabilidade de mensagens

## Significado dos status

- `pending` / `queued`: a mensagem ainda não foi enviada ao provedor.
- `sending`: a tentativa foi registrada antes da chamada externa.
- `sent`: o provedor aceitou a mensagem. Isso **não** comprova entrega ao destinatário.
- `delivered`: o WhatsApp confirmou a entrega.
- `read`: o WhatsApp confirmou a leitura, quando o destinatário disponibiliza essa confirmação.
- `replied`: uma nova mensagem do cliente entrou depois daquela mensagem enviada.
- `failed` / `cancelled`: a tentativa terminou sem envio ou foi cancelada.

O WhatsApp pessoal recebe confirmações posteriores pelos eventos `messages.update` e
`message-receipt.update` do Baileys. O Meta Cloud API continua recebendo confirmações
pelo webhook oficial. Toda mudança de status gera um registro imutável em
`message_status_events`; cada chamada ao provedor é registrada em
`message_delivery_attempts`.

No WhatsApp pessoal, o JID remoto confirmado pelo próprio WhatsApp é armazenado na
conversa. Os envios seguintes reutilizam esse identificador e não dependem de uma nova
consulta de número ao provedor. Consultas e envios têm limite de 15 segundos; uma
conexão que não responde deixa de ficar presa indefinidamente e pode ser refeita em
Configurações com **Gerar novo QR**.

O status `replied` é atualizado por um trigger único no banco quando uma mensagem de
cliente é inserida. Assim, respostas recebidas pelo Meta ou pelo WhatsApp pessoal têm o
mesmo comportamento.

## Retentativas

Falhas conhecidas antes da aceitação do provedor, como uma conexão pessoal
temporariamente indisponível, podem entrar em `message_retry_jobs`. A fila é limitada a
três tentativas e não repete erros permanentes, como número inexistente no WhatsApp.

Configure `MESSAGE_CRON_SECRET` apenas no backend e agende uma chamada autenticada:

```text
GET /api/whatsapp/messages/retry-cron
x-cron-secret: <MESSAGE_CRON_SECRET>
```

Uma execução por minuto ou a cada dois minutos é suficiente. A rota reivindica cada
job de forma atômica, processa no máximo 25 itens e impede que uma retentativa crie
outra cadeia de retentativas.

## Diagnóstico

Na Caixa de entrada, clique no ícone de status de uma mensagem enviada. O painel mostra
o status compreensível, horários, provedor, ID externo, número de tentativas, histórico
e motivo da falha. Mensagens com falha permitem uma nova tentativa manual.

Nunca registrar no histórico tokens, credenciais, conteúdo integral de respostas do
provedor ou segredos de cron. O campo técnico `provider_response` existe para uma futura
tela administrativa restrita e não é retornado pela API usada na Caixa de entrada.
