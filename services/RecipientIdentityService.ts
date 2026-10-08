import AsyncStorage from '@/services/SessionStorage';
import { createSerialQueue } from '@/utils/asyncLock';
import { extractIdentityHints, normalizeRecipient, recipientSimilarity, selectRecipientProfile } from '@/utils/phase2Intelligence';
import type { DraftTransaction } from '@/services/DraftTransactionService';
import type { Transaction } from '@/types/database';
import { generateUUID } from '@/utils/uuid';

const STORAGE_KEY = 'recipient_identity_profiles';
const mutate = createSerialQueue();

export interface RecipientProfile {
  id: string;
  displayName: string;
  aliases: string[];
  verifiedHints: string[];
  createdAt: number;
  updatedAt: number;
}

export interface RecipientMergeSuggestion {
  id: string;
  left: string;
  right: string;
  confidence: number;
  reason: string;
  hints: string[];
}

const unique = (values: string[]) => [...new Set(values.map(value => value.trim()).filter(Boolean))];

export class RecipientIdentityService {
  static async getAll(): Promise<RecipientProfile[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try { return JSON.parse(raw); } catch { return []; }
  }

  static async saveAll(profiles: RecipientProfile[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
  }

  static async confirmMerge(displayName: string, aliases: string[], verifiedHints: string[] = []): Promise<RecipientProfile> {
    return mutate(async () => {
      const profiles = await this.getAll();
      const normalizedAliases = unique([displayName, ...aliases]);
      const matchingIds = new Set(profiles.filter(profile => {
        const aliasMatches = profile.aliases.some(alias => normalizedAliases.some(value => normalizeRecipient(value) === normalizeRecipient(alias)));
        const hintsConflict = verifiedHints.length > 0 && profile.verifiedHints.length > 0 && !profile.verifiedHints.some(hint => verifiedHints.includes(hint));
        return aliasMatches && !hintsConflict;
      }).map(profile => profile.id));
      const merged = profiles.filter(profile => matchingIds.has(profile.id));
      const now = Date.now();
      const profile: RecipientProfile = {
        id: merged[0]?.id || generateUUID(),
        displayName: displayName.trim(),
        aliases: unique([...merged.flatMap(item => item.aliases), ...normalizedAliases]),
        verifiedHints: unique([...merged.flatMap(item => item.verifiedHints), ...verifiedHints]),
        createdAt: merged.reduce((earliest, item) => Math.min(earliest, item.createdAt), now),
        updatedAt: now,
      };
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...profiles.filter(item => !matchingIds.has(item.id)), profile]));
      return profile;
    });
  }

  static async unmerge(profileId: string, alias: string): Promise<void> {
    await mutate(async () => {
      const profiles = await this.getAll();
      const target = profiles.find(profile => profile.id === profileId);
      if (!target) return;
      const remaining = target.aliases.filter(value => normalizeRecipient(value) !== normalizeRecipient(alias));
      const next = profiles.filter(profile => profile.id !== profileId);
      if (remaining.length) next.push({ ...target, displayName: normalizeRecipient(target.displayName) === normalizeRecipient(alias) ? remaining[0] : target.displayName, aliases: remaining, updatedAt: Date.now() });
      if (target.aliases.length > 1) next.unshift({ id: generateUUID(), displayName: alias.trim(), aliases: [alias.trim()], verifiedHints: [], createdAt: Date.now(), updatedAt: Date.now() });
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    });
  }

  static async resolve(name?: string, rawEvidence = ''): Promise<RecipientProfile | undefined> {
    const profiles = await this.getAll();
    return selectRecipientProfile(profiles, name, rawEvidence);
  }

  static suggestMerges(drafts: DraftTransaction[], ownedAliases: string[] = []): RecipientMergeSuggestion[] {
    const excluded = new Set(ownedAliases.map(normalizeRecipient));
    const observations = new Map<string, DraftTransaction>();
    for (const draft of [...drafts].sort((a, b) => b.date - a.date)) {
      const name = normalizeRecipient(draft.sender_receiver);
      if (draft.status === 'REJECTED' || !name || excluded.has(name)) continue;
      const key = `${name}|${extractIdentityHints(draft.raw_sms).sort().join(',')}`;
      if (!observations.has(key)) observations.set(key, draft);
      if (observations.size >= 500) break;
    }
    const named = [...observations.values()];
    const suggestions = new Map<string, RecipientMergeSuggestion>();
    for (let i = 0; i < named.length; i++) for (let j = i + 1; j < named.length; j++) {
      const left = named[i], right = named[j];
      if (normalizeRecipient(left.sender_receiver) === normalizeRecipient(right.sender_receiver)) continue;
      const leftHints = extractIdentityHints(left.raw_sms), rightHints = extractIdentityHints(right.raw_sms);
      const shared = leftHints.filter(hint => rightHints.includes(hint));
      const similarity = recipientSimilarity(left.sender_receiver, right.sender_receiver);
      if (!shared.length && similarity < 0.67) continue;
      const names = [left.sender_receiver!, right.sender_receiver!].sort();
      const id = `recipient:${names.map(normalizeRecipient).join(':')}`;
      suggestions.set(id, { id, left: names[0], right: names[1], confidence: shared.length ? 100 : Math.round(similarity * 100), reason: shared.length ? `Both records show ${shared.join(', ')}.` : 'The names share strong token or initial evidence.', hints: shared });
    }
    return [...suggestions.values()].sort((a, b) => b.confidence - a.confidence);
  }

  static unifiedHistory(profile: RecipientProfile, transactions: Transaction[]): Transaction[] {
    const aliases = new Set(profile.aliases.map(normalizeRecipient));
    return transactions.filter(transaction => aliases.has(normalizeRecipient(transaction.sender_receiver)));
  }

  static learnedDefaults(profile: RecipientProfile, transactions: Transaction[]): { category?: string; tags: string[] } {
    const history = this.unifiedHistory(profile, transactions);
    const categoryCounts = new Map<string, number>();
    const tagCounts = new Map<string, number>();
    for (const transaction of history) {
      categoryCounts.set(transaction.category, (categoryCounts.get(transaction.category) || 0) + 1);
      for (const tag of transaction.tags || []) tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }
    return {
      category: [...categoryCounts].sort((a, b) => b[1] - a[1])[0]?.[0],
      tags: [...tagCounts].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([tag]) => tag),
    };
  }

  static async clearAll(): Promise<void> { await AsyncStorage.removeItem(STORAGE_KEY); }
}

export default RecipientIdentityService;
