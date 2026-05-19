import { z } from "zod";

export const EvaluationResultSchema = z.object({
  score: z.number().min(0).max(1),
  passed: z.boolean(),
  notes: z.string()
});

export type EvaluationResult = z.infer<typeof EvaluationResultSchema>;

export class EvaluatorAgent {
  async evaluate(): Promise<EvaluationResult> {
    return EvaluationResultSchema.parse({
      score: 1,
      passed: true,
      notes: "Avaliacao mockada para fundacao de testes."
    });
  }
}
