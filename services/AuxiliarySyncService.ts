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
type DatasetState = { localHash: string; remoteRevision: number; recordHashes?: Record<string, string> };
type State = Record<string, DatasetState>;
type ReportRow = { dataset: AuxiliaryDataset; direction: 'PUSHED'|'RESTORED'|'MERGED'|'UNCHANGED'; count: number; hash: string };

const count = (value: any) => Array.isArray(value) ? value.length : value && typeof value === 'object' ? Object.keys(value).length : 0;
const empty = (value: any) => count(value) === 0;
const emptyDataset = (dataset: AuxiliaryDataset) => dataset === 'smsLearning' ? {} : [];
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
const recordTime = (value: any) => Number(
  value?.updatedAt ?? value?.updated_at ?? value?.confirmation?.recorded_at
  ?? value?.createdAt ?? value?.created_at ?? value?.date ?? 0,
) || 0;
const recordEntries = (dataset: AuxiliaryDataset, value: any): Array<[string, any]> => dataset === 'smsLearning'
  ? Object.entries(value || {})
  : (Array.isArray(value) ? value.map(item => [String(item.id), item] as [string, any]) : []);
const fromRecordEntries = (dataset: AuxiliaryDataset, entries: Array<[string, any]>) => dataset === 'smsLearning'
  ? Object.fromEntries(entries)
  : entries.map(([, value]) => value);
const recordHashes = async (dataset: AuxiliaryDataset, value: any) => Object.fromEntries(await Promise.all(
  recordEntries(dataset, value).map(async ([id, item]) => [id, await hash(JSON.stringify(item))]),
));

/**
 * Reconcile two devices at record level. The previous per-record hashes are the
 * common base, so a deletion on one device is kept when the other device did
 * not edit that record. A concurrent edit wins over a deletion to avoid losing
 * financial history. Concurrent edits use their persisted update time and a
 * hash tie-breaker so every device converges on the same value.
 */
async function mergeConcurrentRecords(dataset: AuxiliaryDataset, local: any, remote: any, base: Record<string, string> = {}) {
  const localEntries = new Map(recordEntries(dataset, local));
  const remoteEntries = new Map(recordEntries(dataset, remote));
  const localHashes = await recordHashes(dataset, local);
  const remoteHashes = await recordHashes(dataset, remote);
  const ids = [...new Set([...Object.keys(base), ...localEntries.keys(), ...remoteEntries.keys()])].sort();
  const merged: Array<[string, any]> = [];
  for (const id of ids) {
    const localValue = localEntries.get(id), remoteValue = remoteEntries.get(id), baseHash = base[id];
    const localDeleted = !!baseHash && localValue === undefined;
    const remoteDeleted = !!baseHash && remoteValue === undefined;
    if (localValue === undefined && remoteValue === undefined) continue;
    if (localDeleted && remoteHashes[id] === baseHash) continue;
    if (remoteDeleted && localHashes[id] === baseHash) continue;
    if (localValue === undefined) { merged.push([id, remoteValue]); continue; }
    if (remoteValue === undefined) { merged.push([id, localValue]); continue; }
    if (localHashes[id] === remoteHashes[id]) { merged.push([id, localValue]); continue; }
    const localTime = recordTime(localValue), remoteTime = recordTime(remoteValue);
    if (localTime !== remoteTime) merged.push([id, localTime > remoteTime ? localValue : remoteValue]);
    else merged.push([id, localHashes[id] > remoteHashes[id] ? localValue : remoteValue]);
  }
  return fromRecordEntries(dataset, merged);
}

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
        let mergedValue: any = local, mergedRevision = remoteRevision;
        await runTransaction(getFirestore(), async tx => {
          const current = await tx.get(ref), currentRevision = Number(current.data()?.revision || 0);
          const currentValue = current.data()?.payload ?? emptyDataset(dataset);
          validate(dataset, currentValue);
          mergedValue = await mergeConcurrentRecords(dataset, local, currentValue, known.recordHashes || {});
          const mergedJson = validate(dataset, mergedValue), mergedHash = await hash(mergedJson);
          mergedRevision = currentRevision + 1;
          tx.set(ref, { payload: JSON.parse(mergedJson), hash: mergedHash, count: count(mergedValue), revision: mergedRevision, updatedAt: Date.now() });
        });
        const mergedJson = validate(dataset, mergedValue), mergedHash = await hash(mergedJson);
        await writeLocal(dataset, mergedValue);
        conflicts.push({ dataset, localHash, remoteHash, resolvedHash: mergedHash, localCount: count(local), cloudCount: count(remoteValue), mergedCount: count(mergedValue), resolution: 'RECORD_MERGE', at: Date.now() });
        state[dataset] = { localHash: mergedHash, remoteRevision: mergedRevision, recordHashes: await recordHashes(dataset, mergedValue) };
        report.push({ dataset, direction: 'MERGED', count: count(mergedValue), hash: mergedHash });
      }
      else if (remoteValue !== undefined && ((!known && empty(local)) || remoteChanged)) {
        validate(dataset, remoteValue); await writeLocal(dataset, remoteValue);
        state[dataset] = { localHash: remoteHash, remoteRevision, recordHashes: await recordHashes(dataset, remoteValue) };
        report.push({ dataset, direction: 'RESTORED', count: count(remoteValue), hash: remoteHash });
      } else if (!snapshot.exists() || localChanged || (!known && !empty(local))) {
        let revision = remoteRevision, pushedValue = local, pushedJson = localJson, pushedHash = localHash, mergedDuringPush = false;
        await runTransaction(getFirestore(), async tx => {
          const current = await tx.get(ref), currentRevision = Number(current.data()?.revision || 0);
          if (currentRevision !== remoteRevision) {
            const currentValue = current.data()?.payload ?? emptyDataset(dataset);
            validate(dataset, currentValue);
            pushedValue = await mergeConcurrentRecords(dataset, local, currentValue, known?.recordHashes || {});
            pushedJson = validate(dataset, pushedValue);
            pushedHash = await hash(pushedJson);
            mergedDuringPush = true;
          }
          revision = currentRevision + 1;
          tx.set(ref, { payload: JSON.parse(pushedJson), hash: pushedHash, count: count(pushedValue), revision, updatedAt: Date.now() });
        });
        if (mergedDuringPush) await writeLocal(dataset, pushedValue);
        state[dataset] = { localHash: pushedHash, remoteRevision: revision, recordHashes: await recordHashes(dataset, pushedValue) };
        report.push({ dataset, direction: mergedDuringPush ? 'MERGED' : 'PUSHED', count: count(pushedValue), hash: pushedHash });
      } else {
        state[dataset] = { localHash, remoteRevision, recordHashes: await recordHashes(dataset, local) };
        report.push({ dataset, direction: 'UNCHANGED', count: count(local), hash: localHash });
      }
      // Persist each successful dataset independently. If a later dataset fails,
      // the next retry must not treat completed work as another device conflict.
      await db.writeMeta('aux_sync_state', state);
    }
    const completedAt = Date.now();
    await db.writeMeta('aux_sync_conflicts', conflicts.slice(-100));
    await db.writeMeta('last_restore_report', { completedAt, rows: report });
    return { completedAt, rows: report };
  }
}
