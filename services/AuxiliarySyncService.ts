import Storage from '@/services/SessionStorage';
import { CommunityGroupService } from '@/services/CommunityGroupService';
import { DraftTransactionService } from '@/services/DraftTransactionService';
import { RecurringTransactionService } from '@/services/RecurringTransactionService';
import { SMSLearningService } from '@/services/SMSLearningService';
import RecipientIdentityService from '@/services/RecipientIdentityService';
import { getDatabase } from '@/services/database';
import { digestStringAsync, CryptoDigestAlgorithm } from 'expo-crypto';
import { doc, getDoc, getFirestore, runTransaction } from 'firebase/firestore';

export const AUXILIARY_DATASETS = ['communityGroups', 'recurringItems', 'goals', 'drafts', 'smsLearning', 'recipientProfiles'] as const;
export type AuxiliaryDataset = typeof AUXILIARY_DATASETS[number];
type State = Record<string, { localHash: string; remoteRevision: number }>;
type ReportRow = { dataset: AuxiliaryDataset; direction: 'PUSHED'|'RESTORED'|'UNCHANGED'; count: number; hash: string };

const count = (value: any) => Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;
const empty = (value: any) => count(value) === 0;
const validate = (name: AuxiliaryDataset, value: any) => {
  if (name === 'smsLearning') {
    if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error('Invalid SMS learning backup');
  } else if (!Array.isArray(value)) throw new Error(`Invalid ${name} backup`);
  if (count(value) > 100000) throw new Error(`${name} backup is too large`);
  if (Array.isArray(value)) {
    const ids = new Set<string>();
    for (const item of value) {
      if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error(`Invalid ${name} record`);
      ids.add(item.id);
      if (name === 'communityGroups') CommunityGroupService.validate(item);
    }
  }
  const json = JSON.stringify(value);
  if (json.length > 750000) throw new Error(`${name} exceeds the safe cloud document size; export a file backup`);
  return json;
};
const hash = (json: string) => digestStringAsync(CryptoDigestAlgorithm.SHA256, json);

async function readLocal(name: AuxiliaryDataset): Promise<any> {
  if (name === 'communityGroups') return CommunityGroupService.getAll();
  if (name === 'recurringItems') return RecurringTransactionService.getAll();
  if (name === 'drafts') return DraftTransactionService.getAll();
  if (name === 'smsLearning') return SMSLearningService.getAllRules();
  if (name === 'recipientProfiles') return RecipientIdentityService.getAll();
  const raw = await Storage.getItem('financial_goals'); return raw ? JSON.parse(raw) : [];
}
async function writeLocal(name: AuxiliaryDataset, value: any) {
  validate(name, value);
  if (name === 'communityGroups') return CommunityGroupService.replaceAll(value);
  if (name === 'drafts') return DraftTransactionService.replaceAll(value);
  if (name === 'smsLearning') return SMSLearningService.saveAllRules(value);
  if (name === 'recipientProfiles') return RecipientIdentityService.saveAll(value);
  if (name === 'recurringItems') return Storage.setItem('@hisabtrack_recurring_transactions', JSON.stringify(value));
  return Storage.setItem('financial_goals', JSON.stringify(value));
}

export default class AuxiliarySyncService {
  static async getLocalCounts() {
    const values = await Promise.all(AUXILIARY_DATASETS.map(dataset => readLocal(dataset)));
    return Object.fromEntries(AUXILIARY_DATASETS.map((dataset, index) => [dataset, count(values[index])])) as Record<AuxiliaryDataset, number>;
  }

  static async sync(uid: string) {
    const db = await getDatabase();
    const state: State = await db.readMeta('aux_sync_state') || {};
    const conflicts: any[] = await db.readMeta('aux_sync_conflicts') || [];
    const report: ReportRow[] = [];
    for (const dataset of AUXILIARY_DATASETS) {
      const local = await readLocal(dataset), localJson = validate(dataset, local), localHash = await hash(localJson);
      const ref = doc(getFirestore(), `users/${uid}/app_data/${dataset}`), snapshot = await getDoc(ref), remote = snapshot.data();
      const remoteRevision = Number(remote?.revision || 0), known = state[dataset];
      const remoteValue = remote?.payload;
      const remoteHash = typeof remote?.hash === 'string' ? remote.hash : remoteValue === undefined ? '' : await hash(validate(dataset, remoteValue));
      const localChanged = !!known && known.localHash !== localHash;
      const remoteChanged = !!known && known.remoteRevision !== remoteRevision;
      if (known && localChanged && remoteChanged && localHash !== remoteHash) {
        conflicts.push({ dataset, localHash, remoteHash, localCount: count(local), cloudCount: count(remoteValue), at: Date.now() });
        await db.writeMeta('aux_sync_conflicts', conflicts.slice(-100));
        throw new Error(`Cloud conflict in ${dataset}. Local data is preserved.`);
      }
      if (remoteValue !== undefined && ((!known && empty(local)) || remoteChanged)) {
        validate(dataset, remoteValue); await writeLocal(dataset, remoteValue);
        state[dataset] = { localHash: remoteHash, remoteRevision };
        report.push({ dataset, direction: 'RESTORED', count: count(remoteValue), hash: remoteHash });
      } else if (!snapshot.exists() || localChanged || (!known && !empty(local))) {
        let revision = remoteRevision;
        await runTransaction(getFirestore(), async tx => {
          const current = await tx.get(ref), currentRevision = Number(current.data()?.revision || 0);
          if (known && currentRevision !== remoteRevision) throw new Error(`Cloud conflict in ${dataset}. Local data is preserved.`);
          revision = currentRevision + 1;
          tx.set(ref, { payload: JSON.parse(localJson), hash: localHash, count: count(local), revision, updatedAt: Date.now() });
        });
        state[dataset] = { localHash, remoteRevision: revision };
        report.push({ dataset, direction: 'PUSHED', count: count(local), hash: localHash });
      } else {
        state[dataset] = { localHash, remoteRevision };
        report.push({ dataset, direction: 'UNCHANGED', count: count(local), hash: localHash });
      }
    }
    const completedAt = Date.now();
    await db.writeMeta('aux_sync_state', state);
    await db.writeMeta('last_restore_report', { completedAt, rows: report });
    return { completedAt, rows: report };
  }
}
