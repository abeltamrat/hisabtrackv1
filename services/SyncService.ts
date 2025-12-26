import { getDatabase } from '@/services/database';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';
import NativeErrorReporter from '@/services/NativeErrorReporter';
import { AppDispatch, store } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchBudgets } from '@/store/slices/budgetsSlice';
import { fetchLoans } from '@/store/slices/loansSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { getApp } from 'firebase/app';
import { collection, deleteDoc, doc, getDocs, getFirestore, onSnapshot, setDoc } from 'firebase/firestore';

/**
 * Minimal Firestore sync service.
 * - pushAllForUser: pushes local DB records to Firestore under users/{uid}/{collection}
 * - pullAllForUser: pulls remote records and upserts into local DB
 */
export class SyncService {
  static applyingRemote = false;
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

  static async pushAllForUser(uid: string) {
    console.info('SyncService.pushAllForUser start', { uid });
    let db: any;
    try {
      db = await getDatabase();
    } catch (e) {
      console.error('pushAllForUser: failed to get database', e);
      NativeErrorReporter.record(e);
      return;
    }
    console.debug('pushAllForUser: local DB obtained', { hasGetAccounts: typeof db.getAccounts === 'function' });
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
    console.info('pushAllForUser: accounts to push', accounts.length);
    for (const acct of accounts) {
      try {
        const ref = doc(firestore, `users/${uid}/accounts`, acct.id);
        const sanitized = this.sanitizeForFirestore(acct as any);
        await setDoc(ref, sanitized);
      } catch (e) {
        console.error('pushAllForUser: failed to push account', acct?.id, e);
        NativeErrorReporter.record(e);
      }
    }
    // Remove any remote accounts that no longer exist locally (handle deletions)
    try {
      const remoteAccSnap = await getDocs(collection(firestore, `users/${uid}/accounts`));
      const localIds = new Set(accounts.map(a => a.id));
      for (const d of remoteAccSnap.docs) {
        if (!localIds.has(d.id)) {
          try {
            await deleteDoc(d.ref);
            console.debug('pushAllForUser: deleted remote account not present locally', d.id);
          } catch (e) {
            console.error('pushAllForUser: failed to delete remote account', d.id, e);
            NativeErrorReporter.record(e);
          }
        }
      }
    } catch (e) {
      console.error('pushAllForUser: failed to reconcile remote accounts', e);
    }

    // Transactions
    let transactions: any[] = [];
    try { if (typeof db.getTransactions === 'function') transactions = await db.getTransactions(); } catch (e) { console.error('pushAllForUser: failed to read transactions', e); NativeErrorReporter.record(e); transactions = []; }
    console.info('pushAllForUser: transactions to push', transactions.length);
    for (const tx of transactions) {
      try {
        const ref = doc(firestore, `users/${uid}/transactions`, tx.id);
        const sanitized = this.sanitizeForFirestore(tx as any);
        await setDoc(ref, sanitized);
      } catch (e) {
        console.error('pushAllForUser: failed to push transaction', tx?.id, e);
      }
    }
    // Remove any remote transactions that no longer exist locally
    try {
      const remoteTxSnap = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const localTxIds = new Set(transactions.map(t => t.id));
      for (const d of remoteTxSnap.docs) {
        if (!localTxIds.has(d.id)) {
          try {
            await deleteDoc(d.ref);
            console.debug('pushAllForUser: deleted remote transaction not present locally', d.id);
          } catch (e) {
            console.error('pushAllForUser: failed to delete remote transaction', d.id, e);
            NativeErrorReporter.record(e);
          }
        }
      }
    } catch (e) {
      console.error('pushAllForUser: failed to reconcile remote transactions', e);
    }

    // Budgets
    if ((db as any).getBudgets) {
      let budgets: any[] = [];
      try { budgets = await (db as any).getBudgets(); } catch (e) { console.error('pushAllForUser: failed to read budgets', e); NativeErrorReporter.record(e); budgets = []; }
      console.info('pushAllForUser: budgets to push', budgets.length);
      for (const b of budgets) {
        try {
          const ref = doc(firestore, `users/${uid}/budgets`, b.id);
          const sanitized = this.sanitizeForFirestore(b as any);
          await setDoc(ref, sanitized);
        } catch (e) { console.error('pushAllForUser: failed to push budget', b?.id, e); }
      }
      // Remove any remote budgets that no longer exist locally
      try {
        const remoteBudSnap = await getDocs(collection(firestore, `users/${uid}/budgets`));
        const localBudIds = new Set(budgets.map(b => b.id));
        for (const d of remoteBudSnap.docs) {
          if (!localBudIds.has(d.id)) {
            try {
              await deleteDoc(d.ref);
              console.debug('pushAllForUser: deleted remote budget not present locally', d.id);
            } catch (e) {
              console.error('pushAllForUser: failed to delete remote budget', d.id, e);
              NativeErrorReporter.record(e);
            }
          }
        }
      } catch (e) {
        console.error('pushAllForUser: failed to reconcile remote budgets', e);
      }
    }

    // Loans
    if ((db as any).getLoans) {
      let loans: any[] = [];
      try { loans = await (db as any).getLoans(); } catch (e) { console.error('pushAllForUser: failed to read loans', e); NativeErrorReporter.record(e); loans = []; }
      console.info('pushAllForUser: loans to push', loans.length);
      for (const l of loans) {
        try {
          const ref = doc(firestore, `users/${uid}/loans`, l.id);
          const sanitized = this.sanitizeForFirestore(l as any);
          await setDoc(ref, sanitized);
        } catch (e) { console.error('pushAllForUser: failed to push loan', l?.id, e); }
      }
      // Remove any remote loans that no longer exist locally
      try {
        const remoteLoanSnap = await getDocs(collection(firestore, `users/${uid}/loans`));
        const localLoanIds = new Set(loans.map(l => l.id));
        for (const d of remoteLoanSnap.docs) {
          if (!localLoanIds.has(d.id)) {
            try {
              await deleteDoc(d.ref);
              console.debug('pushAllForUser: deleted remote loan not present locally', d.id);
            } catch (e) {
              console.error('pushAllForUser: failed to delete remote loan', d.id, e);
              NativeErrorReporter.record(e);
            }
          }
        }
      } catch (e) {
        console.error('pushAllForUser: failed to reconcile remote loans', e);
      }
    }
    // success — reset native error counter
    NativeErrorReporter.reset();
  }

  static startAutoSync(uid: string) {
    try {
      const now = Date.now();
      if (NativeErrorReporter.disableUntil && NativeErrorReporter.disableUntil > now) {
        console.warn('Auto-sync is temporarily disabled due to repeated native DB errors. Will retry after', new Date(NativeErrorReporter.disableUntil).toISOString());
        return;
      }
      if (this.currentUid === uid) return;
      this.stopAutoSync();
      this.currentUid = uid;
      // subscribe to local DB changes
      this.localUnsub = LocalChangeEmitter.subscribe(async () => {
        if (this.applyingRemote) return;
        try {
          await this.pushAllForUser(uid);
        } catch (e) {
          console.error('Auto-push failed', e);
        }
      });

      // subscribe to remote changes
      const firestore = this.getFirestore();
      const cols = ['accounts', 'transactions', 'budgets', 'loans'];
      for (const col of cols) {
        const unsub = onSnapshot(collection(firestore, `users/${uid}/${col}`), async (snap) => {
          console.debug('onSnapshot triggered', { uid, col, size: snap?.size });
          if (!snap || snap.empty) return;
          
          // Prevent multiple simultaneous syncs (race condition fix)
          if (this.applyingRemote) {
            console.debug('Skipping auto-sync, already syncing', { col });
            return;
          }
          
          try {
            this.applyingRemote = true;
            await this.pullAllForUser(uid);
          } catch (e) {
            console.error('Auto-pull failed for collection', col, e);
            NativeErrorReporter.record(e);
          } finally {
            this.applyingRemote = false;
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
      try { this.localUnsub(); } catch (e) { /* ignore */ }
      this.localUnsub = null;
    }
    for (const u of this.remoteUnsubs) {
      try { u(); } catch (e) { /* ignore */ }
    }
    this.remoteUnsubs = [];
    this.currentUid = null;
    this.applyingRemote = false;
  }

  // Convert undefined fields to null (Firestore rejects undefined)
  static sanitizeForFirestore<T extends Record<string, any>>(obj: T): T {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(obj)) {
      if (v === undefined) out[k] = null;
      else out[k] = v;
    }
    return out as T;
  }

  static async pullAllForUser(uid: string) {
    console.info('SyncService.pullAllForUser start', { uid });
    const prevPulledAt = this.lastPulledAt;
    this.applyingRemote = true;
    try {
      let db: any;
      try {
        db = await getDatabase();
        console.debug('pullAllForUser: local DB obtained', { hasGetAccounts: typeof db.getAccounts === 'function' });
      } catch (e) {
        console.error('pullAllForUser: failed to get database', e);
        NativeErrorReporter.record(e);
        // continue with firestore reads but we will not be able to upsert locally
      }
      const firestore = this.getFirestore();
      // Pull accounts first (they carry balances) with timestamp-based merge
      const accSnap = await getDocs(collection(firestore, `users/${uid}/accounts`));
      const remoteAccounts = accSnap.docs.map((d) => d.data() as any);
      console.info('pullAllForUser: remote accounts count', remoteAccounts.length);
      const localAccounts = (db && db.getAccounts ? await db.getAccounts() : []) as any[];
      const localAccountMap = new Map(localAccounts.map((a) => [a.id, a]));

      for (const ra of remoteAccounts) {
        const local = localAccountMap.get(ra.id);
        const remoteUpdated = Number(ra.updated_at ?? 0);
        const localUpdated = Number(local?.updated_at ?? 0);
        console.debug('account merge', { id: ra.id, remoteUpdated, localUpdated, hasLocal: !!local });

          if (!local) {
            if (db && db.upsertAccount) {
              try {
                await db.upsertAccount(ra);
                console.debug('account merged: inserted local', ra.id);
              } catch (e) {
                console.error('pullAllForUser: upsertAccount failed', e);
                NativeErrorReporter.record(e);
              }
            } else {
              console.warn('account merge: cannot upsert locally, DB unavailable', ra.id);
            }
            continue;
          }

        if (remoteUpdated > localUpdated) {
          if (db && db.upsertAccount) {
            try {
              await db.upsertAccount(ra);
              console.debug('account merged: remote newer, upserted locally', ra.id);
            } catch (e) {
              console.error('pullAllForUser: upsertAccount failed', e);
              NativeErrorReporter.record(e);
            }
          }
        } else if (localUpdated > remoteUpdated) {
          const ref = doc(firestore, `users/${uid}/accounts`, local.id);
          await setDoc(ref, local);
          console.debug('account merged: local newer, pushed remote', local.id);
        }
      }

      // Remove any local accounts that no longer exist remotely and haven't been
      // modified since the previous pull. This avoids resurrecting deletions
      // when another client removed the remote doc.
      try {
        if (db && db.getAccounts && db.deleteAccount) {
          const remoteIds = new Set(remoteAccounts.map((r: any) => r.id));
          for (const la of localAccounts) {
            if (!remoteIds.has(la.id)) {
              const localUpdated = Number(la.updated_at ?? 0);
              if (prevPulledAt && localUpdated <= prevPulledAt) {
                try {
                  await db.deleteAccount(la.id);
                  console.debug('pullAllForUser: deleted local account missing remotely', la.id);
                } catch (e) {
                  console.error('pullAllForUser: failed to delete local account missing remotely', la.id, e);
                  NativeErrorReporter.record(e);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('pullAllForUser: failed to reconcile local accounts with remote', e);
      }

      // Transactions with timestamp merge
      const txSnap = await getDocs(collection(firestore, `users/${uid}/transactions`));
      const remoteTx = txSnap.docs.map((d) => d.data() as any);
      console.info('pullAllForUser: remote transactions count', remoteTx.length);
      const localTx = (db && db.getTransactions ? await db.getTransactions() : []) as any[];
      const localTxMap = new Map(localTx.map((t) => [t.id, t]));

      const accountsToPush = new Set<string>();
      for (const rtx of remoteTx) {
        const local = localTxMap.get(rtx.id);
        const remoteUpdated = Number(rtx.updated_at ?? 0);
        const localUpdated = Number(local?.updated_at ?? 0);
        console.debug('transaction merge', { id: rtx.id, remoteUpdated, localUpdated, hasLocal: !!local });

        if (!local) {
          if (db && db.upsertTransaction) {
            try {
              await db.upsertTransaction(rtx);
              console.debug('transaction merged: inserted local', rtx.id);
            } catch (e) {
              console.error('pullAllForUser: upsertTransaction failed', e);
              NativeErrorReporter.record(e);
            }
          } else {
            console.warn('transaction merge: cannot upsert locally, DB unavailable', rtx.id);
          }
          // apply transaction effect to account balance locally
          try {
            if (db && db.getAccounts) {
              const accounts = await db.getAccounts();
              const acct = accounts.find((a: any) => a.id === rtx.account_id);
              if (acct) {
                if (rtx.type === 'INCOME') acct.balance = Number(acct.balance) + Number(rtx.amount);
                else if (rtx.type === 'EXPENSE' || rtx.type === 'TRANSFER') acct.balance = Number(acct.balance) - Number(rtx.amount);
                acct.updated_at = Date.now();
                if (db.updateAccount) {
                  try {
                    await db.updateAccount(acct);
                    accountsToPush.add(acct.id);
                  } catch (e) {
                    console.error('pullAllForUser: updateAccount failed', e);
                    NativeErrorReporter.record(e);
                  }
                }
              }
            }
          } catch (e) {
            console.error('Failed to apply remote transaction to local account balance', e);
            NativeErrorReporter.record(e);
          }
          continue;
        }

        if (remoteUpdated > localUpdated) {
          if (db && db.upsertTransaction) {
            try {
              await db.upsertTransaction(rtx);
              console.debug('transaction merged: remote newer, upserted locally', rtx.id);
            } catch (e) {
              console.error('pullAllForUser: upsertTransaction failed', e);
              NativeErrorReporter.record(e);
            }
          }
        } else if (localUpdated > remoteUpdated) {
          const ref = doc(firestore, `users/${uid}/transactions`, local.id);
          await setDoc(ref, local);
          console.debug('transaction merged: local newer, pushed remote', local.id);
        }
      }

      // Remove any local transactions that no longer exist remotely and haven't
      // been modified since the previous pull.
      try {
        if (db && db.getTransactions && db.deleteTransaction) {
          const remoteTxIds = new Set(remoteTx.map((r: any) => r.id));
          for (const ltx of localTx) {
            if (!remoteTxIds.has(ltx.id)) {
              const localUpdated = Number(ltx.updated_at ?? 0);
              if (prevPulledAt && localUpdated <= prevPulledAt) {
                try {
                  await db.deleteTransaction(ltx.id);
                  console.debug('pullAllForUser: deleted local transaction missing remotely', ltx.id);
                } catch (e) {
                  console.error('pullAllForUser: failed to delete local transaction missing remotely', ltx.id, e);
                  NativeErrorReporter.record(e);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('pullAllForUser: failed to reconcile local transactions with remote', e);
      }

      // If we updated any local account balances from remote transactions, push those accounts
      if (accountsToPush.size > 0) {
        try {
          await this.pushAllForUser(uid);
        } catch (e) {
          console.error('Failed to push updated accounts after applying remote transactions', e);
        }
      }

      // Budgets
      const budSnap = await getDocs(collection(firestore, `users/${uid}/budgets`));
      const remoteBuds = budSnap.docs.map((d) => d.data() as any);
      const localBuds = (db && db.getBudgets ? await (db as any).getBudgets() : []) as any[];
      const localBudMap = new Map(localBuds.map((b) => [b.id, b]));

      for (const rb of remoteBuds) {
        const local = localBudMap.get(rb.id);
        const remoteUpdated = Number(rb.updated_at ?? 0);
        const localUpdated = Number(local?.updated_at ?? 0);

        if (!local) {
          if (db && db.upsertBudget) {
            try { await db.upsertBudget(rb); } catch (e) { console.error('pullAllForUser: upsertBudget failed', e); NativeErrorReporter.record(e); }
          }
          continue;
        }

        if (remoteUpdated > localUpdated) {
          if (db && db.upsertBudget) { try { await db.upsertBudget(rb); } catch (e) { console.error('pullAllForUser: upsertBudget failed', e); NativeErrorReporter.record(e); } }
        } else if (localUpdated > remoteUpdated) {
          const ref = doc(firestore, `users/${uid}/budgets`, local.id);
          await setDoc(ref, local);
        }
      }

      // Remove any local budgets that no longer exist remotely and haven't been
      // modified since the previous pull.
      try {
        if (db && (db as any).getBudgets && (db as any).deleteBudget) {
          const remoteBudIds = new Set(remoteBuds.map((r: any) => r.id));
          for (const lb of localBuds) {
            if (!remoteBudIds.has(lb.id)) {
              const localUpdated = Number(lb.updated_at ?? 0);
              if (prevPulledAt && localUpdated <= prevPulledAt) {
                try {
                  await (db as any).deleteBudget(lb.id);
                  console.debug('pullAllForUser: deleted local budget missing remotely', lb.id);
                } catch (e) {
                  console.error('pullAllForUser: failed to delete local budget missing remotely', lb.id, e);
                  NativeErrorReporter.record(e);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('pullAllForUser: failed to reconcile local budgets with remote', e);
      }

      // Loans
      const loanSnap = await getDocs(collection(firestore, `users/${uid}/loans`));
      const remoteLoans = loanSnap.docs.map((d) => d.data() as any);
      const localLoans = (db && db.getLoans ? await (db as any).getLoans() : []) as any[];
      const localLoanMap = new Map(localLoans.map((l) => [l.id, l]));

      for (const rl of remoteLoans) {
        const local = localLoanMap.get(rl.id);
        const remoteUpdated = Number(rl.updated_at ?? 0);
        const localUpdated = Number(local?.updated_at ?? 0);

        if (!local) {
          if (db && db.upsertLoan) { try { await db.upsertLoan(rl); } catch (e) { console.error('pullAllForUser: upsertLoan failed', e); NativeErrorReporter.record(e); } }
          continue;
        }

        if (remoteUpdated > localUpdated) {
          if (db && db.upsertLoan) { try { await db.upsertLoan(rl); } catch (e) { console.error('pullAllForUser: upsertLoan failed', e); NativeErrorReporter.record(e); } }
        } else if (localUpdated > remoteUpdated) {
          const ref = doc(firestore, `users/${uid}/loans`, local.id);
          await setDoc(ref, local);
        }
      }

      // Remove any local loans that no longer exist remotely and haven't been
      // modified since the previous pull.
      try {
        if (db && (db as any).getLoans && (db as any).deleteLoan) {
          const remoteLoanIds = new Set(remoteLoans.map((r: any) => r.id));
          for (const ll of localLoans) {
            if (!remoteLoanIds.has(ll.id)) {
              const localUpdated = Number(ll.updated_at ?? 0);
              if (prevPulledAt && localUpdated <= prevPulledAt) {
                try {
                  await (db as any).deleteLoan(ll.id);
                  console.debug('pullAllForUser: deleted local loan missing remotely', ll.id);
                } catch (e) {
                  console.error('pullAllForUser: failed to delete local loan missing remotely', ll.id, e);
                  NativeErrorReporter.record(e);
                }
              }
            }
          }
        }
      } catch (e) {
        console.error('pullAllForUser: failed to reconcile local loans with remote', e);
      }
      // success — reset native error reporter
      NativeErrorReporter.reset();
      // mark time of this successful pull
      try {
        this.lastPulledAt = Date.now();
      } catch (e) { /* ignore */ }
      
      // Refresh Redux Store to update UI
      try {
        console.debug('pullAllForUser: refreshing redux store');
        (store.dispatch as AppDispatch)(fetchAccounts());
        (store.dispatch as AppDispatch)(fetchTransactions(undefined));
        (store.dispatch as AppDispatch)(fetchBudgets());
        (store.dispatch as AppDispatch)(fetchLoans());
      } catch (e) {
        console.error('pullAllForUser: failed to refresh redux store', e);
      }

    } finally {
      this.applyingRemote = false;
    }
  }

  // Delete all data for a user from Firestore (for Reset Account)
  static async deleteRemoteData(uid: string) {
    console.info('SyncService.deleteRemoteData start', { uid });
    const firestore = this.getFirestore();
    const cols = ['accounts', 'transactions', 'budgets', 'loans'];
    
    for (const col of cols) {
      try {
        const snapshot = await getDocs(collection(firestore, `users/${uid}/${col}`));
        const deletePromises = snapshot.docs.map(doc => deleteDoc(doc.ref));
        await Promise.all(deletePromises);
        console.log(`Deleted ${deletePromises.length} docs from ${col}`);
      } catch (e) {
        console.error(`Failed to delete collection ${col}`, e);
      }
    }
  }

}

export default SyncService;
