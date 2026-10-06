import { firebaseConfig } from '@/config/firebase';
import {
  LinkedChangelogEntry,
  LinkedChatMessage,
  LinkedRepayment,
  LinkRole,
  LoanStatus,
  SharedLoan,
} from '@/types/database';
import { generateUUID } from '@/utils/uuid';
import { getApp, getApps, initializeApp } from 'firebase/app';
import {
  addDoc,
  runTransaction,
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
  where,
} from 'firebase/firestore';
import { normalizePhone } from './AuthService';

function getFirestoreInstance() {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  return getFirestore(app);
}

export interface UserLookupResult {
  uid: string;
  displayName: string;
}

export class LinkedLoanService {
  // ── Phone lookup ────────────────────────────────────────────────────────────

  static async lookupUserByPhone(phone: string): Promise<UserLookupResult | null> {
    const normalized = normalizePhone(phone);
    if (!normalized) return null;
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const result = await httpsCallable(getFunctions(), 'lookupLinkedUser')({ phone: normalized });
    return result.data as UserLookupResult | null;
  }

  // ── Create link request ─────────────────────────────────────────────────────

  static async createLinkRequest(params: {
    initiatorUid: string;
    initiatorName: string;
    initiatorPhone: string;
    initiatorRole: LinkRole;
    otherPartyUid: string;
    otherPartyPhone: string;
    otherPartyName: string;
    localLoanId: string;
    amount: number;
    description: string;
    dueDate: number;
    startDate: number;
    interestRate: number;
  }): Promise<string> {
    const firestore = getFirestoreInstance();
    const sharedLoanId = generateUUID();
    const isBorrower = params.initiatorRole === 'BORROWER';

    const sharedLoan: Omit<SharedLoan, 'id'> = {
      borrowerUid: isBorrower ? params.initiatorUid : params.otherPartyUid,
      borrowerName: isBorrower ? params.initiatorName : params.otherPartyName,
      borrowerPhone: isBorrower ? params.initiatorPhone : params.otherPartyPhone,
      lenderUid: isBorrower ? params.otherPartyUid : params.initiatorUid,
      lenderName: isBorrower ? params.otherPartyName : params.initiatorName,
      lenderPhone: isBorrower ? params.otherPartyPhone : params.initiatorPhone,
      amount: params.amount,
      description: params.description,
      dueDate: params.dueDate,
      startDate: params.startDate,
      interestRate: params.interestRate,
      status: 'ACTIVE',
      initiatorUid: params.initiatorUid,
      linkStatus: 'PENDING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      borrowerLoanId: isBorrower ? params.localLoanId : '',
      lenderLoanId: isBorrower ? '' : params.localLoanId,
    };

    const docRef = doc(firestore, 'sharedLoans', sharedLoanId);
    const { setDoc } = await import('firebase/firestore');
    await setDoc(docRef, sharedLoan);

    await this.addChangelogEntry(sharedLoanId, {
      actorUid: params.initiatorUid,
      actorName: params.initiatorName,
      timestamp: Date.now(),
      action: 'Loan link requested',
    });

    return sharedLoanId;
  }

  // ── Helper Verification ──────────────────────────────────────────────────────

  private static async getAndVerifySharedLoan(
    sharedLoanId: string,
    actorUid: string,
  ): Promise<SharedLoan> {
    const firestore = getFirestoreInstance();
    const snap = await getDoc(doc(firestore, 'sharedLoans', sharedLoanId));
    if (!snap.exists()) {
      throw new Error('Shared loan not found');
    }
    const sharedLoan = snap.data() as SharedLoan;
    if (sharedLoan.borrowerUid !== actorUid && sharedLoan.lenderUid !== actorUid) {
      throw new Error('Unauthorized: Actor is not a participant in this shared loan.');
    }
    return sharedLoan;
  }

  // ── Accept link ─────────────────────────────────────────────────────────────

  static async acceptLink(
    sharedLoanId: string,
    acceptorUid: string,
    acceptorName: string,
    acceptorLoanId: string,
  ): Promise<void> {
    const sharedLoan = await this.getAndVerifySharedLoan(sharedLoanId, acceptorUid);
    if (sharedLoan.linkStatus !== 'PENDING') {
      throw new Error('Unauthorized: Link request is not pending.');
    }
    if (sharedLoan.initiatorUid === acceptorUid) {
      throw new Error('Unauthorized: The initiator cannot accept their own link request.');
    }

    const firestore = getFirestoreInstance();
    const sharedRef = doc(firestore, 'sharedLoans', sharedLoanId);
    const isAcceptorBorrower = sharedLoan.borrowerUid === acceptorUid;

    await updateDoc(sharedRef, {
      linkStatus: 'ACCEPTED',
      updatedAt: Date.now(),
      ...(isAcceptorBorrower
        ? { borrowerLoanId: acceptorLoanId }
        : { lenderLoanId: acceptorLoanId }),
    });

    await this.addChangelogEntry(sharedLoanId, {
      actorUid: acceptorUid,
      actorName: acceptorName,
      timestamp: Date.now(),
      action: 'Link accepted',
    });
  }

  // ── Reject link ─────────────────────────────────────────────────────────────

  static async rejectLink(
    sharedLoanId: string,
    rejectorUid: string,
    rejectorName: string,
  ): Promise<void> {
    const sharedLoan = await this.getAndVerifySharedLoan(sharedLoanId, rejectorUid);
    if (sharedLoan.linkStatus !== 'PENDING') {
      throw new Error('Unauthorized: Link request is not pending.');
    }
    if (sharedLoan.initiatorUid === rejectorUid) {
      throw new Error('Unauthorized: The initiator cannot reject their own link request.');
    }

    const firestore = getFirestoreInstance();
    await updateDoc(doc(firestore, 'sharedLoans', sharedLoanId), {
      linkStatus: 'REJECTED',
      updatedAt: Date.now(),
    });
    await this.addChangelogEntry(sharedLoanId, {
      actorUid: rejectorUid,
      actorName: rejectorName,
      timestamp: Date.now(),
      action: 'Link rejected',
    });
  }

  // ── Unlink (borrower only) ──────────────────────────────────────────────────

  static async unlinkLoan(
    sharedLoanId: string,
    actorUid: string,
    actorName: string,
  ): Promise<void> {
    const sharedLoan = await this.getAndVerifySharedLoan(sharedLoanId, actorUid);
    if (sharedLoan.linkStatus !== 'ACCEPTED') {
      throw new Error('Unauthorized: Only accepted loans can be unlinked.');
    }

    const firestore = getFirestoreInstance();
    await updateDoc(doc(firestore, 'sharedLoans', sharedLoanId), {
      linkStatus: 'REJECTED',
      updatedAt: Date.now(),
    });
    await this.addChangelogEntry(sharedLoanId, {
      actorUid,
      actorName,
      timestamp: Date.now(),
      action: `Loan unlinked by ${sharedLoan.borrowerUid === actorUid ? 'borrower' : 'lender'}`,
    });
  }

  // ── Detach (either participant — used when deleting a local loan record) ─────

  static async detachLoan(
    sharedLoanId: string,
    actorUid: string,
    actorName: string,
  ): Promise<void> {
    const firestore = getFirestoreInstance();
    const sharedRef = doc(firestore, 'sharedLoans', sharedLoanId);
    const snap = await getDoc(sharedRef);
    if (!snap.exists()) return; // already gone — nothing to do
    const data = snap.data() as SharedLoan;
    if (data.borrowerUid !== actorUid && data.lenderUid !== actorUid) {
      throw new Error('Not a participant of this loan');
    }
    if (data.linkStatus === 'REJECTED') return; // already detached
    await updateDoc(sharedRef, { linkStatus: 'REJECTED', updatedAt: Date.now() });
    await this.addChangelogEntry(sharedLoanId, {
      actorUid,
      actorName,
      timestamp: Date.now(),
      action: `Loan detached by ${data.borrowerUid === actorUid ? 'borrower' : 'lender'} (local record deleted)`,
    });
  }

  // ── Real-time listeners ─────────────────────────────────────────────────────

  static listenToMySharedLoans(
    uid: string,
    callback: (loans: (SharedLoan & { id: string })[]) => void,
  ): () => void {
    const firestore = getFirestoreInstance();

    let asBorrower: (SharedLoan & { id: string })[] = [];
    let asLender: (SharedLoan & { id: string })[] = [];

    const merge = () => {
      const seen = new Set<string>();
      const all = [...asBorrower, ...asLender].filter(l => {
        if (seen.has(l.id)) return false;
        seen.add(l.id);
        return true;
      });
      callback(all);
    };

    const unsub1 = onSnapshot(
      query(collection(firestore, 'sharedLoans'), where('borrowerUid', '==', uid)),
      snap => {
        asBorrower = snap.docs.map(d => ({ ...(d.data() as SharedLoan), id: d.id }));
        merge();
      },
      err => console.warn('[LinkedLoanService] borrower listener:', err),
    );

    const unsub2 = onSnapshot(
      query(collection(firestore, 'sharedLoans'), where('lenderUid', '==', uid)),
      snap => {
        asLender = snap.docs.map(d => ({ ...(d.data() as SharedLoan), id: d.id }));
        merge();
      },
      err => console.warn('[LinkedLoanService] lender listener:', err),
    );

    return () => { unsub1(); unsub2(); };
  }

  static listenToSharedLoan(
    sharedLoanId: string,
    callback: (loan: (SharedLoan & { id: string }) | null) => void,
  ): () => void {
    const firestore = getFirestoreInstance();
    return onSnapshot(
      doc(firestore, 'sharedLoans', sharedLoanId),
      snap => callback(snap.exists() ? { ...(snap.data() as SharedLoan), id: snap.id } : null),
    );
  }

  static listenToRepayments(
    sharedLoanId: string,
    callback: (items: (LinkedRepayment & { id: string })[]) => void,
  ): () => void {
    const firestore = getFirestoreInstance();
    return onSnapshot(
      query(
        collection(firestore, 'sharedLoans', sharedLoanId, 'repayments'),
        orderBy('date', 'desc'),
      ),
      snap => callback(snap.docs.map(d => ({ ...(d.data() as LinkedRepayment), id: d.id }))),
    );
  }

  static listenToChat(
    sharedLoanId: string,
    callback: (messages: (LinkedChatMessage & { id: string })[]) => void,
  ): () => void {
    const firestore = getFirestoreInstance();
    return onSnapshot(
      query(
        collection(firestore, 'sharedLoans', sharedLoanId, 'chat'),
        orderBy('timestamp', 'asc'),
      ),
      snap => callback(snap.docs.map(d => ({ ...(d.data() as LinkedChatMessage), id: d.id }))),
    );
  }

  static listenToChangelog(
    sharedLoanId: string,
    callback: (entries: (LinkedChangelogEntry & { id: string })[]) => void,
  ): () => void {
    const firestore = getFirestoreInstance();
    return onSnapshot(
      query(
        collection(firestore, 'sharedLoans', sharedLoanId, 'changelog'),
        orderBy('timestamp', 'desc'),
      ),
      snap => callback(snap.docs.map(d => ({ ...(d.data() as LinkedChangelogEntry), id: d.id }))),
    );
  }

  // ── Repayments ──────────────────────────────────────────────────────────────

  static async getRepayments(sharedLoanId: string) {
    const snapshot = await getDocs(collection(getFirestoreInstance(), 'sharedLoans', sharedLoanId, 'repayments'));
    return snapshot.docs.map(item => ({ ...item.data(), id: item.id } as LinkedRepayment & { id: string }));
  }
  private static async mutateRepayment(input: Record<string, unknown>): Promise<void> {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    await httpsCallable(getFunctions(), 'mutateLinkedRepayment')(input);
  }
  static async addRepayment(sharedLoanId: string, repayment: Omit<LinkedRepayment, 'id'>, actorName: string, operationId = generateUUID()): Promise<string> {
    await this.mutateRepayment({ sharedLoanId, repaymentId: operationId, action: 'record', amount: repayment.amount, date: repayment.date, actorName });
    return operationId;
  }
  static async confirmRepayment(sharedLoanId: string, repaymentId: string, actorUid: string, actorName: string): Promise<void> {
    await this.mutateRepayment({ sharedLoanId, repaymentId, action: 'confirm', actorName });
  }
  static async rejectRepayment(sharedLoanId: string, repaymentId: string, actorUid: string, actorName: string): Promise<void> {
    await this.mutateRepayment({ sharedLoanId, repaymentId, action: 'reject', actorName });
  }

  // ── Chat ────────────────────────────────────────────────────────────────────

  static async sendChatMessage(
    sharedLoanId: string,
    msg: Omit<LinkedChatMessage, 'id'>,
  ): Promise<void> {
    await this.getAndVerifySharedLoan(sharedLoanId, msg.senderUid);
    const firestore = getFirestoreInstance();
    await addDoc(collection(firestore, 'sharedLoans', sharedLoanId, 'chat'), { ...msg, readBy: [msg.senderUid] });
  }

  static async markMessagesRead(
    sharedLoanId: string,
    messageIds: string[],
    uid: string,
  ): Promise<void> {
    await this.getAndVerifySharedLoan(sharedLoanId, uid);
    const firestore = getFirestoreInstance();
    await Promise.all(
      messageIds.map(id =>
        updateDoc(doc(firestore, 'sharedLoans', sharedLoanId, 'chat', id), {
          readBy: arrayUnion(uid),
        }),
      ),
    );
  }

  // ── Changelog ───────────────────────────────────────────────────────────────

  static async addChangelogEntry(
    sharedLoanId: string,
    entry: Omit<LinkedChangelogEntry, 'id'>,
  ): Promise<void> {
    const firestore = getFirestoreInstance();
    await addDoc(
      collection(firestore, 'sharedLoans', sharedLoanId, 'changelog'),
      { ...entry, timestamp: entry.timestamp ?? Date.now() },
    );
  }

  // ── Update loan terms (borrower only) ───────────────────────────────────────

  static async updateSharedLoanTerms(
    sharedLoanId: string,
    actorUid: string,
    actorName: string,
    before: Partial<SharedLoan>,
    updates: Partial<Pick<SharedLoan, 'amount' | 'dueDate' | 'interestRate' | 'description' | 'status'>>,
  ): Promise<void> {
    const sharedLoan = await this.getAndVerifySharedLoan(sharedLoanId, actorUid);
    if (sharedLoan.linkStatus !== 'PENDING') throw new Error('Accepted terms cannot be changed unilaterally. Unlink and send a new request.');
    if (sharedLoan.initiatorUid !== actorUid) {
      throw new Error('Unauthorized: Only the loan initiator can modify loan terms.');
    }

    const firestore = getFirestoreInstance();
    await updateDoc(doc(firestore, 'sharedLoans', sharedLoanId), {
      ...updates,
      updatedAt: Date.now(),
    });
    await this.addChangelogEntry(sharedLoanId, {
      actorUid,
      actorName,
      timestamp: Date.now(),
      action: `Updated: ${Object.keys(updates).join(', ')}`,
      before,
      after: updates,
    });
  }

  // ── Fetch helpers ───────────────────────────────────────────────────────────

  static async getSharedLoan(sharedLoanId: string): Promise<(SharedLoan & { id: string }) | null> {
    const firestore = getFirestoreInstance();
    const snap = await getDoc(doc(firestore, 'sharedLoans', sharedLoanId));
    return snap.exists() ? { ...(snap.data() as SharedLoan), id: snap.id } : null;
  }
}
