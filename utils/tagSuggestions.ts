import type { Transaction } from '@/types/database';

export interface TagSuggestionContext {
  category?: string;
  recipient?: string;
  timestamp?: number;
}

const normalized = (value?: string) => (value || '').trim().toLowerCase();

/** Ranks only this user's supplied history and never applies a tag. */
export function rankTagSuggestions(
  transactions: Transaction[],
  context: TagSuggestionContext = {},
): string[] {
  const category = normalized(context.category);
  const recipient = normalized(context.recipient);
  const hour = new Date(context.timestamp ?? Date.now()).getHours();
  const scores = new Map<string, { label: string; score: number; count: number; latest: number; timeMatches: number }>();

  for (const transaction of transactions) {
    const candidates: Array<{ tag: string; category: string }> = [];
    for (const tag of transaction.tags || []) candidates.push({ tag, category: transaction.category });
    for (const split of transaction.splits || []) {
      for (const tag of split.tags || []) candidates.push({ tag, category: split.category });
    }
    // A transaction contributes at most once to each tag, even if the same tag
    // appears on the parent and more than one split.
    const bestPerTag = new Map<string, { label: string; categoryMatch: boolean }>();
    for (const candidate of candidates) {
      const key = normalized(candidate.tag);
      if (!key) continue;
      const match = !!category && normalized(candidate.category) === category;
      const current = bestPerTag.get(key);
      if (!current || match) bestPerTag.set(key, { label: candidate.tag.trim(), categoryMatch: match });
    }
    for (const [key, candidate] of bestPerTag) {
      const current = scores.get(key) || { label: candidate.label, score: 0, count: 0, latest: 0, timeMatches: 0 };
      current.count += 1;
      current.score += 1;
      if (candidate.categoryMatch) current.score += 8;
      if (recipient && normalized(transaction.sender_receiver) === recipient) current.score += 6;
      if (Math.abs(new Date(transaction.date).getHours() - hour) <= 2) current.timeMatches += 1;
      const ageDays = Math.max(0, (Date.now() - transaction.date) / 86400000);
      current.score += Math.max(0, 2 - ageDays / 90);
      current.latest = Math.max(current.latest, transaction.date);
      scores.set(key, current);
    }
  }

  return [...scores.entries()]
    .sort(([aKey, a], [bKey, b]) =>
      (b.score + (b.timeMatches >= 3 ? b.timeMatches : 0)) - (a.score + (a.timeMatches >= 3 ? a.timeMatches : 0)) ||
      b.count - a.count || b.latest - a.latest || aKey.localeCompare(bKey)
    )
    .map(([, value]) => value.label);
}
