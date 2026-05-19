import {
  InternalCommandSchema,
  type InternalCommand,
  type InternalCommandType
} from "../schemas/command.schema.js";
import { normalizeBrazilPhone } from "../utils/phone.js";

const COMMANDS: InternalCommandType[] = ["ASSUMIR", "LIBERAR", "RESUMO", "OBS"];

export class CommandParserAgent {
  parse(text: string, requestedBy = "internal-test"): InternalCommand {
    const trimmed = text.trim();
    const [rawCommand = "", ...rest] = trimmed.split(/\s+/);
    const command = rawCommand.toUpperCase() as InternalCommandType;

    if (!COMMANDS.includes(command)) {
      throw new Error(`Comando interno nao reconhecido: ${rawCommand}`);
    }

    const body = rest.join(" ");
    const phoneMatch = body.match(/(?:\+?\d[\d\s().-]{7,}\d)/);
    const phone = phoneMatch ? normalizeBrazilPhone(phoneMatch[0]) : undefined;
    const note =
      command === "OBS"
        ? body.replace(phoneMatch?.[0] ?? "", "").replace(/^[:\s-]+/, "").trim() || undefined
        : body || undefined;

    return InternalCommandSchema.parse({
      type: command,
      phone,
      note,
      requestedBy
    });
  }
}
