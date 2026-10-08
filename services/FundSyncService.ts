import SessionStorage from './SessionStorage';
import { AppNotificationService } from './AppNotificationService';
import FundLedgerService from './FundLedgerService';
import { NotificationService } from './NotificationService';
import { fundErrorMessage, fundRole, SharedFundService } from './SharedFundService';
import { FUNDS_ENABLED } from '@/config/features';
import { store } from '@/store';
import { fetchAccounts } from '@/store/slices/accountsSlice';
import { fetchTransactions } from '@/store/slices/transactionsSlice';
import { createSerialQueue } from '@/utils/asyncLock';
import type { FundAction } from '@/utils/fundLedger';
import { getOwnerReturnAccount } from '@/components/funds/fundUi';
import type { FundEntry, SharedFund } from '@/types/database';

/**
 * One app-wide listener for the signed-in user's funds. It keeps the owner's
 * books in step (FundLedgerService) and turns the other person's activity
 * into notifications. Every failure is contained here and surfaced through
 * the snapshot; nothing in this file throws into a screen.
 */
export interface FundSnapshot {
  ready: boolean;
  funds: SharedFund[];
  /** Owner-side questions per fund (which account, what was this deposit). */
  actions: Record<string, FundAction[]>;
  /** Per-fund problems keeping the owner's books in step. */
  problems: Record<string, string>;
  error?: string;
}

interface SyncState {
  seen: Record<string, number>;
  versions: Record<string, string>;
  lowAlerted: Record<string, boolean>;
}

const STATE_KEY = 'fund_sync_state';
const MAX_ALERTS_PER_FUND = 4;
const EMPTY: FundSnapshot = { ready: false, funds: [], actions: {}, problems: {} };

export function formatFundMoney(amount: number, currency: string): string {
  return `${currency} ${amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

export default class FundSyncService {
  private static uid: string | null = null;
  private static generation = 0;
  private static unsubscribe: (() => void) | null = null;
  private static snapshot: FundSnapshot = EMPTY;
  private static listeners = new Set<(snapshot: FundSnapshot) => void>();
  private static queue = createSerialQueue();

  static start(uid: string) {
    if (!FUNDS_ENABLED || !uid) return;
    if (this.uid === uid && this.unsubscribe) return;
    this.stop();
    this.uid = uid;
    const generation = ++this.generation;
    try {
      this.unsubscribe = SharedFundService.listenToMyFunds(
        uid,
        funds => {
          if (generation !== this.generation) return;
          this.publish({ ...this.snapshot, ready: true, funds, error: undefined });
          void this.queue(() => this.processAll(uid, generation, funds)).catch(() => undefined);
        },
        error => {
          if (generation !== this.generation) return;
          this.publish({ ...this.snapshot, ready: true, error: fundErrorMessage(error) });
        },
      );
    } catch (error) {
      this.publish({ ...EMPTY, ready: true, error: fundErrorMessage(error) });
    }
  }

  static stop() {
    this.generation++;
    try { this.unsubscribe?.(); } catch { /* already gone */ }
    this.unsubscribe = null;
    this.uid = null;
    this.publish(EMPTY);
  }

  static getSnapshot(): FundSnapshot { return this.snapshot; }

  static subscribe(listener: (snapshot: FundSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => { this.listeners.delete(listener); };
  }

  /** Re-runs the owner's books for one fund now (after the owner acts). */
  static refresh(fund: SharedFund): Promise<void> {
    const uid = this.uid, generation = this.generation;
    if (!uid) return Promise.resolve();
    return this.queue(async () => {
      const state = await this.loadState();
      await this.processFund(uid, generation, fund, state, true);
      await this.saveState(state);
    }).catch(() => undefined);
  }

  private static publish(snapshot: FundSnapshot) {
    this.snapshot = snapshot;
    for (const listener of this.listeners) {
      try { listener(snapshot); } catch { /* a broken screen must not stop the others */ }
    }
  }

  private static async loadState(): Promise<SyncState> {
    try {
      const raw = await SessionStorage.getItem(STATE_KEY);
      const parsed = raw ? JSON.parse(raw) : {};
      return { seen: parsed.seen || {}, versions: parsed.versions || {}, lowAlerted: parsed.lowAlerted || {} };
    } catch {
      return { seen: {}, versions: {}, lowAlerted: {} };
    }
  }

  private static async saveState(state: SyncState) {
    try { await SessionStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch { /* best effort */ }
  }

  private static async processAll(uid: string, generation: number, funds: SharedFund[]) {
    const state = await this.loadState();
    for (const fund of funds) {
      if (generation !== this.generation) return;
      try { await this.processFund(uid, generation, fund, state, false); } catch { /* next snapshot retries */ }
    }
    await this.saveState(state);
  }

  private static async processFund(uid: string, generation: number, fund: SharedFund, state: SyncState, force: boolean) {
    const role = fundRole(fund, uid);
    if (role === 'INVITEE' && fund.linkStatus === 'PENDING') {
      await this.notify(`${fund.ownerName} invited you to hold "${fund.name}"`, 'Open Funds to accept or decline.', fund.id, `fund-invite-${fund.id}-${fund.inviteExpiresAt || 0}`, 'info');
      return;
    }
    if (role !== 'OWNER' && role !== 'CUSTODIAN') return;

    const version = `${fund.entryVersion}:${fund.status}:${fund.linkStatus}`;
    if (!force && state.versions[fund.id] === version) return;
    const entries = await SharedFundService.getAllEntries(fund.id);
    if (generation !== this.generation) return;

    if (role === 'OWNER') {
      const result = await FundLedgerService.reconcile(fund, entries, uid, await getOwnerReturnAccount(fund.id));
      const problems = { ...this.snapshot.problems };
      if (result.error) problems[fund.id] = result.error; else delete problems[fund.id];
      this.publish({ ...this.snapshot, actions: { ...this.snapshot.actions, [fund.id]: result.actions }, problems });
      if (result.changed) {
        void store.dispatch(fetchTransactions());
        void store.dispatch(fetchAccounts());
      }
      await this.checkLowFloat(fund, state);
    }

    await this.notifyActivity(uid, role, fund, entries, state);
    state.versions[fund.id] = version;
  }

  private static async checkLowFloat(fund: SharedFund, state: SyncState) {
    if (!fund.floatTarget || fund.status !== 'ACTIVE' || fund.linkStatus !== 'ACCEPTED') return;
    const threshold = fund.floatTarget * fund.lowBalancePct / 100;
    const low = fund.balance < threshold;
    if (low && !state.lowAlerted[fund.id]) {
      const topUp = Math.max(0, fund.floatTarget - fund.balance);
      await this.notify(`${fund.name} is running low`, `${fund.custodianName || 'The custodian'} has ${formatFundMoney(fund.balance, fund.currency)} left. Send ${formatFundMoney(topUp, fund.currency)} to restore the float.`, fund.id, `fund-low-${fund.id}-${fund.entryVersion}`, 'warning');
    }
    state.lowAlerted[fund.id] = low;
  }

  private static async notifyActivity(uid: string, role: 'OWNER' | 'CUSTODIAN', fund: SharedFund, entries: FundEntry[], state: SyncState) {
    const events: Array<{ at: number; key: string; title: string; body: string }> = [];
    const other = role === 'OWNER' ? fund.custodianName || 'The custodian' : fund.ownerName;
    const money = (amount: number) => formatFundMoney(amount, fund.currency);
    for (const entry of entries) {
      if (entry.recordedByUid !== uid && entry.createdAt) {
        if (role === 'OWNER' && entry.kind === 'SPEND') events.push({ at: entry.createdAt, key: `created-${entry.id}`, title: `${other} paid ${money(entry.amount)}`, body: `${entry.recipient ? `To ${entry.recipient} · ` : ''}${entry.category || entry.description} · ${fund.name}` });
        else if (role === 'OWNER' && entry.kind === 'DEPOSIT' && entry.source === 'THIRD_PARTY') events.push({ at: entry.createdAt, key: `created-${entry.id}`, title: `${other} received ${money(entry.amount)} for you`, body: `From ${entry.payerName || 'someone'} · tap to say what it was for` });
        else if (role === 'OWNER' && entry.kind === 'DEPOSIT') events.push({ at: entry.createdAt, key: `created-${entry.id}`, title: `${other} says you sent ${money(entry.amount)}`, body: 'Pick the account it came from so your books match.' });
        else if (role === 'OWNER' && entry.kind === 'RETURN') events.push({ at: entry.createdAt, key: `created-${entry.id}`, title: `${other} returned ${money(entry.amount)}`, body: fund.name });
        else if (role === 'CUSTODIAN' && entry.status === 'PENDING') events.push({ at: entry.createdAt, key: `created-${entry.id}`, title: `Expect ${money(entry.amount)} from ${entry.payerName || 'someone'}`, body: `${fund.ownerName} asked you to confirm when it arrives.` });
        else if (role === 'CUSTODIAN' && entry.kind === 'DEPOSIT' && entry.source === 'OWNER') events.push({ at: entry.createdAt, key: `created-${entry.id}`, title: `${fund.ownerName} sent you ${money(entry.amount)}`, body: `Confirm when it arrives · ${fund.name}` });
      }
      if (role === 'OWNER' && entry.ackAt && entry.ackByUid !== uid && entry.recordedByUid === uid) {
        events.push({ at: entry.ackAt, key: `ack-${entry.id}`, title: `${other} confirmed receiving ${money(entry.amount)}`, body: entry.payerName ? `From ${entry.payerName}` : fund.name });
      }
      if (role === 'CUSTODIAN' && entry.flag && entry.flag.byUid !== uid && !entry.flag.resolved) {
        events.push({ at: entry.flag.at, key: `flag-${entry.id}-${entry.flag.at}`, title: `${fund.ownerName} asked about ${money(entry.amount)}`, body: entry.flag.note });
      }
      if (role === 'OWNER' && entry.flag?.repliedAt) {
        events.push({ at: entry.flag.repliedAt, key: `reply-${entry.id}-${entry.flag.repliedAt}`, title: `${other} answered your question`, body: entry.flag.reply || '' });
      }
    }

    const seen = state.seen[fund.id];
    const latest = Math.max(seen || 0, ...events.map(event => event.at));
    // First sight of a fund on this device: remember where we are, alert nothing old.
    if (seen === undefined) { state.seen[fund.id] = latest || Date.now(); return; }
    const fresh = events.filter(event => event.at > seen).sort((a, b) => a.at - b.at);
    for (const event of fresh.slice(-MAX_ALERTS_PER_FUND)) {
      await this.notify(event.title, event.body, fund.id, `fund-${fund.id}-${event.key}`, 'info');
    }
    if (fresh.length > MAX_ALERTS_PER_FUND) {
      await this.notify(`${fresh.length - MAX_ALERTS_PER_FUND} more updates in ${fund.name}`, 'Open the fund to see everything.', fund.id, `fund-${fund.id}-more-${latest}`, 'info');
    }
    state.seen[fund.id] = latest;
  }

  private static async notify(title: string, body: string, fundId: string, sourceKey: string, type: 'info' | 'warning') {
    const meta = { actionType: 'view_funds' as const, inAppType: type, icon: 'briefcase', color: type === 'warning' ? '#f59e0b' : '#0d9488', sourceKey, fundId, channelId: 'finance_alerts' as const };
    try {
      if (await NotificationService.hasPermission()) {
        await NotificationService.showImmediateNotification(title, body, meta);
        return;
      }
    } catch { /* fall through to the in-app inbox */ }
    try {
      await AppNotificationService.addNotification({ title, message: body, type, icon: meta.icon, color: meta.color, actionType: 'view_funds', fundId, sourceKey });
    } catch { /* notifications are best effort */ }
  }
}
