import Storage from '@/services/SessionStorage';
import { getDatabase } from '@/services/database';
import { NotificationService } from '@/services/NotificationService';
import type { CommunityFrequency, CommunityGroup, CommunityGroupKind, CommunityScheduleItem, CommunitySnapshot, EqubAllocationMethod, EqubMode } from '@/types/community';
import type { CalendarSystem } from '@/utils/ethiopianCalendar';
import { advanceEthiopianDate } from '@/utils/ethiopianCalendar';
import { advanceDate, money } from '@/utils/finance';
import { createSerialQueue } from '@/utils/asyncLock';
import { generateUUID } from '@/utils/uuid';
import { validateCommunityGroupRecord } from '@/utils/communityFinance';
import { communityCopy } from '@/utils/communityCopy';
import { migrateLegacyEqub } from '@/utils/equbModel';
import { createEqubCyclePlan } from '@/utils/equbModel';
import LocalChangeEmitter from '@/services/LocalChangeEmitter';

const STORAGE_KEY = 'community_groups_v1';
const mutate = createSerialQueue();
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
const snapshot = (group: CommunityGroup): CommunitySnapshot => ({ schedule: clone(group.schedule), payouts: clone(group.payouts), status: group.status, equbCycle: group.equbCycle ? clone(group.equbCycle) : undefined });
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
  members?: Array<{ name: string; turn: number; personId?: string; phone?: string; shareCount?: number }>;
  equbMode?: EqubMode;
  baseContributionAmount?: number;
  myShares?: number;
  totalShares?: number;
  allocationMethod?: EqubAllocationMethod;
  penaltyRule?: { graceDays?: number; type?: 'NONE' | 'FIXED' | 'PERCENTAGE'; value?: number };
}

export class CommunityGroupService {
  static async getAll(): Promise<CommunityGroup[]> {
    const raw = await Storage.getItem(STORAGE_KEY);
    const stored: CommunityGroup[] = raw ? JSON.parse(raw) : [];
    const groups = stored.map(group => migrateLegacyEqub(group).group);
    let changed = groups.some((group, index) => group !== stored[index]);
    const now = Date.now();
    for (const group of groups) for (const item of group.schedule) {
      if (item.status === 'DUE' && item.dueDate < now && item.amountPaid === 0) { item.status = 'MISSED'; changed = true; }
      else if (item.status === 'PARTIAL' && item.dueDate < now) { item.status = 'MISSED'; changed = true; }
    }
    if (changed) await Storage.setItem(STORAGE_KEY, JSON.stringify(groups));
    return groups;
  }

  private static async write(groups: CommunityGroup[]) { await Storage.setItem(STORAGE_KEY, JSON.stringify(groups)); LocalChangeEmitter.emit(); }

  static validate(group: CommunityGroup) {
    if (!validateCommunityGroupRecord(group)) throw new Error('Invalid community group');
  }

  static async create(input: CreateCommunityGroupInput): Promise<CommunityGroup> {
    return mutate(async () => {
      const baseAmount = money(input.baseContributionAmount ?? input.contributionAmount);
      const myShares = input.kind === 'EQUB' ? Math.floor(input.myShares || 1) : 1;
      const mode = input.equbMode || 'PERSONAL_TRACKER';
      const cycleId = generateUUID();
      const managedMembers = (input.members || []).map((member, index) => ({
        id: `member-${cycleId}-${index + 1}`, name: member.name, ...(member.personId ? { personId: member.personId } : {}), ...(member.phone ? { phone: member.phone } : {}), shareCount: Math.floor(member.shareCount || 1), status: 'ACTIVE' as const,
      }));
      const managedCycle = input.kind === 'EQUB' && mode === 'GROUP_MANAGED' ? createEqubCyclePlan({
        id: cycleId, baseContributionAmount: baseAmount, members: managedMembers, allocationMethod: input.allocationMethod,
        firstDueDate: input.startDate, nextDueDate: current => advance(input.calendarSystem || 'GREGORIAN', input.frequency, current, input.startDate), penaltyRule: input.penaltyRule,
      }) : undefined;
      const amount = input.kind === 'EQUB' ? money(baseAmount * myShares) : money(input.contributionAmount);
      const rounds = input.kind === 'EQUB' ? (managedCycle?.totalShares || Math.floor(input.totalShares || input.rounds)) : Math.floor(input.rounds);
      if (input.kind === 'EQUB' && (baseAmount <= 0 || myShares < 1 || rounds < myShares)) throw new Error('Enter valid Equb share values');
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
        payoutAmount: input.payoutAmount ? money(input.payoutAmount) : input.kind === 'EQUB' ? money(baseAmount * rounds * myShares) : undefined,
        recoverable: input.kind === 'EQUB' || !!input.recoverable, calendarSystem: calendar,
        reminderEnabled: !!input.reminderEnabled, reminderDaysBefore: Math.max(0, Math.min(30, Math.floor(input.reminderDaysBefore || 0))),
        members: (input.members || []).map(member => ({ ...member, shareCount: Math.floor(member.shareCount || 1), id: generateUUID(), name: member.name.trim() })).filter(member => member.name),
        equb: input.kind === 'EQUB' ? {
          schemaVersion: 2, mode, cycleId, baseContributionAmount: baseAmount,
          memberCount: managedCycle?.memberCount || input.members?.length || rounds, totalShares: rounds, myShares,
          allocationMethod: managedCycle?.allocationMethod || input.allocationMethod || (input.myTurn ? 'FIXED_ORDER' : 'LOTTERY'), migrationStatus: 'NATIVE_V2',
        } : undefined,
        equbCycle: managedCycle,
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

  static async recordManagedContribution(groupId: string, memberId: string, amount: number, options: { roundId?: string; date?: number; method?: 'CASH' | 'BANK' | 'TELEBIRR' | 'MPESA' | 'OTHER'; reference?: string; note?: string; payerName?: string; payerPersonId?: string; penaltyAmount?: number } = {}) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId);
      if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle;
      if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      if (group.status !== 'ACTIVE') throw new Error('Reopen this group before recording another contribution');
      if (!cycle.members.some(member => member.id === memberId && member.status === 'ACTIVE')) throw new Error('Active member not found');
      const paid = money(amount), penaltyPaid = money(options.penaltyAmount || 0); if (paid < 0 || penaltyPaid < 0 || money(paid + penaltyPaid) <= 0) throw new Error('Contribution or penalty payment must be positive');
      const roundOrder = new Map(cycle.rounds.map((round, position) => [round.id, position]));
      if (options.roundId && !roundOrder.has(options.roundId)) throw new Error('Round not found');
      const start = options.roundId ? roundOrder.get(options.roundId)! : 0;
      const open = cycle.obligations
        .filter(item => item.memberId === memberId && item.status !== 'PAID' && (roundOrder.get(item.roundId) ?? -1) >= start)
        .sort((a, b) => (roundOrder.get(a.roundId) || 0) - (roundOrder.get(b.roundId) || 0));
      const outstanding = money(open.reduce((sum, item) => sum + item.amountDue - item.amountPaid, 0));
      const before = snapshot(group), allocations: Array<{ obligationId: string; amount: number }> = [];
      let remaining = paid;
      for (const obligation of open) {
        if (remaining <= 0) break;
        const applied = money(Math.min(remaining, money(obligation.amountDue - obligation.amountPaid)));
        obligation.amountPaid = money(obligation.amountPaid + applied);
        obligation.status = obligation.amountPaid >= obligation.amountDue ? 'PAID' : 'PARTIAL';
        allocations.push({ obligationId: obligation.id, amount: applied });
        remaining = money(remaining - applied);
      }
      const id = generateUUID(), date = options.date || Date.now();
      const late = allocations.some(allocation => {
        const obligation = cycle.obligations.find(item => item.id === allocation.obligationId), round = cycle.rounds.find(item => item.id === obligation?.roundId);
        return !!round && round.dueDate < date;
      });
      const credit = cycle.memberCredits.find(item => item.memberId === memberId); if (!credit) throw new Error('Member credit account not found');
      credit.balance = money(credit.balance + remaining);
      let penaltyRemaining = penaltyPaid;
      for (const obligation of cycle.obligations.filter(item => item.memberId === memberId)) {
        if (penaltyRemaining <= 0) break;
        const outstandingPenalty = money(obligation.penaltyDue - obligation.penaltyPaid - obligation.penaltyWaived);
        const applied = money(Math.min(penaltyRemaining, outstandingPenalty)); obligation.penaltyPaid = money(obligation.penaltyPaid + applied); penaltyRemaining = money(penaltyRemaining - applied);
      }
      if (penaltyRemaining > 0) throw new Error('Penalty payment exceeds the outstanding penalty');
      const receiptNumber = `EQB-${group.id.slice(-6).toUpperCase()}-${String(cycle.contributionPayments.length + 1).padStart(4, '0')}`;
      cycle.contributionPayments.push({ id, receiptNumber, memberId, amount: money(paid + penaltyPaid), principalAmount: paid, penaltyAmount: penaltyPaid, date, status: 'VERIFIED', method: options.method, reference: options.reference?.trim() || undefined, note: options.note?.trim() || undefined, payerName: options.payerName?.trim() || undefined, payerPersonId: options.payerPersonId, allocations, unappliedAmount: remaining, late, recordedBy: 'ORGANIZER' });
      group.audit.push({ id, at: Date.now(), action: 'MANAGED_CONTRIBUTION', description: `${group.currency} ${paid.toFixed(2)} contribution${penaltyPaid ? ` + ${penaltyPaid.toFixed(2)} penalty` : ''}`, transactionIds: [], before });
      group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group;
    });
  }

  static async linkManagedMemberPerson(groupId: string, memberId: string, person?: { id: string; displayName: string; phone?: string }) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId);
      if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), member = group.equbCycle?.members.find(row => row.id === memberId);
      if (!member) throw new Error('Member not found');
      const oldName = member.name;
      member.personId = person?.id;
      if (person) { member.name = person.displayName; member.phone = person.phone || member.phone; }
      const legacy = group.members.find(row => row.name === oldName || (row as any).personId === member.personId);
      if (legacy) Object.assign(legacy, { personId: person?.id, ...(person ? { name: person.displayName, phone: person.phone || legacy.phone } : {}) });
      group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group;
    });
  }

  static async refundManagedCredit(groupId: string, memberId: string, amount: number, options: { date?: number; method?: 'CASH' | 'BANK' | 'TELEBIRR' | 'MPESA' | 'OTHER'; reference?: string } = {}) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle; if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      const credit = cycle.memberCredits.find(item => item.memberId === memberId), refund = money(amount);
      if (!credit || refund <= 0 || refund > credit.balance) throw new Error('Refund exceeds the member credit');
      const before = snapshot(group), id = generateUUID(); credit.balance = money(credit.balance - refund);
      cycle.creditRefunds.push({ id, memberId, amount: refund, date: options.date || Date.now(), method: options.method, reference: options.reference?.trim() || undefined });
      group.audit.push({ id, at: Date.now(), action: 'MANAGED_REFUND', description: `${group.currency} ${refund.toFixed(2)} member credit refunded`, transactionIds: [], before });
      group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group;
    });
  }

  static async evaluateManagedOverdue(groupId: string, now = Date.now()) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle; if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      const graceMs = cycle.penaltyRule.graceDays * 86400000;
      const overdueRounds = new Set(cycle.rounds.filter(round => round.dueDate + graceMs < now).map(round => round.id));
      const affected = cycle.obligations.filter(item => overdueRounds.has(item.roundId) && item.status !== 'PAID' && item.status !== 'MISSED');
      if (!affected.length) return group;
      const before = snapshot(group), id = generateUUID(); affected.forEach(item => {
        item.status = 'MISSED';
        if (item.penaltyDue === 0 && cycle.penaltyRule.type !== 'NONE') item.penaltyDue = cycle.penaltyRule.type === 'FIXED' ? money(cycle.penaltyRule.value) : money(item.amountDue * cycle.penaltyRule.value / 100);
      });
      group.audit.push({ id, at: Date.now(), action: 'MANAGED_OVERDUE', description: `${affected.length} share obligation${affected.length === 1 ? '' : 's'} marked missed`, transactionIds: [], before });
      group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group;
    });
  }

  static async waiveManagedPenalty(groupId: string, memberId: string, amount: number, reason: string) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle; if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      let remaining = money(amount); if (remaining <= 0 || !reason.trim()) throw new Error('Enter a waiver amount and reason');
      const available = money(cycle.obligations.filter(item => item.memberId === memberId).reduce((sum, item) => sum + item.penaltyDue - item.penaltyPaid - item.penaltyWaived, 0));
      if (remaining > available) throw new Error('Waiver exceeds the outstanding penalty');
      const before = snapshot(group), id = generateUUID();
      for (const obligation of cycle.obligations.filter(item => item.memberId === memberId)) { const open = money(obligation.penaltyDue - obligation.penaltyPaid - obligation.penaltyWaived), applied = money(Math.min(open, remaining)); obligation.penaltyWaived = money(obligation.penaltyWaived + applied); remaining = money(remaining - applied); if (!remaining) break; }
      group.audit.push({ id, at: Date.now(), action: 'CORRECTION', description: `${group.currency} ${money(amount).toFixed(2)} penalty waived: ${reason.trim()}`, transactionIds: [], before });
      group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group;
    });
  }

  static async addManagedGuarantor(groupId: string, memberId: string, input: { name: string; phone?: string; linkedUid?: string; guaranteedAmount?: number; acknowledged?: boolean }) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle; if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      if (!cycle.members.some(member => member.id === memberId) || !input.name.trim() || money(input.guaranteedAmount || 0) < 0) throw new Error('Enter a valid member and guarantor');
      const before = snapshot(group), id = generateUUID(), now = Date.now();
      cycle.guarantors.push({ id, memberId, name: input.name.trim(), phone: input.phone?.trim() || undefined, linkedUid: input.linkedUid, guaranteedAmount: input.guaranteedAmount ? money(input.guaranteedAmount) : undefined, acknowledgedAt: input.acknowledged ? now : undefined, status: 'ACTIVE', createdAt: now });
      group.audit.push({ id, at: now, action: 'CORRECTION', description: `Guarantor ${input.name.trim()} added`, transactionIds: [], before }); group.updatedAt = now; all[index] = group; await this.write(all); return group;
    });
  }

  static async recordManagedFundingAdjustment(groupId: string, roundId: string, type: 'ORGANIZER_ADVANCE' | 'REDUCED_POT', amount: number, reason: string) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle, value = money(amount); if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      if (!cycle.rounds.some(round => round.id === roundId) || value <= 0 || !reason.trim()) throw new Error('Enter a valid round, amount, and reason');
      const before = snapshot(group), id = generateUUID(), now = Date.now(); cycle.fundingAdjustments.push({ id, roundId, type, amount: value, reason: reason.trim(), date: now });
      group.audit.push({ id, at: now, action: 'CORRECTION', description: `${type === 'ORGANIZER_ADVANCE' ? 'Organizer advance' : 'Reduced pot'} ${group.currency} ${value.toFixed(2)}: ${reason.trim()}`, transactionIds: [], before }); group.updatedAt = now; all[index] = group; await this.write(all); return group;
    });
  }

  static async allocateManagedEntitlement(groupId: string, roundId: string, entitlementId: string) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle; if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      const round = cycle.rounds.find(item => item.id === roundId), entitlement = cycle.payoutEntitlements.find(item => item.id === entitlementId);
      if (!round || round.status !== 'OPEN' || !entitlement || entitlement.status !== 'PENDING') throw new Error('Open round and pending entitlement required');
      if (cycle.payoutEntitlements.some(item => item.position === round.number && item.status !== 'CANCELLED')) throw new Error('This round already has a payout entitlement');
      const before = snapshot(group), id = generateUUID(); entitlement.position = round.number; entitlement.status = 'ALLOCATED';
      group.audit.push({ id, at: Date.now(), action: 'MANAGED_ALLOCATION', description: `Payout entitlement allocated to round ${round.number}`, transactionIds: [], before }); group.updatedAt = Date.now(); all[index] = group; await this.write(all); return group;
    });
  }

  static async recordManagedPayout(groupId: string, roundId: string, input: { bidDiscount?: number; fees?: number; deductions?: number; date?: number; method?: 'CASH' | 'BANK' | 'TELEBIRR' | 'MPESA' | 'OTHER'; reference?: string }) {
    return mutate(async () => {
      const all = await this.getAll(), index = all.findIndex(row => row.id === groupId); if (index < 0) throw new Error('Group not found');
      const group = clone(all[index]), cycle = group.equbCycle; if (group.equb?.mode !== 'GROUP_MANAGED' || !cycle) throw new Error('This is not a managed Equb');
      const round = cycle.rounds.find(item => item.id === roundId); if (!round || round.status !== 'OPEN') throw new Error('Open round not found');
      const entitlement = cycle.payoutEntitlements.find(item => item.position === round.number && item.status === 'ALLOCATED'); if (!entitlement) throw new Error('Allocate a payout entitlement first');
      const collected = money(cycle.obligations.filter(item => item.roundId === roundId).reduce((sum, item) => sum + item.amountPaid, 0));
      const advances = money(cycle.fundingAdjustments.filter(item => item.roundId === roundId && item.type === 'ORGANIZER_ADVANCE').reduce((sum,item)=>sum+item.amount,0));
      const reductions = money(cycle.fundingAdjustments.filter(item => item.roundId === roundId && item.type === 'REDUCED_POT').reduce((sum,item)=>sum+item.amount,0));
      const gross = money(round.expectedPot - reductions), available = money(collected + advances);
      if (gross <= 0 || available < gross) throw new Error(`Round is short by ${group.currency} ${money(gross - available).toFixed(2)}`);
      const bidDiscount = money(input.bidDiscount || 0), fees = money(input.fees || 0), deductions = money(input.deductions || 0);
      if ([bidDiscount, fees, deductions].some(value => value < 0) || money(bidDiscount + fees + deductions) >= gross) throw new Error('Payout deductions are invalid');
      const before = snapshot(group), id = generateUUID(), netAmount = money(gross - bidDiscount - fees - deductions);
      cycle.managedPayouts.push({ id, roundId, entitlementIds:[entitlement.id], memberId:entitlement.memberId, grossAmount:gross, bidDiscount, fees, deductions, netAmount, date:input.date || Date.now(), method:input.method, reference:input.reference?.trim() || undefined, status:'RECORDED' });
      entitlement.status = 'PAID'; round.status = 'CLOSED';
      group.audit.push({ id, at: Date.now(), action:'MANAGED_PAYOUT', description:`${group.currency} ${netAmount.toFixed(2)} managed payout for round ${round.number}`, transactionIds:[], before });
      if (cycle.rounds.every(item => item.status === 'CLOSED')) { cycle.status = 'COMPLETED'; group.status = 'COMPLETED'; }
      group.updatedAt=Date.now(); all[index]=group; await this.write(all); return group;
    });
  }

  static async acknowledgeManagedPayout(groupId: string, payoutId: string, disputed = false) {
    return mutate(async () => { const all=await this.getAll(), index=all.findIndex(row=>row.id===groupId); if(index<0) throw new Error('Group not found'); const group=clone(all[index]), payout=group.equbCycle?.managedPayouts.find(item=>item.id===payoutId); if(!payout || payout.status!=='RECORDED') throw new Error('Recorded payout not found'); const before=snapshot(group), id=generateUUID(); payout.status=disputed?'DISPUTED':'ACKNOWLEDGED'; group.audit.push({id,at:Date.now(),action:'CORRECTION',description:disputed?'Payout disputed':'Payout receipt acknowledged',transactionIds:[],before}); group.updatedAt=Date.now(); all[index]=group; await this.write(all); return group; });
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
      group.equbCycle = entry.before.equbCycle ? clone(entry.before.equbCycle) : group.equbCycle;
      group.audit.push({ id: generateUUID(), at: Date.now(), action: 'UNDO', description: `Undid: ${entry.description}`, transactionIds: [], before: snapshot(group) }); group.updatedAt = Date.now();
      all[index] = group; await this.write(all); await this.scheduleNextReminder(group); return group;
    });
  }

  static async remove(groupId: string) {
    return mutate(async () => { const all = await this.getAll(), group = all.find(row => row.id === groupId); if (!group) return; if (group.audit.some(row => row.transactionIds.length && !row.undone)) throw new Error('Undo posted entries before deleting this group'); await this.write(all.filter(row => row.id !== groupId)); });
  }

  static async replaceAll(groups: CommunityGroup[]) { groups.forEach(group => this.validate(group)); await this.write(groups); }
}
