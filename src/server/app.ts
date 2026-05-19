import Fastify, { type FastifyInstance } from "fastify";
import { env } from "../config/env.js";
import { commandsRoutes } from "../routes/commands.routes.js";
import { healthRoutes } from "../routes/health.routes.js";
import { whatsappRoutes } from "../routes/whatsapp.routes.js";

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger:
      env.NODE_ENV === "test"
        ? false
        : {
            level: env.LOG_LEVEL
          }
  });

  app.register(healthRoutes);
  app.register(whatsappRoutes);
  app.register(commandsRoutes);

  return app;
}
