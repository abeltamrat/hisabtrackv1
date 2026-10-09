/**
 * Shared client for the Top Tools AI chat-completions endpoint
 * (https://top-tools-ai.com/docs), used by both the financial assistant
 * (text) and receipt OCR (text + image). One place to keep the request
 * shape, timeout, and documented error codes (401/403/429/502) in sync.
 */

export type TopToolsContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface TopToolsMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | TopToolsContentPart[];
}

export const TOP_TOOLS_BASE_URL = 'https://top-tools-ai.com/api/v1';
// The only model usable without the user opting into a paid plan: a daily
// free allowance, versus every other listed model which needs its own
// subscription. Vision-capable, per the model table on top-tools-ai.com.
export const TOP_TOOLS_DEFAULT_MODEL = 'Top-Tools-Ai';

async function describeError(response: Response): Promise<string> {
  let detail = '';
  try {
    const body = await response.json();
    detail = body?.error?.message || body?.message || '';
  } catch {
    // Body wasn't JSON (or was empty) — fall back to the status alone.
  }
  const suffix = detail ? `: ${detail}` : '';
  switch (response.status) {
    case 401: return `Top Tools AI: invalid or missing API key${suffix}`;
    case 403: return `Top Tools AI: no active access to this model${suffix}. Check your plan on the Top Tools AI dashboard.`;
    case 429: return `Top Tools AI: rate limit exceeded${suffix}. Try again shortly.`;
    case 502: return `Top Tools AI: the model provider is temporarily unavailable${suffix}.`;
    default: return `Top Tools AI request failed (${response.status})${suffix}`;
  }
}

export async function topToolsChatCompletion(
  apiKey: string,
  messages: TopToolsMessage[],
  options?: { model?: string; timeoutMs?: number; retryOn502?: boolean }
): Promise<string> {
  const model = options?.model || TOP_TOOLS_DEFAULT_MODEL;
  const timeoutMs = options?.timeoutMs ?? 60000;

  const attempt = async (): Promise<Response> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(`${TOP_TOOLS_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({ model, messages, stream: false }),
      });
    } finally {
      clearTimeout(timer);
    }
  };

  let response = await attempt();
  // The docs call out 502 (provider_unavailable / provider_empty_response) as
  // an expected transient failure under load — one quiet retry clears most.
  if (!response.ok && response.status === 502 && options?.retryOn502 !== false) {
    response = await attempt();
  }
  if (!response.ok) throw new Error(await describeError(response));

  const payload = await response.json();
  const content = payload?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('Top Tools AI returned an empty response.');
  return content.trim();
}
