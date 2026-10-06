import { getDatabase } from '@/services/database';
import type { Change, Row, Table } from '@/services/database/ledger';
import LocalChangeEmitter from './LocalChangeEmitter';
import NativeErrorReporter from './NativeErrorReporter';
import { store, AppDispatch } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { collection, doc, getDocs, getFirestore, onSnapshot, runTransaction, serverTimestamp } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const collections: Table[] = ['accounts', 'transactions', 'budgets', 'loans', 'meta'];
export class SyncService {
  static currentUid: string | null = null;
  static applyingRemote = false;
  static isPushing = false;
  static lastPushFinishedAt = 0;
  static lastError: string | null = null;
  static disableAutoSyncUntil = 0;
  static consecutiveNativeErrors = 0;
  private static generation = 0;
  private static timer: ReturnType<typeof setTimeout> | null = null;
  private static unsubs: Array<() => void> = [];
  private static running: Promise<void> | null = null;
  private static rerun = false;
  static getFirestore() { return getFirestore(); }
  static sanitizeForFirestore<T>(input: T): T { return JSON.parse(JSON.stringify(input)); }
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
      const changes: Array<Row & { revision: number }> = [];
      for (const table of collections) {
        const snapshot = await getDocs(collection(getFirestore(), `users/${uid}/${table}`));
        this.check(uid, generation);
        for (const item of snapshot.docs) {
          if (table === 'meta' && item.id !== 'categories') continue;
          const { _revision = 0, _deleted, _operation, _syncedAt, ...value } = item.data();
          changes.push({ table, id: item.id, value: _deleted ? undefined : { ...value, id: item.id }, revision: _revision });
        }
      }
      this.check(uid, generation);
      await db.applyRemote(changes);
      if (Object.keys(await db.readMeta('outbox') || {}).length) this.rerun = true;
      await this.refreshLocalStore();
      this.lastPushFinishedAt = Date.now(); this.lastError = null;
      NativeErrorReporter.reset();
    } finally { this.applyingRemote = false; }
  }
  private static async execute(uid: string): Promise<void> {
    if (this.running) { this.rerun = true; await this.running; return; }
    const generation = this.generation;
    this.running = (async () => {
      do { this.rerun = false; await this.cycle(uid, generation); } while (this.rerun && generation === this.generation);
    })();
    try { await this.running; }
    catch (error) { this.lastError = error instanceof Error ? error.message : 'Sync failed'; throw error; }
    finally { this.running = null; }
  }
  static async syncNow(uid?: string | null) {
    await this.refreshLocalStore();
    if (!uid) return { cloudSynced: false };
    const { loadStoredAppSettings } = await import('@/contexts/AppSettingsContext');
    if (!(await loadStoredAppSettings()).cloudSyncEnabled) return { cloudSynced: false };
    await this.execute(uid); return { cloudSynced: true };
  }
  static async pushAllForUser(uid: string, _mergeOnly = false) { await this.syncNow(uid); }
  static async pullAllForUser(uid: string, _mergeOnly = false) { await this.syncNow(uid); }
  private static schedule() {
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
    this.unsubs.push(LocalChangeEmitter.subscribe(() => { if (!this.applyingRemote) this.schedule(); }));
    for (const table of collections) this.unsubs.push(onSnapshot(collection(getFirestore(), `users/${uid}/${table}`), snapshot => {
      if (!snapshot.metadata.hasPendingWrites) this.schedule();
    }, error => { this.lastError = error.message; }));
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
