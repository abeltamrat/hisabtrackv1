import Storage from './SessionStorage';
import type { TransactionSplit, TransactionType } from '@/types/database';
import { Platform } from 'react-native';

const KEY = 'smart_input_drafts';
const USED_KEY = 'smart_input_used_fingerprints';

export interface SmartInputDraft {
  id: string;
  source: 'QUICK_ADD' | 'RECEIPT';
  fingerprint: string;
  amount: number;
  accountId?: string;
  type: TransactionType;
  category?: string;
  recipient?: string;
  description?: string;
  date?: number;
  tags?: string[];
  splits?: TransactionSplit[];
  attachmentUri?: string;
  retainAttachment?: boolean;
  matchedTransactionId?: string;
  createdAt: number;
}

const read = async <T>(key: string, fallback: T): Promise<T> => {
  try { const raw = await Storage.getItem(key); return raw ? JSON.parse(raw) : fallback; } catch { return fallback; }
};

export class InputDraftService {
  static async save(input: Omit<SmartInputDraft, 'id' | 'createdAt'>): Promise<SmartInputDraft> {
    const drafts = await read<SmartInputDraft[]>(KEY, []);
    const existing = drafts.find(item => item.fingerprint === input.fingerprint);
    const draft = { ...input, id: existing?.id || `smart-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, createdAt: Date.now() };
    await Storage.setItem(KEY, JSON.stringify([draft, ...drafts.filter(item => item.id !== draft.id)].slice(0, 30)));
    return draft;
  }

  static async get(id: string): Promise<SmartInputDraft | undefined> { return (await read<SmartInputDraft[]>(KEY, [])).find(item => item.id === id); }
  static async isUsed(fingerprint: string) { return (await read<string[]>(USED_KEY, [])).includes(fingerprint); }
  static async markUsed(fingerprint: string) { const used = await read<string[]>(USED_KEY, []); await Storage.setItem(USED_KEY, JSON.stringify([fingerprint, ...used.filter(item => item !== fingerprint)].slice(0, 200))); }
  static async markUnused(fingerprint: string) { const used = await read<string[]>(USED_KEY, []); await Storage.setItem(USED_KEY, JSON.stringify(used.filter(item => item !== fingerprint))); }
  static async attachToTransaction(draft: SmartInputDraft, transactionId: string) {
    if (!draft.retainAttachment || !draft.attachmentUri) return;
    let retainedUri = draft.attachmentUri;
    if (Platform.OS === 'web') {
      const blob = await (await fetch(draft.attachmentUri)).blob();
      retainedUri = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(blob); });
    } else {
      const FileSystem = await import('expo-file-system/legacy');
      const directory = `${FileSystem.documentDirectory}receipt-attachments/`;
      await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
      const extension = draft.attachmentUri.match(/\.([a-zA-Z0-9]{2,5})(?:\?|$)/)?.[1] || 'jpg';
      retainedUri = `${directory}${transactionId.replace(/[^a-zA-Z0-9_-]/g, '_')}.${extension}`;
      await FileSystem.copyAsync({ from: draft.attachmentUri, to: retainedUri });
    }
    const links = await read<Record<string, { uri: string; sourceDraftId: string }>>('receipt_attachments', {});
    links[transactionId] = { uri: retainedUri, sourceDraftId: draft.id };
    await Storage.setItem('receipt_attachments', JSON.stringify(links));
  }
}
