# Mariana - Clínica Sanino

Fundação técnica do backend da Mariana, secretária médica por WhatsApp da Clínica Sanino.

Esta etapa cria uma base modular, testável e extensível em TypeScript. O webhook da Z-API já persiste entrada no Supabase; OpenAI, envio via Z-API e Google Calendar ainda não são chamados.

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

## Teste local do webhook

Com `.env` preenchido com `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY`, aplique a migration `src/db/migrations/002_message_batches.sql` no Supabase e rode:

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

## Rotas

- `GET /health` retorna `{ "ok": true }`
- `POST /webhooks/zapi` normaliza telefone, salva paciente/mensagem, atualiza debounce e registra audit logs
- `POST /internal/commands` permite testar comandos internos determinísticos

## Integrações

As integrações externas estão modeladas como adapters/services, mas retornam dados mockados nesta fundação:

- `OpenAIService`
- `ZapiService`
- `CalendarService`
- `PatientMemoryService`
- `SchedulingService`
- `LoggingService`

## Próxima etapa sugerida

Processar batches prontos com a Mariana, ainda com mocks controlados antes de ligar a OpenAI Responses API.
