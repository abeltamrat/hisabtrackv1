import type {
  CommunityGroup,
  EqubAllocationMethod,
  EqubConfigurationV2,
  EqubCycleV2,
  EqubMemberV2,
} from '@/types/community';
import { money, sumMoney } from '@/utils/finance';

export interface EqubCyclePlanInput {
  id?: string;
  cycleNumber?: number;
  baseContributionAmount: number;
  members: Array<Pick<EqubMemberV2, 'id' | 'name'> & Partial<Pick<EqubMemberV2, 'personId' | 'phone' | 'emailHint' | 'linkedUid' | 'notes' | 'joinedAt' | 'leftAt' | 'status'>> & { shareCount: number }>;
  allocationMethod?: EqubAllocationMethod;
  firstDueDate?: number;
  nextDueDate?: (current: number, round: number) => number;
  penaltyRule?: Partial<EqubCycleV2['penaltyRule']>;
}

/** Builds the financial shape of one managed Equb cycle before any money is posted. */
export function createEqubCyclePlan(input: EqubCyclePlanInput): EqubCycleV2 {
  const base = money(input.baseContributionAmount);
  if (base <= 0) throw new Error('Base contribution must be positive');
  if (input.members.length < 2) throw new Error('A managed Equb needs at least two members');
  const ids = new Set<string>();
  const members: EqubMemberV2[] = input.members.map(member => {
    const id = member.id.trim(), name = member.name.trim(), shareCount = Math.floor(member.shareCount);
    if (!id || ids.has(id)) throw new Error('Equb members need unique IDs');
    if (!name || !Number.isInteger(member.shareCount) || shareCount < 1 || shareCount > 1000) throw new Error('Each Equb member needs a name and at least one share');
    ids.add(id);
    return { ...member, id, name, shareCount, status: member.status || 'ACTIVE' };
  });
  const totalShares = members.reduce((sum, member) => sum + member.shareCount, 0);
  if (!Number.isSafeInteger(totalShares) || totalShares > 10000) throw new Error('Equb share count is too large');
  const potPerRound = money(base * totalShares);
  const cycleId = input.id || 'draft-cycle';
  const shares = members.flatMap(member => Array.from({ length: member.shareCount }, (_, index) => ({
    id: `${cycleId}-share-${member.id}-${index + 1}`,
    memberId: member.id,
    shareNumber: index + 1,
    contributionAmount: base,
    status: 'ACTIVE' as const,
  })));
  const payoutEntitlements = shares.map((share, index) => ({
    id: `${cycleId}-entitlement-${index + 1}`,
    shareId: share.id,
    memberId: share.memberId,
    grossAmount: potPerRound,
    status: 'PENDING' as const,
  }));
  let dueDate = input.firstDueDate;
  const rounds = Array.from({ length: totalShares }, (_, index) => {
    const round = { id: `${cycleId}-round-${index + 1}`, number: index + 1, dueDate: dueDate ?? 0, expectedPot: potPerRound, status: 'OPEN' as const };
    if (dueDate !== undefined && input.nextDueDate && index < totalShares - 1) dueDate = input.nextDueDate(dueDate, index + 1);
    return round;
  });
  const obligations = rounds.flatMap(round => shares.map(share => ({
    id: `${round.id}-obligation-${share.id}`,
    roundId: round.id,
    memberId: share.memberId,
    shareId: share.id,
    amountDue: base,
    amountPaid: 0,
    penaltyDue: 0,
    penaltyPaid: 0,
    penaltyWaived: 0,
    status: 'DUE' as const,
  })));
  return {
    id: cycleId,
    number: input.cycleNumber || 1,
    baseContributionAmount: base,
    memberCount: members.length,
    totalShares,
    potPerRound,
    roundCount: totalShares,
    fullCycleValue: money(potPerRound * totalShares),
    allocationMethod: input.allocationMethod || 'FIXED_ORDER',
    members,
    shares,
    payoutEntitlements,
    rounds,
    obligations,
    contributionPayments: [],
    memberCredits: members.map(member => ({ memberId: member.id, balance: 0 })),
    creditRefunds: [],
    penaltyRule: { graceDays: Math.max(0, Math.floor(input.penaltyRule?.graceDays || 0)), type: input.penaltyRule?.type || 'NONE', value: money(input.penaltyRule?.value || 0) },
    guarantors: [],
    fundingAdjustments: [],
    managedPayouts: [],
    status: 'DRAFT',
  };
}

export function validateEqubCyclePlan(cycle: EqubCycleV2): boolean {
  try {
    if (cycle.memberCount !== cycle.members.length || cycle.totalShares !== cycle.shares.length || cycle.roundCount !== cycle.rounds.length) return false;
    if (cycle.payoutEntitlements.length !== cycle.totalShares || money(cycle.potPerRound) !== money(cycle.baseContributionAmount * cycle.totalShares)) return false;
    if (money(cycle.fullCycleValue) !== money(cycle.potPerRound * cycle.roundCount)) return false;
    const memberShares = new Map(cycle.members.map(member => [member.id, member.shareCount]));
    if (sumMoney(cycle.members.map(member => member.shareCount * cycle.baseContributionAmount)) !== cycle.potPerRound) return false;
    if (cycle.shares.some(share => !memberShares.has(share.memberId) || money(share.contributionAmount) !== money(cycle.baseContributionAmount))) return false;
    if (cycle.members.some(member => cycle.shares.filter(share => share.memberId === member.id).length !== member.shareCount)) return false;
    const shareIds = new Set(cycle.shares.map(share => share.id));
    const roundIds = new Set(cycle.rounds.map(round => round.id)), memberIds = new Set(cycle.members.map(member => member.id));
    if (cycle.obligations.length !== cycle.roundCount * cycle.totalShares || !Array.isArray(cycle.contributionPayments) || !Array.isArray(cycle.memberCredits) || !Array.isArray(cycle.creditRefunds)) return false;
    if (!cycle.penaltyRule || !Number.isInteger(cycle.penaltyRule.graceDays) || cycle.penaltyRule.graceDays < 0 || !['NONE','FIXED','PERCENTAGE'].includes(cycle.penaltyRule.type) || money(cycle.penaltyRule.value) < 0 || !Array.isArray(cycle.guarantors) || !Array.isArray(cycle.fundingAdjustments) || !Array.isArray(cycle.managedPayouts)) return false;
    if (cycle.memberCredits.length !== cycle.memberCount || cycle.memberCredits.some(credit => !memberIds.has(credit.memberId) || money(credit.balance) < 0)) return false;
    if (cycle.rounds.some(round => sumMoney(cycle.obligations.filter(item => item.roundId === round.id).map(item => item.amountDue)) !== cycle.potPerRound)) return false;
    if (cycle.obligations.some(item => !roundIds.has(item.roundId) || !memberIds.has(item.memberId) || !shareIds.has(item.shareId) || cycle.shares.find(share => share.id === item.shareId)?.memberId !== item.memberId || money(item.amountDue) !== money(cycle.baseContributionAmount) || money(item.amountPaid) < 0 || money(item.amountPaid) > money(item.amountDue) || money(item.penaltyDue) < 0 || money(item.penaltyPaid) < 0 || money(item.penaltyWaived) < 0 || money(item.penaltyPaid + item.penaltyWaived) > money(item.penaltyDue))) return false;
    return cycle.payoutEntitlements.every(entitlement => shareIds.has(entitlement.shareId)
      && cycle.shares.find(share => share.id === entitlement.shareId)?.memberId === entitlement.memberId
      && money(entitlement.grossAmount) === money(cycle.potPerRound));
  } catch { return false; }
}

/** Adds stable V2 semantics to a Phase 4 record without changing its ledger or schedule. */
export function migrateLegacyEqub(group: CommunityGroup): { group: CommunityGroup; changed: boolean } {
  if (group.kind !== 'EQUB') return { group, changed: false };
  if (group.equb?.schemaVersion === 2) {
    const cycle = group.equbCycle;
    if (!cycle) return { group, changed: false };
    const hasShareLedger = Array.isArray(cycle.obligations) && cycle.obligations.every(item => typeof item.shareId === 'string');
    const hasReceipts = Array.isArray(cycle.contributionPayments) && cycle.contributionPayments.every(item => typeof item.receiptNumber === 'string' && typeof item.unappliedAmount === 'number' && typeof item.late === 'boolean' && typeof item.principalAmount === 'number' && typeof item.penaltyAmount === 'number');
    const hasCredits = Array.isArray(cycle.memberCredits) && Array.isArray(cycle.creditRefunds);
    const hasPenalties = !!cycle.penaltyRule && Array.isArray(cycle.obligations) && cycle.obligations.every(item => typeof item.penaltyDue === 'number');
    const hasRiskRecords = Array.isArray(cycle.guarantors) && Array.isArray(cycle.fundingAdjustments) && Array.isArray(cycle.managedPayouts);
    if (hasShareLedger && hasReceipts && hasCredits && hasPenalties && hasRiskRecords) return { group, changed: false };
    const oldObligations = Array.isArray(cycle.obligations) ? cycle.obligations : [];
    const obligations = hasShareLedger ? cycle.obligations : cycle.rounds.flatMap(round => cycle.shares.map(share => {
      const old = oldObligations.find(item => item.roundId === round.id && item.memberId === share.memberId);
      const siblingPosition = cycle.shares.filter(item => item.memberId === share.memberId).findIndex(item => item.id === share.id);
      const amountPaid = money(Math.max(0, Math.min(cycle.baseContributionAmount, (old?.amountPaid || 0) - cycle.baseContributionAmount * siblingPosition)));
      return { id: `${round.id}-obligation-${share.id}`, roundId: round.id, memberId: share.memberId, shareId: share.id, amountDue: cycle.baseContributionAmount, amountPaid, status: amountPaid >= cycle.baseContributionAmount ? 'PAID' as const : amountPaid > 0 ? 'PARTIAL' as const : 'DUE' as const, penaltyDue: 0, penaltyPaid: 0, penaltyWaived: 0 };
    }));
    const normalizedObligations = obligations.map(item => ({ ...item, penaltyDue: money(item.penaltyDue || 0), penaltyPaid: money(item.penaltyPaid || 0), penaltyWaived: money(item.penaltyWaived || 0) }));
    const contributionPayments = (cycle.contributionPayments || []).map((payment, index) => ({ ...payment, receiptNumber: payment.receiptNumber || `EQB-${group.id.slice(-6).toUpperCase()}-${String(index + 1).padStart(4, '0')}`, allocations: hasShareLedger ? payment.allocations : [], unappliedAmount: money(payment.unappliedAmount || 0), late: !!payment.late, principalAmount: money(payment.principalAmount ?? payment.amount), penaltyAmount: money(payment.penaltyAmount || 0) }));
    const memberCredits = hasCredits ? cycle.memberCredits : cycle.members.map(member => ({ memberId: member.id, balance: sumMoney(contributionPayments.filter(payment => payment.memberId === member.id).map(payment => payment.unappliedAmount)) }));
    return { group: { ...group, equbCycle: { ...cycle, obligations: normalizedObligations, contributionPayments, memberCredits, creditRefunds: hasCredits ? cycle.creditRefunds : [], penaltyRule: cycle.penaltyRule || { graceDays: 0, type: 'NONE', value: 0 }, guarantors: cycle.guarantors || [], fundingAdjustments: cycle.fundingAdjustments || [], managedPayouts: cycle.managedPayouts || [] } }, changed: true };
  }
  const totalShares = Math.max(1, Math.floor(group.rounds));
  const knownShares = group.members.reduce((sum, member) => sum + Math.max(1, Math.floor(member.shareCount || 1)), 0);
  const memberCount = group.members.length || totalShares;
  const needsReview = group.members.length > 0 && knownShares !== totalShares;
  const equb: EqubConfigurationV2 = {
    schemaVersion: 2,
    mode: 'PERSONAL_TRACKER',
    cycleId: `legacy-cycle-${group.id}`,
    baseContributionAmount: money(group.contributionAmount),
    memberCount,
    totalShares,
    myShares: 1,
    allocationMethod: group.myTurn ? 'FIXED_ORDER' : 'LOTTERY',
    migrationStatus: needsReview ? 'REVIEW_REQUIRED' : 'MIGRATED',
  };
  return { group: { ...group, equb }, changed: true };
}
