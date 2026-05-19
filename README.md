# Mariana - Clínica Sanino

Fundação técnica do backend da Mariana, secretária médica por WhatsApp da Clínica Sanino.

Esta etapa cria uma base modular, testável e extensível em TypeScript. O webhook da Z-API já persiste entrada no Supabase, batches prontos podem gerar respostas da Mariana e o envio por Z-API é protegido por fila explícita. Google Calendar ainda não é chamado.

## Stack

- Node.js
- TypeScript
- Fastify
- Zod
- Vitest
- dotenv
- pino
- Supabase/Postgres via client e migrations SQL

## Comandos

```bash
npm install
npm run dev
npm test
```

## Teste Local

Com `.env` preenchido com `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OPENAI_API_KEY`, `OPENAI_MODEL_PARSER`, `OPENAI_MODEL_MARIANA` e `SEND_WHATSAPP_ENABLED=false`, aplique as migrations em `src/db/migrations/` no Supabase.

Para manter envio desligado:

```bash
SEND_WHATSAPP_ENABLED=false
WHATSAPP_MODE=test
WHATSAPP_TEST_PHONE=556196531507
```

Para teste controlado de envio, configure explicitamente:

```bash
SEND_WHATSAPP_ENABLED=true
WHATSAPP_MODE=test
WHATSAPP_TEST_PHONE=556196531507
ZAPI_BASE_URL=https://api.z-api.io
ZAPI_INSTANCE_ID=...
ZAPI_TOKEN=...
ZAPI_CLIENT_TOKEN=...
```

Com `WHATSAPP_MODE=test`, o sistema nunca envia para o telefone real do paciente. Produção só deve ser ativada manualmente com `WHATSAPP_MODE=production`.

Suba o backend:

```bash
npm run dev
```

Envie uma mensagem de entrada:

```bash
curl -X POST http://localhost:3000/webhooks/zapi \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+55 (61) 99653-1507",
    "senderName": "Maria",
    "messageId": "zapi-local-1",
    "text": { "message": "Olá, quero marcar uma consulta" }
  }'
```

Após a janela de debounce, processe manualmente os batches prontos:

```bash
curl -X POST http://localhost:3000/internal/batches/process-ready \
  -H "Content-Type: application/json"
```

Para ver o rascunho no Supabase, abra a tabela `messages` e filtre:

- `phone = 5561996531507`
- `direction = outbound`

O campo `send_status` controla a fila:

- `draft`: resposta gerada, não elegível para envio automático
- `pending`: única condição elegível para `/internal/outbound/send-pending`
- `sending`: envio em andamento
- `sent`: enviada
- `send_failed`: falhou e não será reenviada automaticamente
- `skipped`: pulada intencionalmente

Para enfileirar uma única draft, use a última draft daquele telefone:

```bash
curl -X POST http://localhost:3000/internal/outbound/queue-latest-draft \
  -H "Content-Type: application/json" \
  -d '{"phone":"5561996531507"}'
```

Para processar no máximo uma mensagem pendente:

```bash
curl -X POST http://localhost:3000/internal/outbound/send-pending \
  -H "Content-Type: application/json" \
  -d '{"limit":1}'
```

No Supabase, verifique `messages`:

- `send_status = draft` para rascunhos não enfileirados
- `send_status = pending` para itens explicitamente enfileirados
- `send_status = sent`, `sent_at` e `provider_message_id` quando envio controlado funcionar
- `send_status = send_failed` e `send_error` se a Z-API falhar

Se `SEND_WHATSAPP_ENABLED=false`, `/internal/outbound/send-pending` não chama a Z-API e não transforma drafts antigas em pending.

## Rotas

- `GET /health` retorna `{ "ok": true }`
- `POST /webhooks/zapi` normaliza telefone, salva paciente/mensagem, atualiza debounce e registra audit logs
- `POST /internal/commands` permite testar comandos internos determinísticos
- `POST /internal/batches/process-ready` processa batches prontos em `development`/`test`
- `POST /internal/outbound/queue-latest-draft` marca apenas a última draft de um telefone como `pending`
- `POST /internal/outbound/send-pending` processa somente mensagens `send_status=pending`

## Integrações

As integrações externas estão modeladas como adapters/services. OpenAI pode ser chamada para rascunho estruturado. Envio via WhatsApp permanece desligado por padrão e só roda com `SEND_WHATSAPP_ENABLED=true`.

- `OpenAIService`
- `ZapiService`
- `CalendarService`
- `PatientMemoryService`
- `SchedulingService`
- `LoggingService`

## Próxima etapa sugerida

Revisar rascunhos no Supabase, estabilizar critérios de pausa/handoff e só depois ligar envio real da Z-API com feature flag explícita.
