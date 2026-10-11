import { CommunityGroupService } from '@/services/CommunityGroupService';
import { getDatabase } from '@/services/database';
import RecipientIdentityService, { type RecipientProfile } from '@/services/RecipientIdentityService';
import type { Loan, RecurringTransaction, Transaction } from '@/types/database';

export type PeopleMovement = Transaction & {
  people_source?: 'LEDGER' | 'MANAGED_EQUB';
};

export interface PeopleCommunityRelation {
  groupId: string;
  name: string;
  kind: 'EQUB' | 'IDDIR';
  status: string;
  memberName: string;
  shareCount: number;
  contributed: number;
  payouts: number;
  refunds: number;
}

export interface PeopleFundRelation {
  fundId: string;
  name: string;
  fundType?: string;
  sent: number;
  received: number;
  movementCount: number;
}

export interface PeopleDossier {
  movements: PeopleMovement[];
  loans: Loan[];
  recurring: RecurringTransaction[];
  communities: PeopleCommunityRelation[];
  funds: PeopleFundRelation[];
}

/**
 * Rebuilds relationship movements from the current records instead of caching
 * totals. Managed Equb cash is included as a relationship movement even though
 * it deliberately does not change the organizer's personal account balance.
 */
export default class PeopleFinancialService {
  private static matches(profile: RecipientProfile, profiles: RecipientProfile[], personId?: string, name?: string): boolean {
    const candidate: Transaction = { id: 'candidate', account_id: 'candidate', type: 'EXPENSE', amount: 1, category: 'Candidate', description: '', date: 1, person_id: personId, sender_receiver: name };
    return RecipientIdentityService.unifiedHistory(profile, [candidate], profiles).length === 1;
  }

  static async getAllMovements(): Promise<PeopleMovement[]> {
    const [transactions, groups] = await Promise.all([
      getDatabase().then(database => database.getTransactions()),
      CommunityGroupService.getAll(),
    ]);
    const movements: PeopleMovement[] = transactions.map(transaction => ({ ...transaction, people_source: 'LEDGER' }));

    for (const group of groups) {
      const cycle = group.equb?.mode === 'GROUP_MANAGED' ? group.equbCycle : undefined;
      if (!cycle) continue;
      const memberById = new Map(cycle.members.map(member => [member.id, member]));

      for (const payment of cycle.contributionPayments) {
        if (payment.status === 'REVERSED' || payment.status === 'VOIDED') continue;
        const member = memberById.get(payment.memberId);
        const personId = payment.payerPersonId || member?.personId;
        const name = payment.payerName || member?.name;
        movements.push({
          id: `people-community-payment-${group.id}-${payment.id}`,
          account_id: group.accountId,
          type: 'INCOME',
          amount: payment.amount,
          category: 'Equb Contribution',
          description: `${group.name} contribution received`,
          sender_receiver: name,
          person_id: personId,
          person_name_snapshot: personId ? name : undefined,
          person_link_source: personId ? 'MANUAL' : undefined,
          date: payment.date,
          purpose: 'FINANCING',
          community_group_id: group.id,
          community_event_id: payment.id,
          people_source: 'MANAGED_EQUB',
        });
      }

      for (const payout of cycle.managedPayouts) {
        if (payout.status === 'REVERSED') continue;
        const member = memberById.get(payout.memberId);
        movements.push({
          id: `people-community-payout-${group.id}-${payout.id}`,
          account_id: group.accountId,
          type: 'EXPENSE',
          amount: payout.netAmount,
          category: 'Equb Payout',
          description: `${group.name} payout`,
          sender_receiver: member?.name,
          person_id: member?.personId,
          person_name_snapshot: member?.personId ? member.name : undefined,
          person_link_source: member?.personId ? 'MANUAL' : undefined,
          date: payout.date,
          purpose: 'FINANCING',
          community_group_id: group.id,
          community_event_id: payout.id,
          people_source: 'MANAGED_EQUB',
        });
      }

      for (const refund of cycle.creditRefunds) {
        const member = memberById.get(refund.memberId);
        movements.push({
          id: `people-community-refund-${group.id}-${refund.id}`,
          account_id: group.accountId,
          type: 'EXPENSE',
          amount: refund.amount,
          category: 'Equb Credit Refund',
          description: `${group.name} member credit refund`,
          sender_receiver: member?.name,
          person_id: member?.personId,
          person_name_snapshot: member?.personId ? member.name : undefined,
          person_link_source: member?.personId ? 'MANUAL' : undefined,
          date: refund.date,
          purpose: 'FINANCING',
          community_group_id: group.id,
          community_event_id: refund.id,
          people_source: 'MANAGED_EQUB',
        });
      }
    }
    return movements;
  }

  static async getDossier(
    profile: RecipientProfile,
    profiles: RecipientProfile[],
    knownMovements?: PeopleMovement[],
    knownFunds: Array<{ id: string; name: string; fundType?: string }> = [],
    knownRecurring: RecurringTransaction[] = [],
  ): Promise<PeopleDossier> {
    const [movements, database, groups] = await Promise.all([
      knownMovements ? Promise.resolve(knownMovements) : this.getAllMovements(),
      getDatabase(),
      CommunityGroupService.getAll(),
    ]);
    const loans = (await database.getLoans()).filter(loan => this.matches(profile, profiles, loan.person_id, loan.person_name_snapshot || loan.lender_borrower_name));
    const matchingRecurring = knownRecurring.filter(rule => rule.type !== 'TRANSFER' && this.matches(profile, profiles, rule.person_id, rule.person_name_snapshot || rule.name));
    const personMovements = RecipientIdentityService.unifiedHistory(profile, movements, profiles).filter(item => item.type !== 'TRANSFER');

    const communities: PeopleCommunityRelation[] = [];
    for (const group of groups) {
      const cycle = group.equbCycle;
      if (cycle) for (const member of cycle.members) {
        if (!this.matches(profile, profiles, member.personId, member.name)) continue;
        const validPayments = cycle.contributionPayments.filter(item => item.memberId === member.id && item.status !== 'REVERSED' && item.status !== 'VOIDED');
        const validPayouts = cycle.managedPayouts.filter(item => item.memberId === member.id && item.status !== 'REVERSED');
        communities.push({
          groupId: group.id, name: group.name, kind: group.kind, status: group.status,
          memberName: member.name, shareCount: member.shareCount,
          contributed: validPayments.reduce((sum, item) => sum + item.amount, 0),
          payouts: validPayouts.reduce((sum, item) => sum + item.netAmount, 0),
          refunds: cycle.creditRefunds.filter(item => item.memberId === member.id).reduce((sum, item) => sum + item.amount, 0),
        });
      }
      if (!cycle) for (const member of group.members) if (this.matches(profile, profiles, member.personId, member.name)) {
        communities.push({ groupId: group.id, name: group.name, kind: group.kind, status: group.status, memberName: member.name, shareCount: member.shareCount || 1, contributed: 0, payouts: 0, refunds: 0 });
      }
    }

    const fundsById = new Map(knownFunds.map(fund => [fund.id, fund]));
    const fundRows = new Map<string, PeopleFundRelation>();
    for (const movement of personMovements.filter(item => item.fund_id)) {
      const fundId = movement.fund_id!;
      const fund = fundsById.get(fundId), current = fundRows.get(fundId) || { fundId, name: fund?.name || 'Shared fund', fundType: fund?.fundType, sent: 0, received: 0, movementCount: 0 };
      if (movement.type === 'EXPENSE') current.sent += movement.amount;
      if (movement.type === 'INCOME') current.received += movement.amount;
      current.movementCount += 1; fundRows.set(fundId, current);
    }

    return { movements, loans, recurring: matchingRecurring, communities, funds: [...fundRows.values()] };
  }
}
