import Storage from '@/services/SessionStorage';
import { getDatabase } from '@/services/database';
import { NotificationService } from '@/services/NotificationService';
import type { CommunityFrequency, CommunityGroup, CommunityGroupKind, CommunityScheduleItem, CommunitySnapshot } from '@/types/community';
import type { CalendarSystem } from '@/utils/ethiopianCalendar';
import { advanceEthiopianDate } from '@/utils/ethiopianCalendar';
import { advanceDate, money } from '@/utils/finance';
import { createSerialQueue } from '@/utils/asyncLock';
import { generateUUID } from '@/utils/uuid';
import { validateCommunityGroupRecord } from '@/utils/communityFinance';
import { communityCopy } from '@/utils/communityCopy';

const STORAGE_KEY = 'community_groups_v1';
const mutate = createSerialQueue();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const snapshot = (group: CommunityGroup): CommunitySnapshot => ({ schedule: clone(group.schedule), payouts: clone(group.payouts), status: group.status });
const advance = (calendar: Exclude<CalendarSystem, 'BOTH'>, frequency: CommunityFrequency, timestamp: number, anchor: number) =>
  calendar === 'ETHIOPIAN' ? advanceEthiopianDate(frequency, timestamp, anchor) : advanceDate(frequency, timestamp, anchor);

export interface CreateCommunityGroupInput {
  kind: CommunityGroupKind;
  name: string;
  currency: string;
  accountId: string;
  contributionAmount: number;
  frequency: CommunityFrequency;
  startDate: number;
  rounds: number;
  myTurn?: number;
  payoutAmount?: number;
  recoverable?: boolean;
  calendarSystem?: Exclude<CalendarSystem, 'BOTH'>;
  reminderEnabled?: boolean;
  reminderDaysBefore?: number;
  members?: Array<{ name: string; turn: number; phone?: string }>;
}

export class CommunityGroupService {
  static async getAll(): Promise<CommunityGroup[]> {
    const raw = await Storage.getItem(STORAGE_KEY);
    const groups: CommunityGroup[] = raw ? JSON.parse(raw) : [];
    let changed = false;
    const now = Date.now();
    for (const group of groups) for (const item of group.schedule) {
      if (item.status === 'DUE' && item.dueDate < now && item.amountPaid === 0) { item.status = 'MISSED'; changed = true; }
      else if (item.status === 'PARTIAL' && item.dueDate < now) { item.status = 'MISSED'; changed = true; }
    }
    if (changed) await Storage.setItem(STORAGE_KEY, JSON.stringify(groups));
    return groups;
  }

  private static async write(groups: CommunityGroup[]) { await Storage.setItem(STORAGE_KEY, JSON.stringify(groups)); }

  static validate(group: CommunityGroup) {
    if (!validateCommunityGroupRecord(group)) throw new Error('Invalid community group');
  }

  static async create(input: CreateCommunityGroupInput): Promise<CommunityGroup> {
    return mutate(async () => {
      const amount = money(input.contributionAmount), rounds = Math.floor(input.rounds);
      const calendar = input.calendarSystem || 'GREGORIAN';
      const schedule: CommunityScheduleItem[] = [];
      let dueDate = input.startDate;
      for (let index = 0; index < rounds; index += 1) {
        schedule.push({ id: generateUUID(), dueDate, amountDue: amount, amountPaid: 0, status: 'DUE', transactionIds: [] });
        dueDate = advance(calendar, input.frequency, dueDate, input.startDate);
      }
      const now = Date.now();
      const group: CommunityGroup = {
        id: generateUUID(), kind: input.kind, name: input.name.trim(), currency: input.currency, accountId: input.accountId,
        contributionAmount: amount, frequency: input.frequency, startDate: input.startDate, rounds,
        myTurn: input.myTurn, payoutDate: input.myTurn ? schedule[input.myTurn - 1]?.dueDate : undefined,
        payoutAmount: input.payoutAmount ? money(input.payoutAmount) : input.kind === 'EQUB' ? money(amount * rounds) : undefined,
        recoverable: input.kind === 'EQUB' || !!input.recoverable, calendarSystem: calendar,
        reminderEnabled: !!input.reminderEnabled, reminderDaysBefore: Math.max(0, Math.min(30, Math.floor(input.reminderDaysBefore || 0))),
        members: (input.members || []).map(member => ({ ...member, id: generateUUID(), name: member.name.trim() })).filter(member => member.name),
        schedule, payouts: [], audit: [], status: 'ACTIVE', createdAt: now, updatedAt: now,
      };
      this.validate(group);
      const all = await this.getAll();
      await this.write([...all, group]);
      await this.scheduleNextReminder(group);
      return group;
    });
  }

  private static async scheduleNextReminder(group: CommunityGroup) {
    if (!group.reminderEnabled) return;
    const item = group.schedule.find(row => (row.status === 'DUE' || row.status === 'PARTIAL') && row.dueDate >= Date.now());
    if (!item || item.notificationId) return;
    const trigger = new Date(item.dueDate);
    trigger.setDate(trigger.getDate() - group.reminderDaysBefore);
    trigger.setHours(9, 0, 0, 0);
    const language = (await import('@/contexts/AppSettingsContext')).loadStoredAppSettings().then(settings => settings.language).catch(() => 'en');
    const selectedLanguage = await language;
    item.notificationId = await NotificationService.scheduleOneTimeReminder(
      `${group.kind === 'EQUB' ? 'Equb' : 'Iddir'} ${communityCopy(selectedLanguage, 'reminderTitle')}`,
      `${group.name}: ${group.currency} ${(item.amountDue - item.amountPaid).toFixed(2)} ${communityCopy(selectedLanguage, 'reminderBody')}.`, trigger,
      { actionType: 'view_community', communityGroupId: group.id, inAppType: 'warning', icon: 'users', color: '#0d9488' }
    ) || undefined;
    const all = await this.getAll(); const index = all.findIndex(row => row.id === group.id);
    if (index >= 0) { all[index] = group; await this.write(all); }
  }

  static async recordContribution(groupId: string, scheduleId: string, amount: number, fee = 0, date = Date.now()) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId);
      if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), item = group.schedule.find(row => row.id === scheduleId);
      if (group.status !== 'ACTIVE') throw new Error('Reopen this group before recording another contribution');
      if (!item) throw new Error('Contribution period not found');
      const paid = money(amount), charge = money(fee), remaining = money(item.amountDue - item.amountPaid);
      if (paid <= 0 || paid > remaining) throw new Error(`Contribution must be between 0.01 and ${remaining.toFixed(2)}`);
      if (charge < 0) throw new Error('Fee cannot be negative');
      const before = snapshot(group), eventId = generateUUID(), db = await getDatabase(), transactionIds: string[] = [];
      try {
        const principal = await db.createTransaction({ account_id: group.accountId, type: 'EXPENSE', amount: paid, category: `${group.kind === 'EQUB' ? 'Equb Savings' : 'Iddir Contribution'}`, description: `${group.name} contribution`, date, purpose: group.kind === 'EQUB' || group.recoverable ? 'FINANCING' : 'OPERATING', operation_id: `community-${group.id}-${eventId}-principal`, community_group_id: group.id, community_event_id: eventId });
        transactionIds.push(principal.id);
        if (charge) {
          const feeTx = await db.createTransaction({ account_id: group.accountId, type: 'EXPENSE', amount: charge, category: 'Bank Fees', description: `${group.name} contribution fee`, date, purpose: 'OPERATING', operation_id: `community-${group.id}-${eventId}-fee`, community_group_id: group.id, community_event_id: eventId });
          transactionIds.push(feeTx.id);
        }
        item.amountPaid = money(item.amountPaid + paid); item.feePaid = money((item.feePaid || 0) + charge); item.transactionIds.push(...transactionIds);
        item.status = item.amountPaid >= item.amountDue ? 'PAID' : 'PARTIAL';
        if (item.status === 'PAID' && item.notificationId) { await NotificationService.cancelNotification(item.notificationId); item.notificationId = undefined; }
        group.audit.push({ id: eventId, at: Date.now(), action: 'CONTRIBUTION', description: `${group.currency} ${paid.toFixed(2)} contribution${charge ? ` + ${charge.toFixed(2)} fee` : ''}`, transactionIds, before });
        group.updatedAt = Date.now(); if (group.schedule.every(row => row.status === 'PAID') && (group.kind === 'IDDIR' || group.payouts.length > 0)) group.status = 'COMPLETED';
        all[index] = group; await this.write(all); await this.scheduleNextReminder(group);
        return group;
      } catch (error) { await Promise.all(transactionIds.map(id => db.deleteTransaction(id, true))); throw error; }
    });
  }

  static async recordPayout(groupId: string, amount: number, fee = 0, date = Date.now()) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId);
      if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), payoutAmount = money(amount), charge = money(fee);
      if (group.status !== 'ACTIVE') throw new Error('Reopen this group before recording another payout');
      if (payoutAmount <= 0 || charge < 0) throw new Error('Enter a positive payout and a non-negative fee');
      if (group.kind === 'EQUB' && group.payoutAmount && money(group.payouts.reduce((sum, payout) => sum + payout.amount, 0) + payoutAmount) > group.payoutAmount) throw new Error('Payout exceeds the expected Equb amount');
      const before = snapshot(group), eventId = generateUUID(), db = await getDatabase(), transactionIds: string[] = [];
      try {
        const principal = await db.createTransaction({ account_id: group.accountId, type: 'INCOME', amount: payoutAmount, category: `${group.kind === 'EQUB' ? 'Equb Payout' : 'Iddir Benefit'}`, description: `${group.name} payout`, date, purpose: group.kind === 'EQUB' || group.recoverable ? 'FINANCING' : 'OPERATING', operation_id: `community-${group.id}-${eventId}-payout`, community_group_id: group.id, community_event_id: eventId });
        transactionIds.push(principal.id);
        if (charge) {
          const feeTx = await db.createTransaction({ account_id: group.accountId, type: 'EXPENSE', amount: charge, category: 'Bank Fees', description: `${group.name} payout fee`, date, purpose: 'OPERATING', operation_id: `community-${group.id}-${eventId}-fee`, community_group_id: group.id, community_event_id: eventId });
          transactionIds.push(feeTx.id);
        }
        group.payouts.push({ id: eventId, date, amount: payoutAmount, fee: charge, transactionIds });
        group.audit.push({ id: eventId, at: Date.now(), action: 'PAYOUT', description: `${group.currency} ${payoutAmount.toFixed(2)} payout${charge ? ` - ${charge.toFixed(2)} fee` : ''}`, transactionIds, before });
        if (group.schedule.every(row => row.status === 'PAID')) group.status = 'COMPLETED';
        group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group;
      } catch (error) { await Promise.all(transactionIds.map(id => db.deleteTransaction(id, true))); throw error; }
    });
  }

  static async markMissed(groupId: string, scheduleId: string) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), item = group.schedule.find(row => row.id === scheduleId); if (!item || item.status === 'PAID') throw new Error('Open contribution not found');
      const before = snapshot(group), id = generateUUID(); item.status = 'MISSED'; if (item.notificationId) { await NotificationService.cancelNotification(item.notificationId); item.notificationId = undefined; }
      group.audit.push({ id, at: Date.now(), action: 'MISSED', description: 'Contribution marked missed', transactionIds: [], before }); group.updatedAt = Date.now();
      all[index] = group; await this.write(all); await this.scheduleNextReminder(group); return group;
    });
  }

  static async setDefaulted(groupId: string, defaulted: boolean) {
    return mutate(async () => { const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found'); const group = clone(all[index]), before = snapshot(group), id = generateUUID(); group.status = defaulted ? 'DEFAULTED' : 'ACTIVE'; group.audit.push({ id, at: Date.now(), action: 'CORRECTION', description: defaulted ? 'Group marked defaulted' : 'Group reopened', transactionIds: [], before }); group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group; });
  }

  static async linkRecordedSms(groupId: string, scheduleId: string | undefined, draftId: string, kind: 'CONTRIBUTION' | 'PAYOUT') {
    return mutate(async () => {
      const drafts = await (await import('./DraftTransactionService')).DraftTransactionService.getAll();
      const draft = drafts.find(row => row.id === draftId);
      if (!draft || draft.status !== 'RECORDED' || !draft.matched_transaction_id) throw new Error('Record the SMS transaction before linking it');
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), db = await getDatabase(), old = await db.getTransactionById(draft.matched_transaction_id);
      if (group.status !== 'ACTIVE') throw new Error('Reopen this group before linking an SMS');
      if (!old || old.account_id !== group.accountId || old.type !== (kind === 'PAYOUT' ? 'INCOME' : 'EXPENSE')) throw new Error('The recorded SMS does not match this group account and direction');
      const before = snapshot(group), eventId = generateUUID(), createdTransactionIds: string[] = [];
      const purpose = group.kind === 'EQUB' || group.recoverable ? 'FINANCING' : 'OPERATING';
      try {
        const grossFee = old.type === 'EXPENSE' ? money((old.gross_amount ?? old.amount) - old.amount) : 0;
        await db.updateTransaction(old.id, { purpose, category: kind === 'PAYOUT' ? `${group.kind === 'EQUB' ? 'Equb Payout' : 'Iddir Benefit'}` : `${group.kind === 'EQUB' ? 'Equb Savings' : 'Iddir Contribution'}`, description: `${group.name} ${kind.toLowerCase()} (SMS)`, gross_amount: undefined, community_group_id: group.id, community_event_id: eventId } as any, true);
        if (grossFee > 0) {
          const feeTx = await db.createTransaction({ account_id: group.accountId, type: 'EXPENSE', amount: grossFee, category: 'Bank Fees', description: `${group.name} SMS bank charges`, date: old.date, purpose: 'OPERATING', operation_id: `community-${group.id}-${eventId}-sms-fee`, community_group_id: group.id, community_event_id: eventId });
          createdTransactionIds.push(feeTx.id);
        }
        if (kind === 'CONTRIBUTION') {
          const item = group.schedule.find(row => row.id === scheduleId); if (!item) throw new Error('Contribution period not found');
          const remaining = money(item.amountDue - item.amountPaid); if (old.amount > remaining) throw new Error('SMS amount exceeds this contribution balance');
          item.amountPaid = money(item.amountPaid + old.amount); item.feePaid = money((item.feePaid || 0) + grossFee); item.status = item.amountPaid >= item.amountDue ? 'PAID' : 'PARTIAL'; if (item.status === 'PAID' && item.notificationId) { await NotificationService.cancelNotification(item.notificationId); item.notificationId = undefined; } item.transactionIds.push(old.id, ...createdTransactionIds); item.smsDraftIds = [...(item.smsDraftIds || []), draft.id];
        } else {
          if (group.kind === 'EQUB' && group.payoutAmount && money(group.payouts.reduce((sum, payout) => sum + payout.amount, 0) + old.amount) > group.payoutAmount) throw new Error('Payout exceeds the expected Equb amount');
          group.payouts.push({ id: eventId, date: old.date, amount: old.amount, fee: grossFee, transactionIds: [old.id, ...createdTransactionIds], smsDraftId: draft.id });
        }
        group.audit.push({ id: eventId, at: Date.now(), action: 'SMS_LINK', description: `Linked SMS ${kind.toLowerCase()} of ${group.currency} ${old.amount.toFixed(2)}`, transactionIds: [old.id, ...createdTransactionIds], createdTransactionIds, linkedTransactionBefore: old, before });
        if (group.schedule.every(row => row.status === 'PAID') && (group.kind === 'IDDIR' || group.payouts.length > 0)) group.status = 'COMPLETED';
        group.updatedAt = Date.now(); all[index] = group; await this.write(all); await this.scheduleNextReminder(group); return group;
      } catch (error) {
        for (const id of createdTransactionIds) await db.deleteTransaction(id, true);
        const current = await db.getTransactionById(old.id); if (current?.community_group_id === group.id) await db.updateTransaction(old.id, old, true);
        throw error;
      }
    });
  }

  static async undoLast(groupId: string) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), entry = [...group.audit].reverse().find(row => !row.undone && row.action !== 'UNDO'); if (!entry) throw new Error('Nothing to undo');
      const db = await getDatabase();
      await Promise.all(group.schedule.map(item => item.notificationId ? NotificationService.cancelNotification(item.notificationId) : Promise.resolve()).filter(Boolean));
      for (const id of entry.createdTransactionIds || entry.transactionIds) await db.deleteTransaction(id, true);
      if (entry.linkedTransactionBefore) await db.updateTransaction(entry.linkedTransactionBefore.id, entry.linkedTransactionBefore, true);
      entry.undone = true; group.schedule = clone(entry.before.schedule).map(item => ({ ...item, notificationId: undefined })); group.payouts = clone(entry.before.payouts); group.status = entry.before.status;
      group.audit.push({ id: generateUUID(), at: Date.now(), action: 'UNDO', description: `Undid: ${entry.description}`, transactionIds: [], before: snapshot(group) }); group.updatedAt = Date.now();
      all[index] = group; await this.write(all); await this.scheduleNextReminder(group); return group;
    });
  }

  static async remove(groupId: string) {
    return mutate(async () => { const all = await this.getAll(), group = all.find(row => row.id === groupId); if (!group) return; if (group.audit.some(row => row.transactionIds.length && !row.undone)) throw new Error('Undo posted entries before deleting this group'); await this.write(all.filter(row => row.id !== groupId)); });
  }

  static async replaceAll(groups: CommunityGroup[]) { groups.forEach(group => this.validate(group)); await this.write(groups); }
}
