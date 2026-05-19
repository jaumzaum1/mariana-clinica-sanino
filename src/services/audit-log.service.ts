import type { FastifyBaseLogger } from "fastify";
import type { AuditLogsRepository, CreateAuditLogInput } from "../repositories/types.js";

export class AuditLogService {
  constructor(
    private readonly auditLogsRepository: AuditLogsRepository,
    private readonly logger?: FastifyBaseLogger
  ) {}

  async create(input: CreateAuditLogInput): Promise<void> {
    this.logger?.info(input, input.event);
    await this.auditLogsRepository.create(input);
  }
}
