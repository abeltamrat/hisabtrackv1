import type { Transaction } from '@/types/database';
import type { DraftTransaction } from './DraftTransactionService';
import Storage from './SessionStorage';
import { completeText, extractJson, type CompletionKeys } from './AICompletion';

/**
 * Fills in category and a clean merchant name on pending SMS drafts that the
 * rule-based pipeline could only guess at. Cheapest source first:
 *  1. the user's learned SMS rules (already applied at draft creation — those
 *     drafts are skipped here),
 *  2. how this user categorized the same counterparty before (local, free),
 *  3. one batched AI call for whatever is left.
 * A draft the user has already touched is never overwritten.
 */

export interface CategoryOption { name: string; type: string }
export interface DraftSuggestion { id: string; category?: string; merchant?: string }
interface MemoryEntry { at: number; source: 'history' | 'ai' | 'none'; category?: string; merchant?: string }

const MEMORY_KEY = 'draft_ai_enrichment';
const BATCH = 20;
const MAX_PER_RUN = 40;
// Only the counterparty-naming templates; "Paid via CBE" names the bank, not the merchant.
const AUTO_DESCRIPTION = /^(Transfer to|Received from|Paid to)\s+/i;

const norm = (value?: string) => (value || '').toLowerCase().replace(/[^a-z0-9ሀ-፿]+/g, ' ').trim();
const mask = (sms: string) => sms.replace(/\d{5,}/g, '•••').replace(/\s+/g, ' ').slice(0, 220);

/** Counterparty → the category this user picks for it most (≥2 times, ≥60% of the time). */
export function learnCounterpartyCategories(transactions: Transaction[]): Map<string, string> {
  const counts = new Map<string, Map<string, number>>();
  for (const tx of transactions) {
    const who = norm(tx.sender_receiver);
    if (!who || tx.type === 'TRANSFER' || tx.splits?.length) continue;
    const byCategory = counts.get(who) ?? new Map<string, number>();
    byCategory.set(tx.category, (byCategory.get(tx.category) || 0) + 1);
    counts.set(who, byCategory);
  }
  const learned = new Map<string, string>();
  for (const [who, byCategory] of counts) {
    const total = [...byCategory.values()].reduce((a, b) => a + b, 0);
    const [category, n] = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0];
    if (n >= 2 && n / total >= 0.6) learned.set(who, category);
  }
  return learned;
}

export function buildPrompt(drafts: DraftTransaction[], categories: CategoryOption[], learned: Map<string, string>): string {
  const names = (type: string) => categories.filter(c => c.type.toUpperCase() === type).map(c => c.name).join(', ');
  const examples = [...learned.entries()].slice(0, 40).map(([who, category]) => `- ${who} → ${category}`).join('\n');
  const items = drafts.map(d => ({ id: d.id, type: d.type, amount: d.amount, counterparty: d.sender_receiver || null, description: d.description, sms: mask(d.raw_sms || '') }));
  return [
    'You categorize bank and mobile-money SMS transactions for an Ethiopian personal finance app.',
    `EXPENSE categories: ${names('EXPENSE') || 'none'}`,
    `INCOME categories: ${names('INCOME') || 'none'}`,
    examples ? `How this user categorized past counterparties:\n${examples}` : '',
    'For each transaction choose exactly one category name from the list for its type, and a short clean merchant or person name (title case, no account numbers, phone numbers or codes).',
    'If you are not reasonably sure, use null rather than guessing.',
    `Transactions: ${JSON.stringify(items)}`,
    'Reply with ONLY a JSON array: [{"id":"...","category":"..." or null,"merchant":"..." or null}]',
  ].filter(Boolean).join('\n');
}

export function parseSuggestions(text: string, drafts: DraftTransaction[], categories: CategoryOption[]): DraftSuggestion[] {
  const raw = extractJson<any[]>(text);
  if (!Array.isArray(raw)) return [];
  const byId = new Map(drafts.map(d => [d.id, d]));
  const out: DraftSuggestion[] = [];
  for (const item of raw) {
    const draft = byId.get(String(item?.id));
    if (!draft) continue;
    const match = typeof item.category === 'string'
      ? categories.find(c => c.type.toUpperCase() === draft.type && c.name.toLowerCase() === item.category.trim().toLowerCase())
      : undefined;
    const merchant = typeof item.merchant === 'string' ? item.merchant.trim() : '';
    const cleanMerchant = merchant.length >= 2 && merchant.length <= 40 && !/\d{4,}/.test(merchant) ? merchant : undefined;
    out.push({ id: draft.id, category: match?.name, merchant: cleanMerchant });
  }
  return out;
}

/** The draft fields to change for a suggestion, or null when nothing would change. */
export function patchFor(draft: DraftTransaction, suggestion: DraftSuggestion): Partial<DraftTransaction> | null {
  const patch: Partial<DraftTransaction> = {};
  if (suggestion.category && suggestion.category !== draft.category) patch.category = suggestion.category;
  if (suggestion.merchant && AUTO_DESCRIPTION.test(draft.description)) {
    const description = draft.description.replace(/^(\S+\s+\S+)\s+.*$/, `$1 ${suggestion.merchant}`);
    if (description !== draft.description) patch.description = description;
  }
  return Object.keys(patch).length ? patch : null;
}

export class DraftEnrichmentService {
  private static running: Promise<number> | null = null;

  /** Enriches pending drafts; returns how many were updated. Safe to call often. */
  static enrichPending(): Promise<number> {
    if (!this.running) this.running = this.run().finally(() => { this.running = null; });
    return this.running;
  }

  private static async run(): Promise<number> {
    const { loadStoredAppSettings } = await import('@/contexts/AppSettingsContext');
    const settings = await loadStoredAppSettings();
    const keys: CompletionKeys = { topToolsApiKey: settings.topToolsApiKey, groqApiKey: settings.groqApiKey, geminiApiKey: settings.geminiApiKey };
    const aiAllowed = settings.aiSharingEnabled && !!(keys.topToolsApiKey || keys.groqApiKey || keys.geminiApiKey);

    const { DraftTransactionService } = await import('./DraftTransactionService');
    const { SMSLearningService } = await import('./SMSLearningService');
    const { getDatabase } = await import('./database');
    const { StorageService } = await import('@/utils/storage');

    const memory: Record<string, MemoryEntry> = JSON.parse((await Storage.getItem(MEMORY_KEY)) || '{}');
    const drafts = await DraftTransactionService.getAll();
    const pending = drafts.filter(d => d.status === 'PENDING' && !d.is_transfer && !d.paired_draft_id && !d.is_loan_disbursement && !d.suggested_splits?.length && !memory[d.id]);
    if (!pending.length) return 0;

    const transactions = await (await getDatabase()).getTransactions();
    const learned = learnCounterpartyCategories(transactions);
    const categories: CategoryOption[] = (await StorageService.loadCategories()).map(c => ({ name: c.name, type: String(c.type) }));

    const suggestions: DraftSuggestion[] = [];
    const forAI: DraftTransaction[] = [];
    for (const draft of pending) {
      // A learned rule already reflects an explicit user correction.
      const rule = await SMSLearningService.getRule({ accountId: draft.account_id, sender: draft.sms_sender || '', rawMerchant: (draft as { person_alias_used?: string }).person_alias_used || draft.sender_receiver || '', referenceNumber: draft.reference_number }).catch(() => null);
      if (rule) { memory[draft.id] = { at: Date.now(), source: 'none' }; continue; }
      const fromHistory = learned.get(norm(draft.sender_receiver));
      if (fromHistory && categories.some(c => c.name === fromHistory && c.type.toUpperCase() === draft.type)) {
        suggestions.push({ id: draft.id, category: fromHistory });
        memory[draft.id] = { at: Date.now(), source: 'history', category: fromHistory };
      } else if (aiAllowed && forAI.length < MAX_PER_RUN) {
        forAI.push(draft);
      }
    }

    for (let i = 0; i < forAI.length; i += BATCH) {
      const batch = forAI.slice(i, i + BATCH);
      try {
        const { text } = await completeText(buildPrompt(batch, categories, learned), keys);
        const parsed = parseSuggestions(text, batch, categories);
        for (const draft of batch) {
          const s = parsed.find(p => p.id === draft.id);
          if (s) suggestions.push(s);
          memory[draft.id] = { at: Date.now(), source: s ? 'ai' : 'none', category: s?.category, merchant: s?.merchant };
        }
      } catch (error) {
        // Network/provider failure: leave unmarked so the next run retries.
        console.warn('Draft enrichment AI batch failed:', error);
      }
    }

    // Re-read just before writing: never overwrite something the user changed meanwhile.
    const original = new Map(pending.map(d => [d.id, d]));
    const fresh = new Map((await DraftTransactionService.getAll()).map(d => [d.id, d]));
    const patches: Array<{ id: string; patch: Partial<DraftTransaction> }> = [];
    for (const s of suggestions) {
      const before = original.get(s.id), now = fresh.get(s.id);
      if (!before || !now || now.status !== 'PENDING' || now.category !== before.category || now.description !== before.description) continue;
      const patch = patchFor(now, s);
      if (patch) patches.push({ id: s.id, patch });
    }
    if (patches.length) await DraftTransactionService.updateMany(patches);

    const live = new Set(fresh.keys());
    for (const id of Object.keys(memory)) if (!live.has(id)) delete memory[id];
    await Storage.setItem(MEMORY_KEY, JSON.stringify(memory));
    return patches.length;
  }
}

export default DraftEnrichmentService;
