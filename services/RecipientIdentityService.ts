import AsyncStorage from '@/services/SessionStorage';
import { createSerialQueue } from '@/utils/asyncLock';
import { extractIdentityHints, normalizeRecipient, recipientSimilarity, selectRecipientProfile } from '@/utils/phase2Intelligence';
import type { DraftTransaction } from '@/services/DraftTransactionService';
import type { Transaction } from '@/types/database';
import { generateUUID } from '@/utils/uuid';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';

const STORAGE_KEY = 'recipient_identity_profiles';
const mutate = createSerialQueue();

export interface RecipientProfile {
  id: string;
  displayName: string;
  aliases: string[];
  verifiedHints: string[];
  kind?: 'PERSON' | 'ORGANIZATION';
  groups?: string[];
  phone?: string;
  email?: string;
  linkedUid?: string;
  linkedDisplayName?: string;
  linkCheckedAt?: number;
  notes?: string;
  archivedAt?: number;
  createdAt: number;
  updatedAt: number;
}

export interface SavePersonInput {
  displayName: string;
  kind?: RecipientProfile['kind'];
  groups?: string[];
  phone?: string;
  email?: string;
  notes?: string;
  aliases?: string[];
  verifiedHints?: string[];
  linkedUid?: string;
  linkedDisplayName?: string;
  linkCheckedAt?: number;
}

export const DEFAULT_PERSON_GROUPS = ['Employee', 'Family', 'Friend', 'Customer', 'Supplier'] as const;

export interface RecipientMergeSuggestion {
  id: string;
  left: string;
  right: string;
  confidence: number;
  reason: string;
  hints: string[];
}

const unique = (values: string[]) => [...new Set(values.map(value => String(value || '').trim()).filter(Boolean))];
const cleanOptional = (value?: string) => value?.trim() || undefined;
export const normalizePersonEmail = (value?: string) => cleanOptional(value)?.toLocaleLowerCase();
export const normalizePersonPhone = (value?: string) => {
  const phone = cleanOptional(value)?.replace(/[\s\-().]/g, '');
  if (!phone) return undefined;
  if (/^\+251[79]\d{8}$/.test(phone)) return phone;
  if (/^251[79]\d{8}$/.test(phone)) return `+${phone}`;
  if (/^0[79]\d{8}$/.test(phone)) return `+251${phone.slice(1)}`;
  if (/^[79]\d{8}$/.test(phone)) return `+251${phone}`;
  return phone;
};
const validEmail = (value?: string) => !value || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPhone = (value?: string) => !value || /^\+[1-9]\d{7,14}$/.test(value);
const assertContact = (profile: Pick<RecipientProfile, 'phone' | 'email'>) => {
  if (!profile.phone && !profile.email) throw new Error('Enter a phone number or email address');
  if (!validPhone(profile.phone)) throw new Error('Enter a valid phone number, including the country code');
  if (!validEmail(profile.email)) throw new Error('Enter a valid email address');
};
const assertUniqueContact = (profiles: RecipientProfile[], candidate: RecipientProfile, excludedId?: string) => {
  const duplicate = profiles.find(profile => profile.id !== excludedId && (
    (!!candidate.phone && normalizePersonPhone(profile.phone) === candidate.phone)
    || (!!candidate.email && normalizePersonEmail(profile.email) === candidate.email)
  ));
  if (duplicate) throw new Error(`This phone or email already belongs to ${duplicate.displayName}`);
};
const normalizeProfile = (value: RecipientProfile): RecipientProfile => ({
  ...value,
  displayName: String(value.displayName || '').trim(),
  aliases: unique([value.displayName, ...(Array.isArray(value.aliases) ? value.aliases : [])]),
  verifiedHints: unique(Array.isArray(value.verifiedHints) ? value.verifiedHints : []),
  kind: value.kind === 'ORGANIZATION' ? 'ORGANIZATION' : 'PERSON',
  groups: unique(Array.isArray(value.groups) ? value.groups : []),
  phone: normalizePersonPhone(value.phone),
  email: normalizePersonEmail(value.email),
  notes: cleanOptional(value.notes),
  linkedUid: cleanOptional(value.linkedUid),
  linkedDisplayName: cleanOptional(value.linkedDisplayName),
  createdAt: Number.isFinite(value.createdAt) ? value.createdAt : Date.now(),
  updatedAt: Number.isFinite(value.updatedAt) ? value.updatedAt : Date.now(),
});

export class RecipientIdentityService {
  static async getAll(): Promise<RecipientProfile[]> {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed)
        ? parsed.filter(item => item?.id && item?.displayName).map(normalizeProfile)
        : [];
    } catch { return []; }
  }

  static async saveAll(profiles: RecipientProfile[]): Promise<void> {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(profiles.map(normalizeProfile)));
    LocalChangeEmitter.emit();
  }

  static async create(input: SavePersonInput): Promise<RecipientProfile> {
    return mutate(async () => {
      const displayName = input.displayName.trim();
      if (!displayName) throw new Error('Enter a name');
      const profiles = await this.getAll();
      const normalizedName = normalizeRecipient(displayName);
      if (!normalizedName) throw new Error('Enter a valid name');
      const now = Date.now();
      const profile = normalizeProfile({
        id: generateUUID(), displayName,
        aliases: unique([displayName, ...(input.aliases || [])]),
        verifiedHints: unique(input.verifiedHints || []),
        kind: input.kind || 'PERSON', groups: input.groups || [],
        phone: input.phone, email: input.email, notes: input.notes,
        linkedUid: input.linkedUid, linkedDisplayName: input.linkedDisplayName, linkCheckedAt: input.linkCheckedAt,
        createdAt: now, updatedAt: now,
      });
      assertContact(profile);
      assertUniqueContact(profiles, profile);
      await this.saveAll([...profiles, profile]);
      return profile;
    });
  }

  static async update(profileId: string, updates: Partial<SavePersonInput> & { archivedAt?: number }): Promise<RecipientProfile> {
    return mutate(async () => {
      const profiles = await this.getAll();
      const index = profiles.findIndex(profile => profile.id === profileId);
      if (index < 0) throw new Error('Person not found');
      const current = profiles[index];
      const displayName = updates.displayName?.trim() || current.displayName;
      const nextPhone = updates.phone === undefined ? current.phone : normalizePersonPhone(updates.phone);
      const nextEmail = updates.email === undefined ? current.email : normalizePersonEmail(updates.email);
      const contactChanged = nextPhone !== current.phone || nextEmail !== current.email;
      const next = normalizeProfile({
        ...current, ...updates, displayName, phone: nextPhone, email: nextEmail,
        linkedUid: contactChanged ? undefined : updates.linkedUid ?? current.linkedUid,
        linkedDisplayName: contactChanged ? undefined : updates.linkedDisplayName ?? current.linkedDisplayName,
        linkCheckedAt: contactChanged ? undefined : updates.linkCheckedAt ?? current.linkCheckedAt,
        aliases: unique([displayName, ...(updates.aliases ?? current.aliases)]),
        verifiedHints: unique(updates.verifiedHints ?? current.verifiedHints),
        groups: unique(updates.groups ?? current.groups ?? []),
        updatedAt: Date.now(),
      });
      assertContact(next);
      assertUniqueContact(profiles, next, profileId);
      profiles[index] = next;
      await this.saveAll(profiles);
      return next;
    });
  }

  static async confirmMerge(displayName: string, aliases: string[], verifiedHints: string[] = []): Promise<RecipientProfile> {
    return mutate(async () => {
      const profiles = await this.getAll();
      const normalizedAliases = unique([displayName, ...aliases]);
      const matchingIds = new Set(profiles.filter(profile => {
        const aliasMatches = profile.aliases.some(alias => normalizedAliases.some(value => {
          const left = normalizeRecipient(value), right = normalizeRecipient(alias);
          return !!left && left === right;
        }));
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
        kind: merged[0]?.kind || 'PERSON',
        groups: unique(merged.flatMap(item => item.groups || [])),
        phone: merged.find(item => item.phone)?.phone,
        email: merged.find(item => item.email)?.email,
        notes: merged.find(item => item.notes)?.notes,
        createdAt: merged.reduce((earliest, item) => Math.min(earliest, item.createdAt), now),
        updatedAt: now,
      };
      const normalized = normalizeProfile(profile);
      assertContact(normalized);
      assertUniqueContact(profiles.filter(item => !matchingIds.has(item.id)), normalized);
      await this.saveAll([...profiles.filter(item => !matchingIds.has(item.id)), normalized]);
      return normalized;
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
      await this.saveAll(next);
    });
  }

  static async resolve(name?: string, rawEvidence = ''): Promise<RecipientProfile | undefined> {
    const profiles = await this.getAll();
    return selectRecipientProfile(profiles, name, rawEvidence);
  }

  static async refreshLinkedAccount(profileId: string): Promise<RecipientProfile> {
    const profile = (await this.getAll()).find(item => item.id === profileId);
    if (!profile) throw new Error('Person not found');
    assertContact(profile);
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const { getFirebaseApp } = await import('@/config/firebaseApp');
    const response = await httpsCallable(getFunctions(getFirebaseApp()), 'lookupLinkedUser')({ phone: profile.phone, email: profile.email });
    const linked = response.data as { uid?: string; displayName?: string } | null;
    return this.update(profileId, {
      linkedUid: linked?.uid,
      linkedDisplayName: linked?.displayName,
      linkCheckedAt: Date.now(),
    });
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

  static unifiedHistory<T extends Transaction>(profile: RecipientProfile, transactions: T[], profiles: RecipientProfile[] = [profile]): T[] {
    const aliases = new Set(profile.aliases.map(normalizeRecipient));
    const ambiguousAliases = new Set<string>();
    const owners = new Map<string, Set<string>>();
    for (const candidate of profiles.filter(item => !item.archivedAt)) for (const alias of candidate.aliases) {
      const normalized = normalizeRecipient(alias);
      if (!normalized) continue;
      const ids = owners.get(normalized) || new Set<string>();
      ids.add(candidate.id); owners.set(normalized, ids);
      if (ids.size > 1) ambiguousAliases.add(normalized);
    }
    return transactions.filter(transaction => transaction.person_id === profile.id
      || (!transaction.person_id && aliases.has(normalizeRecipient(transaction.sender_receiver)) && !ambiguousAliases.has(normalizeRecipient(transaction.sender_receiver))));
  }

  static learnedDefaults(profile: RecipientProfile, transactions: Transaction[], profiles: RecipientProfile[] = [profile]): { category?: string; tags: string[] } {
    const history = this.unifiedHistory(profile, transactions, profiles);
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
