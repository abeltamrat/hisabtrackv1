import { topToolsChatCompletion } from '@/services/TopToolsAIClient';

export interface CompletionKeys { topToolsApiKey?: string; groqApiKey?: string; geminiApiKey?: string }

/**
 * One plain completion across the configured providers, in the app's usual
 * order (Top Tools AI, Groq, Gemini). For background features that need a
 * single structured answer rather than a conversation.
 */
export async function completeText(prompt: string, keys: CompletionKeys): Promise<{ text: string; provider: 'toptools' | 'groq' | 'gemini' }> {
  const errors: string[] = [];

  if (keys.topToolsApiKey?.trim()) {
    try { return { text: await topToolsChatCompletion(keys.topToolsApiKey.trim(), [{ role: 'user', content: prompt }]), provider: 'toptools' }; }
    catch (error) { errors.push(`Top Tools AI: ${(error as Error).message}`); }
  }

  if (keys.groqApiKey?.trim()) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${keys.groqApiKey.trim()}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'openai/gpt-oss-20b', temperature: 0.1, messages: [{ role: 'user', content: prompt }] }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = (await response.json())?.choices?.[0]?.message?.content;
      if (typeof text !== 'string' || !text.trim()) throw new Error('empty response');
      return { text: text.trim(), provider: 'groq' };
    } catch (error) { errors.push(`Groq: ${(error as Error).message}`); }
  }

  if (keys.geminiApiKey?.trim()) {
    try {
      const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': keys.geminiApiKey.trim() },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.1, maxOutputTokens: 4096 } }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const parts = (await response.json())?.candidates?.[0]?.content?.parts ?? [];
      const text = parts.filter((p: any) => !p.thought && typeof p.text === 'string').map((p: any) => p.text).join('').trim();
      if (!text) throw new Error('empty response');
      return { text, provider: 'gemini' };
    } catch (error) { errors.push(`Gemini: ${(error as Error).message}`); }
  }

  throw new Error(errors.join(' | ') || 'No AI provider configured.');
}

/** Pulls the first JSON array/object out of a model reply (tolerates ```json fences and prose). */
export function extractJson<T = unknown>(text: string): T | undefined {
  const cleaned = text.replace(/```(?:json)?/gi, '');
  const start = cleaned.search(/[[{]/);
  if (start < 0) return undefined;
  const open = cleaned[start], close = open === '[' ? ']' : '}';
  const end = cleaned.lastIndexOf(close);
  if (end <= start) return undefined;
  try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { return undefined; }
}
