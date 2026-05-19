import "dotenv/config";
import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.string().default("info"),
  DEBOUNCE_WINDOW_MS: z.coerce.number().int().positive().default(5_000),
  BATCH_WORKER_INTERVAL_MS: z.coerce.number().int().positive().default(2_000),
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  ZAPI_INSTANCE_ID: z.string().optional(),
  ZAPI_TOKEN: z.string().optional(),
  ZAPI_CLIENT_TOKEN: z.string().optional(),
  GOOGLE_CALENDAR_ID: z.string().optional(),
  GOOGLE_CLIENT_EMAIL: z.string().email().optional(),
  GOOGLE_PRIVATE_KEY: z.string().optional()
});

export const env = EnvSchema.parse(process.env);
export type Env = typeof env;
