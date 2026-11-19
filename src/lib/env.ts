import "server-only";
import { z } from "zod";

const schema = z.object({
  NEWS_DB_HOST: z.string().default("localhost"),
  NEWS_DB_PORT: z.coerce.number().int().default(3306),
  NEWS_DB_USER: z.string().min(1, "NEWS_DB_USER is required"),
  NEWS_DB_PASSWORD: z.string().min(1, "NEWS_DB_PASSWORD is required"),
  NEWS_DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default("race_news"),
  APP_DB_NAME: z.string().regex(/^[A-Za-z0-9_]+$/).default("magazine_generator"),
  SESSION_SECRET: z.string().min(32, "SESSION_SECRET must be at least 32 characters"),
  S3_PUBLIC_BASE_URL: z.string().url().default("https://raceautonextjs-backup.s3.ap-south-1.amazonaws.com/"),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  DATA_DIR: z.string().default("./data"),
});

export type Env = z.infer<typeof schema>;

let cached: Env | undefined;

/** Validated environment. Throws a readable error naming what is missing. */
export function env(): Env {
  if (cached) return cached;
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Configuration error. Check .env.local or .env (see .env.example). ${problems}`);
  }
  cached = parsed.data;
  return cached;
}
