import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

export async function loadPrompt(relativePromptPath: string): Promise<string> {
  const promptUrl = new URL(`../${relativePromptPath}`, import.meta.url);
  return readFile(fileURLToPath(promptUrl), "utf8");
}
