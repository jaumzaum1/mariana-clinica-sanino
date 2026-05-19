# Mariana - Clínica Sanino

Fundação técnica do backend da Mariana, secretária médica por WhatsApp da Clínica Sanino.

Esta etapa cria uma base modular, testável e extensível em TypeScript, sem chamadas reais para OpenAI, Z-API, Google Calendar ou Supabase.

## Stack

- Node.js
- TypeScript
- Fastify
- Zod
- Vitest
- dotenv
- pino
- Supabase/Postgres preparado via client e migration SQL

## Comandos

```bash
npm install
npm run dev
npm test
```

## Rotas

- `GET /health` retorna `{ "ok": true }`
- `POST /webhooks/zapi` recebe payload genérico da Z-API, valida minimamente e registra log
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

Implementar webhook real da Z-API com debounce, persistência de mensagens no Supabase e testes de integração controlados com mocks.
