import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import { env } from "../env";

let client: Anthropic | undefined;

/** True when an Anthropic API key is configured. Every AI step is optional and checks this first. */
export function claudeAvailable(): boolean {
  return Boolean(env().ANTHROPIC_API_KEY);
}

function getClient(): Anthropic {
  const apiKey = env().ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set.");
  client ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 120_000 });
  return client;
}

export type ClaudeImage = { mediaType: "image/jpeg" | "image/png"; base64: string };

/**
 * One request that must come back as JSON matching `schema`.
 * Throws a readable error on refusal, truncation or an API failure.
 */
export async function askClaude<T extends z.ZodType>(options: {
  model: string;
  schema: T;
  system: string;
  prompt: string;
  images?: ClaudeImage[];
  effort?: "low" | "medium" | "high";
  maxTokens?: number;
}): Promise<z.infer<T>> {
  const content: Anthropic.ContentBlockParam[] = [
    ...(options.images ?? []).map(
      (image): Anthropic.ImageBlockParam => ({
        type: "image",
        source: { type: "base64", media_type: image.mediaType, data: image.base64 },
      }),
    ),
    { type: "text", text: options.prompt },
  ];

  let response;
  try {
    response = await getClient().messages.parse({
      model: options.model,
      max_tokens: options.maxTokens ?? 8000,
      system: options.system,
      messages: [{ role: "user", content }],
      output_config: { effort: options.effort ?? "low", format: zodOutputFormat(options.schema) },
    });
  } catch (error) {
    if (error instanceof Anthropic.AuthenticationError) throw new Error("Claude rejected the API key.");
    if (error instanceof Anthropic.RateLimitError) throw new Error("Claude is rate limiting requests; try again shortly.");
    if (error instanceof Anthropic.APIError) throw new Error(`Claude API error ${error.status ?? ""}: ${error.message}`);
    throw error;
  }

  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off.");
  if (response.parsed_output === null) throw new Error("Claude's answer did not match the expected format.");
  return response.parsed_output as z.infer<T>;
}

/** Runs `work` over `items` with at most `limit` in flight. */
export async function mapLimited<I, O>(items: I[], limit: number, work: (item: I) => Promise<O>): Promise<O[]> {
  const results = new Array<O>(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        results[index] = await work(items[index]);
      }
    }),
  );
  return results;
}
