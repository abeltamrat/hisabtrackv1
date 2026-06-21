import { getDatabase } from '@/services/database';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import NativeErrorReporter from '@/services/NativeErrorReporter';
import { AppDispatch, store } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { Transaction } from '@/types/database';
import { getApp } from 'firebase/app';
import { collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot, setDoc } from 'firebase/firestore';

/**
 * Minimal Firestore sync service.
 * - pushAllForUser: pushes local DB records to Firestore under users/{uid}/{collection}
 * - pullAllForUser: pulls remote records and upserts into local DB
 */
export class SyncService {
  static applyingRemote = false;
  static isPushing = false;
  static lastPushFinishedAt = 0;
  static localUnsub: (() => void) | null = null;
  static remoteUnsubs: Array<() => void> = [];
  static currentUid: string | null = null;
  // Timestamp of the last successful pull (ms since epoch). Used to decide whether
  // a local-only record is stale and can be removed when missing remotely.
  static lastPulledAt: number | null = null;

  // Proxy native error state to NativeErrorReporter for backward compatibility
  static get disableAutoSyncUntil() {
    return (NativeErrorReporter as any).disableUntil || 0;
  }
  static set disableAutoSyncUntil(v: number) {
    try { (NativeErrorReporter as any).disableUntil = v; } catch (e) { /* ignore */ }
  }
  static get consecutiveNativeErrors() {
    return (NativeErrorReporter as any).consecutiveNativeErrors || 0;
  }
  static set consecutiveNativeErrors(v: number) {
    try { (NativeErrorReporter as any).consecutiveNativeErrors = v; } catch (e) { /* ignore */ }
  }

  // Note: native DB error state is managed in NativeErrorReporter
  static getFirestore() {
    try {
      const app = getApp();
      return getFirestore(app);
    } catch (err) {
      console.error('Firestore initialization failed', err);
      throw err;
    }
  }

  static async pushAllForUser(uid: string, mergeOnly = false) {
    if (this.isPushing) return;
    this.isPushing = true;
    NativeErrorReporter.suppressCounting = true;
    console.info('SyncService.pushAllForUser start', { uid, mergeOnly });

    try {
      let db: any;
      try {
        db = await getDatabase();
      } catch (e) {
        console.error('pushAllForUser: failed to get database', e);
        NativeErrorReporter.record(e);
        return;
      }

      const firestore = this.getFirestore();

      // Accounts
      let accounts: any[] = [];
      try {
        if (typeof db.getAccounts === 'function') accounts = await db.getAccounts();
      } catch (e) {
        console.error('pushAllForUser: failed to read local accounts', e);
        NativeErrorReporter.record(e);
        accounts = [];
      }

      for (const acct of accounts) {
        try {
          const ref = doc(firestore, `users/${uid}/accounts`, acct.id);
          const sanitized = this.sanitizeForFirestore(acct as any);
          await setDoc(ref, sanitized);
        } catch (e) {
          console.error('pushAllForUser: failed to push account', acct?.id, e);
        }
      }

      // Reconcile remote accounts — skip entirely in mergeOnly mode or when local is empty
      // (empty local = fresh install / DB error; deleting remote would destroy cloud backup)
      if (!mergeOnly && accounts.length > 0) {
        try {
          const remoteAccSnap = await getDocs(collection(firestore, `users/${uid}/accounts`));
          const localIds = new Set(accounts.map((a: any) => a.id));
          for (const d of remoteAccSnap.docs) {
            if (!localIds.has(d.id)) await deleteDoc(d.ref);
          }
        } catch (e) {
          console.error('pushAllForUser: failed to reconcile remote accounts', e);
        }
      }

      // Transactions
      let transactions: any[] = [];
      try {
        if (typeof db.getTransactions === 'function') {
          transactions = await db.getTransactions();
        }
      } catch (e) {
        console.error('pushAllForUser: failed to read local transactions', e);
        NativeErrorReporter.record(e);
        transactions = [];
      }
      for (const tx of transactions) {
        try {
          const ref = doc(firestore, `users/${uid}/transactions`, tx.id);
          await setDoc(ref, this.sanitizeForFirestore(tx as any));
        } catch (e) { console.error('pushAllForUser: failed to push transaction', tx?.id, e); }
      }
      if (!mergeOnly && transactions.length > 0) {
        try {
          const remoteTxSnap = await getDocs(collection(firestore, `users/${uid}/transactions`));
          const localTxIds = new Set(transactions.map((t: any) => t.id));
          for (const d of remoteTxSnap.docs) {
            if (!localTxIds.has(d.id)) await deleteDoc(d.ref);
          }
        } catch (e) { }
      }

      // Budgets
      if ((db as any).getBudgets) {
        let budgets: any[] = [];
        try {
          budgets = await (db as any).getBudgets();
        } catch (e) {
          console.error('pushAllForUser: failed to read local budgets', e);
          NativeErrorReporter.record(e);
          budgets = [];
        }
        for (const b of budgets) {
          try {
            await setDoc(doc(firestore, `users/${uid}/budgets`, b.id), this.sanitizeForFirestore(b as any));
          } catch (e) { }
        }
        if (!mergeOnly && budgets.length > 0) {
          try {
            const remoteBudSnap = await getDocs(collection(firestore, `users/${uid}/budgets`));
            const localBudIds = new Set(budgets.map((b: any) => b.id));
            for (const d of remoteBudSnap.docs) {
              if (!localBudIds.has(d.id)) await deleteDoc(d.ref);
            }
          } catch (e) { }
        }
      }

      // Loans
      if ((db as any).getLoans) {
        let loans: any[] = [];
        try {
          loans = await (db as any).getLoans();
        } catch (e) {
          console.error('pushAllForUser: failed to read local loans', e);
          NativeErrorReporter.record(e);
          loans = [];
        }
        for (const l of loans) {
          try {
            await setDoc(doc(firestore, `users/${uid}/loans`, l.id), this.sanitizeForFirestore(l as any));
          } catch (e) { }
        }
        if (!mergeOnly && loans.length > 0) {
          try {
            const remoteLoanSnap = await getDocs(collection(firestore, `users/${uid}/loans`));
            const localLoanIds = new Set(loans.map((l: any) => l.id));
            for (const d of remoteLoanSnap.docs) {
              if (!localLoanIds.has(d.id)) await deleteDoc(d.ref);
            }
          } catch (e) { }
        }
      }


      NativeErrorReporter.reset();
      this.lastPushFinishedAt = Date.now();
      console.info('SyncService.pushAllForUser finished');
    } catch (err) {
      console.error('SyncService.pushAllForUser failed', err);
    } finally {
      NativeErrorReporter.suppressCounting = false;
      this.isPushing = false;
    }
  }

  static startAutoSync(uid: string) {
    try {
      const now = Date.now();
      if (NativeErrorReporter.disableUntil && NativeErrorReporter.disableUntil > now) return;
      if (this.currentUid === uid) return;
      this.stopAutoSync();
      this.currentUid = uid;

      // subscribe to local DB changes
      this.localUnsub = LocalChangeEmitter.subscribe(async () => {
        if (this.applyingRemote || this.isPushing) return;
        if (NativeErrorReporter.disableUntil > Date.now()) return;

        // Debounce slightly
        setTimeout(async () => {
          if (this.applyingRemote || this.isPushing) return;
          if (NativeErrorReporter.disableUntil > Date.now()) return;
          await this.pushAllForUser(uid);
        }, 1000);
      });

      // subscribe to remote changes
      const firestore = this.getFirestore();
      const cols = ['accounts', 'transactions', 'budgets', 'loans'];
      for (const col of cols) {
        const unsub = onSnapshot(collection(firestore, `users/${uid}/${col}`), async (snap) => {
          if (!snap || snap.metadata.hasPendingWrites) return; // Ignore own writes

          if (this.applyingRemote || this.isPushing) return;

          // If we just pushed, wait a bit before pulling (echo check)
          const timeSinceLastPush = Date.now() - this.lastPushFinishedAt;
          if (timeSinceLastPush < 5000) {
            console.debug('Skipping auto-pull, likely own push echo', { col });
            return;
          }

          try {
            await this.pullAllForUser(uid);
          } catch (e) {
            console.error('Auto-pull failed', col, e);
          }
        });
        this.remoteUnsubs.push(unsub);
      }
    } catch (e) {
      console.error('Failed to start auto-sync', e);
    }
  }

  static stopAutoSync() {
    if (this.localUnsub) {
      try { this.localUnsub(); } catch (e) { }
      this.localUnsub = null;
    }
    for (const u of this.remoteUnsubs) {
      try { u(); } catch (e) { }
    }
    this.remoteUnsubs = [];
    this.currentUid = null;
    this.applyingRemote = false;
  }

  static sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) out[k] = null;
      else out[k] = v;
    }
    return out as T;
  }

  static async refreshLocalStore() {
    await Promise.all([
      (store.dispatch as AppDispatch)(fetchAccounts()),
      (store.dispatch as AppDispatch)(fetchTransactions(undefined)),
      (store.dispatch as AppDispatch)(fetchBudgets()),
      (store.dispatch as AppDispatch)(fetchLoans()),
    ]);
  }

  static async syncNow(uid?: string | null) {
    await this.refreshLocalStore();

    if (!uid) {
      return { cloudSynced: false };
    }

    await this.pullAllForUser(uid);
    await this.pushAllForUser(uid);

    return { cloudSynced: true };
  }

  private static getAffectedAccountIds(...transactions: Array<Partial<Transaction> | undefined>) {
    const ids = new Set<string>();

    for (const transaction of transactions) {
      if (transaction?.account_id) {
        ids.add(transaction.account_id);
      }
      if (transaction?.to_account_id) {
        ids.add(transaction.to_account_id);
      }
    }

    return ids;
  }

  static async pullAllForUser(uid: string, mergeOnly = false) {
    if (this.applyingRemote) return;
    this.applyingRemote = true;
    NativeErrorReporter.suppressCounting = true;
    console.info('SyncService.pullAllForUser start', { uid, mergeOnly });
    const prevPulledAt = this.lastPulledAt;

    try {
      let db = await getDatabase();
      const firestore = this.getFirestore();

      const processCollection = async (colName: string, getLocal: () => Promise<any[]>, upsertLocal: (item: any) => Promise<void>, deleteLocal: (id: string) => Promise<void>) => {
        const snap = await getDocs(collection(firestore, `users/${uid}/${colName}`));
        const remoteItems = snap.docs.map(d => d.data() as any);
        const localItems = await getLocal();
        const localMap = new Map(localItems.map(i => [i.id, i]));
        const remoteIds = new Set(remoteItems.map(i => i.id));

        for (const ri of remoteItems) {
          const local = localMap.get(ri.id);
          const remoteUpdated = Number(ri.updated_at ?? 0);
          const localUpdated = Number(local?.updated_at ?? 0);

          if (!local || remoteUpdated > localUpdated) {
            await upsertLocal(ri);
          } else if (localUpdated > remoteUpdated) {
            await setDoc(doc(firestore, `users/${uid}/${colName}`, local.id), this.sanitizeForFirestore(local));
          }
        }

        // Remove local items that were deleted remotely — but never when remote is empty
        // or when mergeOnly is true (first login after install/update — don't destroy local data)
        if (!mergeOnly && remoteItems.length > 0) {
          for (const li of localItems) {
            if (!remoteIds.has(li.id)) {
              const localUpdated = Number(li.updated_at ?? 0);
              const isOld = prevPulledAt && localUpdated < prevPulledAt;
              const isNotRecent = (Date.now() - localUpdated) > 60000;

              if (isOld && isNotRecent) {
                await deleteLocal(li.id);
                console.debug(`pullAllForUser: deleted local ${colName} missing remotely`, li.id);
              }
            }
          }
        }
      };

      const processTransactions = async () => {
        const snap = await getDocs(collection(firestore, `users/${uid}/transactions`));
        const remoteTransactions = snap.docs.map((docSnapshot) => docSnapshot.data() as Transaction);
        const localTransactions = await db.getTransactions();
        const localMap = new Map(localTransactions.map((transaction) => [transaction.id, transaction]));
        const remoteIds = new Set(remoteTransactions.map((transaction) => transaction.id));
        const affectedAccountIds = new Set<string>();

        for (const remoteTransaction of remoteTransactions) {
          const localTransaction = localMap.get(remoteTransaction.id);
          const remoteUpdated = Number(remoteTransaction.updated_at ?? 0);
          const localUpdated = Number(localTransaction?.updated_at ?? 0);

          if (!localTransaction || remoteUpdated > localUpdated) {
            try {
              await db.upsertTransaction(remoteTransaction);
              for (const accountId of this.getAffectedAccountIds(localTransaction, remoteTransaction)) {
                affectedAccountIds.add(accountId);
              }
            } catch (e) {
              console.warn('pullAllForUser: failed to upsert transaction', remoteTransaction.id, e);
            }
          } else if (localUpdated > remoteUpdated) {
            await setDoc(
              doc(firestore, `users/${uid}/transactions`, localTransaction.id),
              this.sanitizeForFirestore(localTransaction as Record<string, any>)
            );
          }
        }

        // Only reconcile deletions when Firestore has transactions and we are not in mergeOnly mode
        if (!mergeOnly && remoteTransactions.length > 0) {
          for (const localTransaction of localTransactions) {
            if (!remoteIds.has(localTransaction.id)) {
              const localUpdated = Number(localTransaction.updated_at ?? 0);
              const isOld = prevPulledAt && localUpdated < prevPulledAt;
              const isNotRecent = (Date.now() - localUpdated) > 60000;

              if (isOld && isNotRecent) {
                await db.deleteTransaction(localTransaction.id, true);
                for (const accountId of this.getAffectedAccountIds(localTransaction)) {
                  affectedAccountIds.add(accountId);
                }
                console.debug('pullAllForUser: deleted local transactions missing remotely', localTransaction.id);
              }
            }
          }
        }

        await Promise.all(
          [...affectedAccountIds].map((accountId) => db.recalculateAccountBalance(accountId))
        );
      };

      await processCollection('accounts', () => db.getAccounts(), (i) => db.upsertAccount(i), (id) => db.deleteAccount(id));
      await processTransactions();
      await processCollection('budgets', () => db.getBudgets(), (i) => db.upsertBudget(i), (id) => db.deleteBudget(id));
      await processCollection('loans', () => db.getLoans(), (i) => db.upsertLoan(i), (id) => db.deleteLoan(id));

      this.lastPulledAt = Date.now();
      NativeErrorReporter.reset();

    } catch (e) {
      console.error('pullAllForUser error', e);
    } finally {
      NativeErrorReporter.suppressCounting = false;
      this.applyingRemote = false;
      // Always refresh Redux store — even on partial failure so any data that
      // made it into SQLite (e.g. accounts pulled before transactions failed) is visible.
      try { await this.refreshLocalStore(); } catch (re) { console.error('refreshLocalStore failed', re); }
    }
  }

  /**
   * Called every time the app comes to foreground while signed in.
   * Pushes any local changes to Firestore and pulls any remote changes.
   * Rate-limited to at most once every 5 minutes so it doesn't spam Firestore.
   */
  static async triggerForegroundSync(): Promise<void> {
    if (!this.currentUid) return;
    if (this.isPushing || this.applyingRemote) return;

    const sinceLastPush = Date.now() - this.lastPushFinishedAt;
    if (sinceLastPush < 5 * 60 * 1000) return;

    try {
      await this.pullAllForUser(this.currentUid);
      await this.pushAllForUser(this.currentUid);
    } catch (e) {
      console.error('SyncService.triggerForegroundSync failed', e);
    }
  }

  static async deleteRemoteData(uid: string) {
    const firestore = this.getFirestore();
    const cols = ['accounts', 'transactions', 'budgets', 'loans'];
    for (const col of cols) {
      const snapshot = await getDocs(collection(firestore, `users/${uid}/${col}`));
      await Promise.all(snapshot.docs.map(doc => deleteDoc(doc.ref)));
    }
  }
}

export default SyncService;
