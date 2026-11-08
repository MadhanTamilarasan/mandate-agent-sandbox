import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { wrapLanguageModel, type LanguageModel } from "ai";
import { env } from "./env";

/**
 * Gemini's free tier allows only ~5 requests/minute PER MODEL, and one agent run
 * makes several calls. Quotas are per model, so on Gemini we build a failover
 * pool: when a model is rate-limited or unresponsive, the same request is
 * transparently retried on the next model. Override with LLM_MODELS=a,b,c.
 */
const GEMINI_POOL = [
  "gemini-3.5-flash",
  "gemini-3.6-flash",
  "gemini-3.5-flash-lite",
  "gemini-3.1-flash-lite",
  "gemini-flash-lite-latest",
];

const DEFAULT_ANTHROPIC = "claude-haiku-5-5";

const cooldown = new Map<string, number>(); // modelId -> epoch ms when usable again

function retryDelayMs(e: any): number {
  const m = /"retryDelay":\s*"(\d+)s"/.exec(String(e?.responseBody ?? ""));
  return m ? Number(m[1]) * 1000 + 1000 : 60_000;
}

function isFailoverError(e: unknown): boolean {
  const s = `${(e as any)?.statusCode ?? ""} ${(e as any)?.name ?? ""} ${(e as any)?.message ?? ""}`.toLowerCase();
  return /429|500|503|rate|quota|overloaded|unavailable|resource_exhausted|timeout|aborted|not_found|no longer available/.test(s);
}

function geminiPool(): string[] {
  const custom = (process.env.LLM_MODELS ?? env.llmModel)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return custom.length ? custom : GEMINI_POOL;
}

function failoverModel(): LanguageModel {
  const google = createGoogleGenerativeAI({ apiKey: env.geminiKey });
  const ids = geminiPool();
  const models = ids.map((id) => ({ id, model: google(id) as any }));

  return wrapLanguageModel({
    model: models[0].model,
    middleware: {
      wrapGenerate: async ({ params }: { params: any }) => {
        let last: unknown;
        const now = Date.now();
        const usable = models.filter((m) => (cooldown.get(m.id) ?? 0) <= now);
        const order = usable.length ? usable : [...models].sort((a, b) => (cooldown.get(a.id) ?? 0) - (cooldown.get(b.id) ?? 0)).slice(0, 1);
        for (const m of order) {
          try {
            // Per-attempt timeout so one stuck model cannot stall the whole request.
            const signal = params.abortSignal
              ? AbortSignal.any([params.abortSignal, AbortSignal.timeout(25_000)])
              : AbortSignal.timeout(25_000);
            return await m.model.doGenerate({ ...params, abortSignal: signal });
          } catch (e) {
            last = e;
            if (!isFailoverError(e)) throw e;
            cooldown.set(m.id, Date.now() + retryDelayMs(e));
          }
        }
        throw last;
      },
    } as any,
  }) as unknown as LanguageModel;
}

export function getModel(): LanguageModel {
  if (env.llmProvider === "anthropic") {
    return createAnthropic({ apiKey: env.anthropicKey })(env.llmModel || DEFAULT_ANTHROPIC) as unknown as LanguageModel;
  }
  return failoverModel();
}

export function modelLabel(): string {
  if (env.llmProvider === "anthropic") return `anthropic/${env.llmModel || DEFAULT_ANTHROPIC}`;
  return `gemini (${geminiPool().length}-model failover)`;
}

/** Never let a model call hang the app: pass as `abortSignal`. */
export const timeoutSignal = (ms: number) => AbortSignal.timeout(ms);

function isRetryable(e: unknown): boolean {
  const s = `${(e as any)?.statusCode ?? ""} ${(e as any)?.name ?? ""} ${(e as any)?.message ?? ""}`.toLowerCase();
  return /429|503|rate|quota|overloaded|unavailable|resource_exhausted|timeout|aborted/.test(s);
}

/** One extra attempt after a pause for transient errors (failover already happened inside the model). */
export async function withRetry<T>(fn: () => Promise<T>, tries = 2): Promise<T> {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isRetryable(e) || i === tries - 1) break;
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
  throw last;
}

export function friendlyLlmError(e: unknown): string {
  if (isRetryable(e)) {
    return "The free AI models are rate-limited right now (Gemini free tier is ~5 requests/min per model). Wait about 30 seconds and try again.";
  }
  const msg = (e as any)?.message ?? String(e);
  return `AI call failed: ${String(msg).slice(0, 300)}`;
}
