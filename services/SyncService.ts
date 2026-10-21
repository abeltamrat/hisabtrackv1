import { getDatabase } from '@/services/database';
import type { Change, Row, Table } from '@/services/database/ledger';
import LocalChangeEmitter from './LocalChangeEmitter';
import NativeErrorReporter from './NativeErrorReporter';
import { store, AppDispatch } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { collection, doc, getDocs, getFirestore, onSnapshot, query, runTransaction, serverTimestamp, Timestamp, where } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const collections: Table[] = ['accounts', 'transactions', 'budgets', 'loans', 'meta'];
// Every cloud row, tombstones included, carries _syncedAt (the server commit
// time), so a routine sync only reads rows synced since the last pull. A full
// pull still runs on the first sync, on a manual "Sync now" and every few hours,
// as a safety net for rows a partial pull cannot see (e.g. very old clients
// that wrote no _syncedAt).
const FULL_PULL_INTERVAL_MS = 6 * 60 * 60 * 1000;
// Re-read a margin before the cursor; rows already known are skipped cheaply.
const PULL_OVERLAP_MS = 10 * 60 * 1000;
const syncedAtMillis = (value: any): number => typeof value?.toMillis === 'function' ? value.toMillis() : 0;
const stableValue = (value: any): any => Array.isArray(value)
  ? value.map(stableValue)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, stableValue(value[key])]))
    : value;
const sameAccountMetadata = (local: any, remote: any) => {
  if (!local || !remote || remote._deleted) return false;
  const { balance: _localBalance, ...localMetadata } = local;
  const {
    balance: _remoteBalance, _revision, _deleted, _operation, _syncedAt,
    ...remoteMetadata
  } = remote;
  return JSON.stringify(stableValue(localMetadata)) === JSON.stringify(stableValue(remoteMetadata));
};
export type CloudSyncState = 'pending' | 'syncing' | 'synced' | 'error';
export class SyncService {
  static currentUid: string | null = null;
  static applyingRemote = false;
  static isPushing = false;
  static lastPushFinishedAt = 0;
  static lastError: string | null = null;
  /**
   * Firestore unreachable (no internet, or the connection to Google is flaky or
   * blocked). That is "not synced yet", not a data problem: no error banner,
   * and auto-sync keeps retrying.
   */
  static isConnectivityError(error: unknown): boolean {
    const { code, message } = (error ?? {}) as { code?: string; message?: string };
    return code === 'unavailable' || code === 'deadline-exceeded'
      || /client is offline|could not reach cloud firestore|network ?error|failed to fetch|timed? ?out/i.test(message || '');
  }
  static disableAutoSyncUntil = 0;
  static consecutiveNativeErrors = 0;
  private static generation = 0;
  private static timer: ReturnType<typeof setTimeout> | null = null;
  private static unsubs: Array<() => void> = [];
  private static running: Promise<void> | null = null;
  private static rerun = false;
  private static forceFullPull = false;
  private static status: CloudSyncState = 'pending';
  private static statusListeners = new Set<(status: CloudSyncState) => void>();
  private static setStatus(status: CloudSyncState) {
    this.status = status;
    this.statusListeners.forEach(listener => listener(status));
  }
  static getStatus() { return this.status; }
  static subscribeStatus(listener: (status: CloudSyncState) => void) {
    this.statusListeners.add(listener);
    listener(this.status);
    return () => { this.statusListeners.delete(listener); };
  }
  static getFirestore() { return getFirestore(); }
  static sanitizeForFirestore<T>(input: T): T { return JSON.parse(JSON.stringify(input)); }
  private static async protectMixedCurrencies(db: Awaited<ReturnType<typeof getDatabase>>, changes: Array<Row & { revision: number }>) {
    const remoteAccounts = changes.filter(change => change.table === 'accounts' && change.value).map(change => change.value);
    const currencies = [...new Set(remoteAccounts.map(account => account.currency).filter(Boolean))] as string[];
    if (currencies.length <= 1) return { changes, warning: null as string | null, relabelTo: null as string | null };
    const settings = await (await import('@/contexts/AppSettingsContext')).loadStoredAppSettings();
    const currency = settings.currency;
    const normalized = changes.map(change => change.value && (change.table === 'accounts' || change.table === 'loans')
      ? { ...change, value: { ...change.value, currency } }
      : change);
    return { changes: normalized, relabelTo: currency, warning: `Cloud currency identifiers were standardized to ${currency}; numeric amounts were not converted.` };
  }
  static async refreshLocalStore() {
    await Promise.all([
      (store.dispatch as AppDispatch)(fetchAccounts()).unwrap(),
      (store.dispatch as AppDispatch)(fetchTransactions()).unwrap(),
      (store.dispatch as AppDispatch)(fetchBudgets()).unwrap(),
      (store.dispatch as AppDispatch)(fetchLoans()).unwrap(),
    ]);
  }
  private static check(uid: string, generation: number) {
    if (generation !== this.generation || getAuth().currentUser?.uid !== uid) throw new Error('Sync cancelled because the session changed');
  }
  private static async cycle(uid: string, generation: number) {
    const db = await getDatabase();
    if (db.scope !== uid) throw new Error('Database session is not ready');
    this.check(uid, generation);
    // A reinstalled app starts with an empty ledger and no revision history.
    // Pull first so local defaults cannot be seeded as competing cloud edits.
    const firstSync = !(await db.readMeta('sync_initialized'));
    const localLedgerEmpty = firstSync && !(await Promise.all([
      db.getAccounts(), db.getTransactions(), db.getBudgets(), db.getLoans(),
    ])).some(rows => rows.length > 0);
    if (localLedgerEmpty) {
      const initial: Array<Row & { revision: number }> = [];
      for (const table of collections) {
        const snapshot = await getDocs(collection(getFirestore(), `users/${uid}/${table}`));
        this.check(uid, generation);
        for (const item of snapshot.docs) {
          if (table === 'meta' && item.id !== 'categories') continue;
          const { _revision = 0, _deleted, _operation, _syncedAt, ...value } = item.data();
          initial.push({ table, id: item.id, value: _deleted ? undefined : { ...value, id: item.id }, revision: _revision });
        }
      }
      const protectedInitial = await this.protectMixedCurrencies(db, initial);
      await db.applyRemote(protectedInitial.changes);
      if (protectedInitial.relabelTo) await db.relabelCurrency(protectedInitial.relabelTo, true);
      if (protectedInitial.warning) this.lastError = protectedInitial.warning;
      await db.writeMeta('sync_initialized', true);
      await this.refreshLocalStore();
    }
    await db.seedOutbox();
    this.isPushing = true;
    try {
      const pending = Object.values(await db.readMeta('outbox') || {}) as Change[];
      // Revisions are checked in a Firestore transaction. Missing records are
      // never interpreted as deletions; deletion is an explicit retained marker.
      for (let offset = 0; offset < pending.length; offset += 100) {
        const changes = pending.slice(offset, offset + 100);
        this.check(uid, generation);
        const revisions: Record<string, number> = {};
        const conflicts: any[] = [];
        try {
        await runTransaction(getFirestore(), async transaction => {
          const refs = changes.map(c => doc(getFirestore(), `users/${uid}/${c.table}/${c.id}`));
          const snapshots = await Promise.all(refs.map(ref => transaction.get(ref)));
          this.check(uid, generation);
          for (let i = 0; i < changes.length; i++) {
            const change = changes[i], remote = snapshots[i].data();
            const revision = Number(remote?._revision || 0);
            const k = `${change.table}/${change.id}`;
            if (remote?._operation === change.token) { revisions[k] = revision; continue; }
            if (revision !== change.base) {
              // Account.balance is a cache derived from the transaction ledger.
              // Two devices posting different transactions update the same
              // account row even though their durable transaction rows do not
              // conflict. Keep the cloud account revision and let applyRemote
              // rebuild the exact balance from the combined ledger below.
              if (change.table === 'accounts' && change.value && sameAccountMetadata(change.value, remote)) {
                revisions[k] = revision;
                continue;
              }
              conflicts.push({ key: k, change, remote: remote || null, revision });
              throw new Error(`Sync conflict in ${change.table}. Local changes are preserved. Review conflicts in Settings.`);
            }
            // An older pre-revision client must not silently overwrite a different legacy record.
            if (remote && revision === 0 && change.value && Number(remote.updated_at || 0) > Number(change.value.updated_at || 0)) {
              conflicts.push({ key: k, change, remote, revision });
              throw new Error('A newer cloud record needs review in Settings. Local changes are preserved.');
            }
            revisions[k] = revision + 1;
            transaction.set(refs[i], { ...this.sanitizeForFirestore(change.value || { id: change.id }), _deleted: !change.value, _revision: revision + 1, _operation: change.token, _syncedAt: serverTimestamp() });
          }
        });
        } catch (error) {
          if (conflicts.length) await db.writeMeta('sync_conflicts', conflicts);
          throw error;
        }
        this.check(uid, generation);
        await db.acknowledge(changes, revisions);
      }
    } finally { this.isPushing = false; }
    this.applyingRemote = true;
    try {
      const cursor = Number(await db.readMeta('pull_cursor')) || 0;
      const lastFullPull = Number(await db.readMeta('last_full_pull_at')) || 0;
      let full = this.forceFullPull || !cursor || Date.now() - lastFullPull > FULL_PULL_INTERVAL_MS;
      this.forceFullPull = false;
      let pulled = await this.pullChanges(uid, generation, full ? null : cursor);
      // Mixed-currency protection compares every cloud account, so a partial
      // pull that brings an account in a currency this device lacks is redone in full.
      if (!full) {
        const localCurrencies = new Set((await db.getAccounts()).map(account => account.currency).filter(Boolean));
        if (pulled.changes.some(change => change.table === 'accounts' && change.value?.currency && localCurrencies.size && !localCurrencies.has(change.value.currency))) {
          full = true;
          pulled = await this.pullChanges(uid, generation, null);
        }
      }
      const changes = pulled.changes;
      this.check(uid, generation);
      const protectedChanges = await this.protectMixedCurrencies(db, changes);
      const changed = await db.applyRemote(protectedChanges.changes);
      if (protectedChanges.relabelTo) { await db.relabelCurrency(protectedChanges.relabelTo, true); this.rerun = true; }
      if (Object.keys(await db.readMeta('outbox') || {}).length) this.rerun = true;
      // The cursor advances only after the pulled rows are safely applied.
      if (pulled.newest > cursor) await db.writeMeta('pull_cursor', pulled.newest);
      if (full) await db.writeMeta('last_full_pull_at', Date.now());
      await db.writeMeta('last_cloud_sync_at', Date.now());
      // Local saves already refreshed the store when they were made; reload only
      // when the cloud brought something new.
      if (changed || protectedChanges.relabelTo) await this.refreshLocalStore();
      await (await import('@/services/AuxiliarySyncService')).default.sync(uid);
      await (await import('@/services/PrivateConfigurationService')).default.sync(uid);
      this.lastPushFinishedAt = Date.now(); this.lastError = protectedChanges.warning;
      NativeErrorReporter.reset();
    } finally { this.applyingRemote = false; }
  }
  /**
   * Reads cloud rows: every row when `since` is null, otherwise only rows whose
   * _syncedAt is after `since` (minus an overlap). Also returns the newest
   * _syncedAt seen, which becomes the next cursor.
   */
  private static async pullChanges(uid: string, generation: number, since: number | null) {
    const changes: Array<Row & { revision: number }> = [];
    let newest = 0;
    for (const table of collections) {
      const ref = collection(getFirestore(), `users/${uid}/${table}`);
      const snapshot = await getDocs(since === null
        ? ref
        : query(ref, where('_syncedAt', '>', Timestamp.fromMillis(Math.max(0, since - PULL_OVERLAP_MS)))));
      this.check(uid, generation);
      for (const item of snapshot.docs) {
        const { _revision = 0, _deleted, _operation, _syncedAt, ...value } = item.data();
        newest = Math.max(newest, syncedAtMillis(_syncedAt));
        if (table === 'meta' && item.id !== 'categories') continue;
        changes.push({ table, id: item.id, value: _deleted ? undefined : { ...value, id: item.id }, revision: _revision });
      }
    }
    return { changes, newest };
  }
  private static async execute(uid: string): Promise<void> {
    if (this.running) { this.rerun = true; await this.running; return; }
    this.setStatus('syncing');
    const generation = this.generation;
    this.running = (async () => {
      do { this.rerun = false; await this.cycle(uid, generation); } while (this.rerun && generation === this.generation);
    })();
    try { await this.running; this.setStatus('synced'); }
    catch (error) {
      if (this.isConnectivityError(error)) { this.setStatus('pending'); throw error; }
      this.lastError = error instanceof Error ? error.message : 'Sync failed'; this.setStatus('error'); throw error;
    }
    finally { this.running = null; }
  }
  static async syncNow(uid?: string | null) {
    await this.refreshLocalStore();
    if (!uid) return { cloudSynced: false };
    const { loadStoredAppSettings } = await import('@/contexts/AppSettingsContext');
    if (!(await loadStoredAppSettings()).cloudSyncEnabled) return { cloudSynced: false };
    // A sync the user asks for re-reads the whole cloud ledger.
    this.forceFullPull = true;
    await this.execute(uid); return { cloudSynced: true };
  }
  static async getDataStatus(uid: string) {
    const db = await getDatabase();
    const { default: AuxiliarySyncService } = await import('@/services/AuxiliarySyncService');
    const localRows = await Promise.all([db.getAccounts(), db.getTransactions(), db.getBudgets(), db.getLoans()]);
    const remoteRows = await Promise.all(collections.slice(0, 4).map(table => getDocs(collection(getFirestore(), `users/${uid}/${table}`))));
    const auxiliarySnapshot = await getDocs(collection(getFirestore(), `users/${uid}/app_data`));
    const names = ['accounts', 'transactions', 'budgets', 'loans'] as const;
    return {
      local: Object.fromEntries(names.map((name, index) => [name, localRows[index].length])),
      cloud: Object.fromEntries(names.map((name, index) => [name, remoteRows[index].docs.filter(item => !item.data()._deleted).length])),
      auxiliaryLocal: await AuxiliarySyncService.getLocalCounts(),
      auxiliaryCloud: Object.fromEntries(auxiliarySnapshot.docs.map(item => [item.id, Number(item.data().count || 0)])),
      lastSyncAt: Number(await db.readMeta('last_cloud_sync_at') || 0),
      restoreReport: await db.readMeta('last_restore_report') || null,
      currencyQuarantine: await db.readMeta('currency_sync_quarantine') || null,
    };
  }
  static async pushAllForUser(uid: string, _mergeOnly = false) { await this.syncNow(uid); }
  static async pullAllForUser(uid: string, _mergeOnly = false) { await this.syncNow(uid); }
  private static schedule() {
    this.setStatus('pending');
    this.rerun = !!this.running;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.currentUid) void this.execute(this.currentUid).catch(() => {
        if (this.currentUid) this.timer = setTimeout(() => this.schedule(), 30000);
      });
    }, 700);
  }
  static startAutoSync(uid: string) {
    if (this.currentUid === uid) return;
    this.stopAutoSync(); this.currentUid = uid;
    this.unsubs.push(LocalChangeEmitter.subscribeImmediate(() => { if (!this.applyingRemote) this.schedule(); }));
    for (const table of collections) this.unsubs.push(onSnapshot(collection(getFirestore(), `users/${uid}/${table}`), snapshot => {
      if (!snapshot.metadata.hasPendingWrites) this.schedule();
    }, error => { if (!this.isConnectivityError(error)) this.lastError = error.message; }));
    this.unsubs.push(onSnapshot(collection(getFirestore(), `users/${uid}/app_data`), snapshot => {
      if (!snapshot.metadata.hasPendingWrites) this.schedule();
    }, error => { if (!this.isConnectivityError(error)) this.lastError = error.message; }));
    this.schedule();
  }
  static stopAutoSync() {
    this.generation++; this.currentUid = null; this.rerun = false;
    if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.unsubs.forEach(fn => fn()); this.unsubs = [];
  }
  static async settle() { await this.running?.catch(() => undefined); }
  static async triggerForegroundSync() { if (this.currentUid) await this.execute(this.currentUid).catch(() => undefined); }
  static async deleteRemoteData(uid: string) {
    this.stopAutoSync(); await this.settle();
    // Financial reset writes tombstones so offline devices cannot resurrect old records.
    for (const table of collections) {
      const snapshot = await getDocs(collection(getFirestore(), `users/${uid}/${table}`));
      for (const item of snapshot.docs.filter(item => table !== 'meta' || item.id === 'categories')) await runTransaction(getFirestore(), async tx => {
        const current = await tx.get(item.ref);
        tx.set(item.ref, { id: item.id, _deleted: true, _revision: Number(current.data()?._revision || 0) + 1, _operation: `reset-${Date.now()}`, _syncedAt: serverTimestamp() });
      });
    }
  }
}
export default SyncService;
