import type { FastifyInstance } from "fastify";
import { CommandParserAgent } from "../agents/command-parser.agent.js";
import { InternalCommandInputSchema } from "../schemas/command.schema.js";
import { LoggingService } from "../services/logging.service.js";

export async function commandsRoutes(app: FastifyInstance): Promise<void> {
  const commandParser = new CommandParserAgent();
  const loggingService = new LoggingService(app.log);

  app.post("/internal/commands", async (request, reply) => {
    const parsed = InternalCommandInputSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid internal command payload"
      });
    }

    try {
      const command = commandParser.parse(parsed.data.text, parsed.data.requestedBy);

      loggingService.info({
        event: "internal.command.received",
        phone: command.phone,
        metadata: command
      });

      return {
        ok: true,
        command
      };
    } catch (error) {
      return reply.status(400).send({
        ok: false,
        error: error instanceof Error ? error.message : "Invalid internal command"
      });
    }
  });
}
