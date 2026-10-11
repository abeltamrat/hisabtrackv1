import type { DraftTransaction } from '@/services/DraftTransactionService';
import type { CommunityGroup, CommunityPosition } from '@/types/community';
import { money, sumMoney } from '@/utils/finance';
import { validateEqubCyclePlan } from '@/utils/equbModel';

export function validateCommunityGroupRecord(group: CommunityGroup): boolean {
  try {
    if (!group?.id || !['EQUB', 'IDDIR'].includes(group.kind) || !group.name?.trim() || !group.accountId || !/^[A-Z]{3}$/.test(group.currency)) return false;
    if (money(group.contributionAmount) <= 0 || !Number.isInteger(group.rounds) || group.rounds < 1 || group.rounds > 600) return false;
    if (!['WEEKLY', 'MONTHLY'].includes(group.frequency) || !['GREGORIAN', 'ETHIOPIAN'].includes(group.calendarSystem) || !Array.isArray(group.schedule) || group.schedule.length !== group.rounds) return false;
    if (group.myTurn !== undefined && (!Number.isInteger(group.myTurn) || group.myTurn < 1 || group.myTurn > group.rounds)) return false;
    if (group.kind === 'EQUB' && group.equb !== undefined) {
      const config = group.equb;
      if (config.schemaVersion !== 2 || !['PERSONAL_TRACKER', 'GROUP_MANAGED'].includes(config.mode) || !config.cycleId) return false;
      if (money(config.baseContributionAmount) <= 0 || !Number.isInteger(config.memberCount) || config.memberCount < 1 || !Number.isInteger(config.totalShares) || config.totalShares < 1 || !Number.isInteger(config.myShares) || config.myShares < 1 || config.myShares > config.totalShares) return false;
      if (config.totalShares !== group.rounds || (config.mode === 'PERSONAL_TRACKER' && money(config.baseContributionAmount * config.myShares) !== money(group.contributionAmount))) return false;
      if (!['FIXED_ORDER', 'LOTTERY', 'NEED_BASED', 'AUCTION', 'HYBRID'].includes(config.allocationMethod) || !['NATIVE_V2', 'MIGRATED', 'REVIEW_REQUIRED'].includes(config.migrationStatus)) return false;
      if (config.mode === 'GROUP_MANAGED' && (!group.equbCycle || group.equbCycle.id !== config.cycleId || !validateEqubCyclePlan(group.equbCycle))) return false;
    }
    if (!Array.isArray(group.members) || new Set(group.members.map(member => member.turn)).size !== group.members.length || group.members.some(member => !member.id || !member.name?.trim() || !Number.isInteger(member.turn) || member.turn < 1 || member.turn > group.rounds)) return false;
    return group.schedule.every(item => !!item.id && Number.isFinite(item.dueDate) && money(item.amountDue) > 0 && money(item.amountPaid) >= 0 && money(item.amountPaid) <= money(item.amountDue) && ['DUE', 'PARTIAL', 'PAID', 'MISSED'].includes(item.status) && Array.isArray(item.transactionIds));
  } catch { return false; }
}

export function communityPosition(group: CommunityGroup): CommunityPosition {
  const contributed = sumMoney(group.schedule.map(item => item.amountPaid));
  const payouts = sumMoney(group.payouts.map(item => item.amount));
  const fees = sumMoney([...group.payouts.map(item => item.fee), ...group.schedule.map(item => item.feePaid || 0)]);
  const remainingScheduled = sumMoney(group.schedule.map(item => Math.max(0, money(item.amountDue - item.amountPaid))));
  const claim = group.kind === 'EQUB' || group.recoverable ? money(contributed - payouts) : 0;
  return {
    contributed,
    payouts,
    fees,
    claim,
    remainingScheduled,
    outstandingObligation: money(Math.max(remainingScheduled, -claim)),
    missed: group.schedule.filter(item => item.status === 'MISSED').length,
  };
}

export interface CommunitySmsMatch { groupId: string; scheduleId?: string; kind: 'CONTRIBUTION' | 'PAYOUT'; score: number; reasons: string[] }

export function matchCommunitySms(draft: DraftTransaction, groups: CommunityGroup[]): CommunitySmsMatch[] {
  const text = `${draft.raw_sms} ${draft.description} ${draft.sender_receiver || ''}`.toLowerCase();
  return groups.filter(group => group.status === 'ACTIVE' && group.accountId === draft.account_id).flatMap(group => {
    if (group.schedule.some(item => item.smsDraftIds?.includes(draft.id)) || (group.payouts || []).some(item => item.smsDraftId === draft.id)) return [];
    const keyword = group.kind.toLowerCase();
    const nameHit = group.name.trim().length > 2 && text.includes(group.name.trim().toLowerCase());
    const keywordHit = text.includes(keyword);
    const tolerance = Math.max(1, draft.amount * 0.01);
    const due = group.schedule.find(item => item.status !== 'PAID' && Math.abs(item.amountDue - item.amountPaid - draft.amount) <= tolerance && Math.abs(item.dueDate - draft.date) <= 7 * 86400000);
    const payoutHit = draft.type === 'INCOME' && !!group.payoutAmount && Math.abs(group.payoutAmount - draft.amount) <= tolerance;
    const contributionHit = draft.type === 'EXPENSE' && (!!due || Math.abs(group.contributionAmount - draft.amount) <= tolerance);
    if (!payoutHit && !contributionHit) return [];
    const reasons = [nameHit ? 'group name' : '', keywordHit ? keyword : '', due ? 'amount and due date' : 'amount'].filter(Boolean);
    const score = (nameHit ? 35 : 0) + (keywordHit ? 25 : 0) + (due ? 35 : 15) + (payoutHit ? 20 : 0);
    return [{ groupId: group.id, scheduleId: contributionHit ? due?.id : undefined, kind: payoutHit ? 'PAYOUT' as const : 'CONTRIBUTION' as const, score, reasons }];
  }).sort((a, b) => b.score - a.score);
}
