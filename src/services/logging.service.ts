import type { FastifyBaseLogger } from "fastify";

export interface AuditLogInput {
  event: string;
  phone?: string;
  metadata?: unknown;
}

export class LoggingService {
  constructor(private readonly logger?: FastifyBaseLogger) {}

  info(input: AuditLogInput): void {
    this.logger?.info(input, input.event);
  }

  warn(input: AuditLogInput): void {
    this.logger?.warn(input, input.event);
  }

  error(input: AuditLogInput): void {
    this.logger?.error(input, input.event);
  }
}
