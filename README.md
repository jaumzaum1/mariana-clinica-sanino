# Mariana - Clínica Sanino

Fundação técnica do backend da Mariana, secretária médica por WhatsApp da Clínica Sanino.

Esta etapa cria uma base modular, testável e extensível em TypeScript. O webhook da Z-API já persiste entrada no Supabase, batches prontos podem gerar respostas da Mariana, o envio por Z-API é protegido por fila explícita e o Google Calendar pode calcular disponibilidade/criar eventos.

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

Para Google Calendar com service account:

```bash
GOOGLE_CALENDAR_ID=seu_calendar_id
GOOGLE_SERVICE_ACCOUNT_KEY_FILE=secrets/google-service-account.json
```

Não commite o arquivo de credenciais. A pasta `secrets/` e arquivos `*service-account*.json` ficam ignorados pelo git.

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

Para buscar slots reais do Calendar:

```bash
curl -X POST http://localhost:3000/internal/scheduling/available-slots \
  -H "Content-Type: application/json" \
  -d '{"text":"quero terça-feira à tarde","phone":"5561996531507"}'
```

Para criar um evento teste no Calendar em `development`/`test`:

```bash
curl -X POST http://localhost:3000/internal/scheduling/test-create-event \
  -H "Content-Type: application/json" \
  -d '{
    "phone":"5561996531507",
    "name":"João Maldonado",
    "cpf":"12345678900",
    "birthDate":"14/05/1990",
    "start":"2026-05-20T15:00:00-03:00",
    "end":"2026-05-20T16:30:00-03:00"
  }'
```

Para testar idempotência, rode o mesmo `curl` duas vezes. A segunda chamada deve retornar o mesmo `appointmentId`/`eventId` quando já existir appointment `scheduled` para o mesmo paciente, início e fim.

No Supabase, verifique:

- `appointments.patient_id` preenchido
- `appointments.calendar_event_id` preenchido
- `appointments.status = scheduled`
- `audit_logs.event` com `scheduling_test_create_event_requested`, `patient_resolved_for_appointment`, `calendar_event_create_attempt`, `calendar_event_created`, `appointment_saved`, `scheduling_test_create_event_completed`

Para leitura operacional no fuso da Clínica Sanino:

```sql
select id, phone, starts_at_br, ends_at_br, created_at_br
from appointments_br
order by created_at desc;

select event, phone, created_at_br, metadata
from audit_logs_br
order by created_at desc;
```

No Google Calendar, confira:

- título `Consulta - <nome> - Dr. João Maldonado`
- descrição com paciente, telefone, CPF, data de nascimento, origem, tipo e status
- location `Clínica Sanino - Rua dos Bancários, 529 - Jardim Maria Izabel, Marília - SP`
- extended properties privadas com `source`, `createdBySystem`, `phone`, `cpf`, `patientName`, `patientId`, `appointmentType` e `status`

Para testar uma conversa que agenda, envie uma mensagem com pedido de consulta, processe o batch e veja no Supabase:

- `appointments.calendar_event_id`
- `appointments.status = scheduled`
- `messages.direction = outbound`
- `audit_logs.event = scheduling_evaluated`

## Rotas

- `GET /health` retorna `{ "ok": true }`
- `POST /webhooks/zapi` normaliza telefone, salva paciente/mensagem, atualiza debounce e registra audit logs
- `POST /internal/commands` permite testar comandos internos determinísticos
- `POST /internal/batches/process-ready` processa batches prontos em `development`/`test`
- `POST /internal/outbound/queue-latest-draft` marca apenas a última draft de um telefone como `pending`
- `POST /internal/outbound/send-pending` processa somente mensagens `send_status=pending`
- `POST /internal/scheduling/available-slots` calcula slots disponíveis no Google Calendar
- `POST /internal/scheduling/test-create-event` cria evento teste no Google Calendar em ambiente local

## Integrações

As integrações externas estão modeladas como adapters/services. OpenAI pode ser chamada para rascunho estruturado. Google Calendar usa service account. Envio via WhatsApp permanece desligado por padrão e só roda com `SEND_WHATSAPP_ENABLED=true`.

- `OpenAIService`
- `ZapiService`
- `CalendarService`
- `PatientMemoryService`
- `SchedulingService`
- `LoggingService`

## Próxima etapa sugerida

Validar o fluxo completo de escolha de horário pelo paciente, revisar prompts com casos reais e só depois liberar envio real da Z-API com feature flag explícita.
