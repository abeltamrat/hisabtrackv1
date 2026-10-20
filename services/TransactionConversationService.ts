import { completeText, extractJson, type CompletionKeys } from '@/services/AICompletion';
import type { DraftTransaction } from '@/services/DraftTransactionService';
import type { RecipientProfile } from '@/services/RecipientIdentityService';
import type { Account, LoanType, ProjectLink, Transaction, TransactionSplit, TransactionType } from '@/types/database';
import { parseLocaleAmount, parseQuickAdd, type QuickAddCategory } from '@/utils/quickAddParser';

export type ConversationField = 'type' | 'amount' | 'account' | 'destination' | 'recipient' | 'person' | 'category' | 'date' | 'project' | 'loan' | 'splits' | 'evidence' | 'details';
export type ProposalSource = 'USER' | 'AI' | 'SMS' | 'TRANSACTION' | 'DEFAULT';

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: number;
}

export interface TransactionEvidenceCandidate {
  id: string;
  kind: 'SMS' | 'TRANSACTION';
  amount: number;
  date: number;
  type: TransactionType;
  accountId?: string;
  accountName?: string;
  category?: string;
  recipient?: string;
  description: string;
  score: number;
  reasons: string[];
}

export interface ConversationProposal {
  type?: TransactionType;
  amount?: number;
  accountId?: string;
  toAccountId?: string;
  category?: string;
  recipient?: string;
  personId?: string;
  personName?: string;
  description?: string;
  date?: number;
  project?: ProjectLink;
  projectRequested?: boolean;
  loanKind?: LoanType;
  loanDueDate?: number;
  splitIssue?: string;
  personCandidates?: Array<{ id: string; name: string }>;
  tags: string[];
  splits: TransactionSplit[];
  provenance: Partial<Record<Exclude<ConversationField, 'evidence' | 'details'>, ProposalSource>>;
  skipped: ConversationField[];
  selectedEvidence?: TransactionEvidenceCandidate;
}

export interface TransactionConversationState {
  messages: ConversationMessage[];
  proposal: ConversationProposal;
  candidates: TransactionEvidenceCandidate[];
  pendingField: ConversationField;
  question: string;
  ready: boolean;
  provider?: 'toptools' | 'groq' | 'gemini';
}

export interface TransactionConversationScope {
  accounts: Account[];
  categories: QuickAddCategory[];
  transactions: Transaction[];
  smsDrafts: DraftTransaction[];
  currency: string;
  people?: RecipientProfile[];
  projects?: Array<{ id: number; code?: string | null; title: string; status?: string | null; customer?: string | null }>;
}

interface AIFields {
  type?: string;
  amount?: number | string;
  account?: string;
  destinationAccount?: string;
  category?: string;
  recipient?: string;
  person?: string;
  description?: string;
  date?: string;
  tags?: string[];
  project?: string;
  loanKind?: string;
  dueDate?: string;
  splits?: Array<{ amount?: number | string; category?: string; description?: string }>;
}

interface AIReply { fields?: AIFields; reply?: string }

const DAY = 86_400_000;
const normalize = (value: unknown) => String(value || '').toLowerCase().replace(/[^a-z0-9\u1200-\u137f]+/g, ' ').trim();
const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const isSkip = (text: string) => /^(?:skip|none|unknown|i don'?t know|no|done|nothing|አልታወቀም|የለም)[.! ]*$/i.test(text.trim());
const hasExplicitDate = (text: string) => /\b(?:today|yesterday|tomorrow|20\d{2}[-/]\d{1,2}[-/]\d{1,2})\b/i.test(text);

const findAccount = (name: string | undefined, accounts: Account[]) => {
  const needle = normalize(name);
  if (!needle) return undefined;
  const matches = accounts.filter(account => [account.name, account.type.replace('_', ' '), ...(account.aliases || [])]
    .some(label => normalize(label) === needle || normalize(label).includes(needle) || needle.includes(normalize(label))));
  return matches.length === 1 ? matches[0] : undefined;
};

const findCategory = (name: string | undefined, categories: QuickAddCategory[], type?: TransactionType) => {
  const needle = normalize(name);
  if (!needle) return undefined;
  const available = type === 'TRANSFER' ? categories : categories.filter(category => !type || normalize(category.type) === normalize(type));
  const exact = available.find(category => normalize(category.name) === needle);
  if (exact) return exact;
  const matches = available.filter(category => normalize(category.name).includes(needle) || needle.includes(normalize(category.name)));
  return matches.length === 1 ? matches[0] : undefined;
};

const findPeople = (name: string | undefined, people: RecipientProfile[] = []) => {
  const needle = normalize(name);
  if (!needle) return [];
  const exact = people.filter(person => [person.displayName, ...(person.aliases || []), person.phone, person.email]
    .some(value => normalize(value) === needle));
  if (exact.length) return exact;
  return people.filter(person => [person.displayName, ...(person.aliases || [])]
    .some(value => normalize(value).includes(needle) || needle.includes(normalize(value))));
};

const resolvePerson = (proposal: ConversationProposal, scope: TransactionConversationScope, value?: string, source: ProposalSource = 'USER') => {
  const matches = findPeople(value || proposal.recipient, scope.people);
  if (matches.length === 1) {
    proposal.personId = matches[0].id;
    proposal.personName = matches[0].displayName;
    proposal.recipient = matches[0].displayName;
    proposal.personCandidates = undefined;
    proposal.provenance.person = source;
  } else if (matches.length > 1) {
    proposal.personCandidates = matches.slice(0, 5).map(person => ({ id: person.id, name: person.displayName }));
  } else {
    proposal.personCandidates = undefined;
  }
};

const findProject = (value: string | undefined, projects: NonNullable<TransactionConversationScope['projects']>) => {
  const needle = normalize(value);
  if (!needle) return undefined;
  const exact = projects.filter(project => [String(project.id), project.code, project.title]
    .some(label => normalize(label) === needle));
  if (exact.length === 1) return exact[0];
  const partial = projects.filter(project => [project.code, project.title, project.customer]
    .some(label => normalize(label).includes(needle) || needle.includes(normalize(label))));
  return partial.length === 1 ? partial[0] : undefined;
};

const asProjectLink = (project: NonNullable<TransactionConversationScope['projects']>[number]): ProjectLink => ({
  source: 'mela', id: project.id, ...(project.code ? { code: project.code } : {}), title: project.title,
});

const parseDueDate = (text: string, now = new Date()) => {
  if (/\btomorrow\b/i.test(text)) { const date = new Date(now); date.setDate(date.getDate() + 1); return date.getTime(); }
  if (/\bnext week\b/i.test(text)) { const date = new Date(now); date.setDate(date.getDate() + 7); return date.getTime(); }
  if (/\bnext month\b/i.test(text)) { const date = new Date(now); date.setMonth(date.getMonth() + 1); return date.getTime(); }
  return parseDateAnswer(text, now);
};

const loanKindFromText = (text: string, type?: TransactionType): LoanType | undefined => {
  if (/\b(?:lent|loaned|gave (?:him|her|them|a )?loan|loan given)\b/i.test(text)) return 'LENT';
  if (/\b(?:borrowed|received (?:a )?loan|loan received|credit disbursement)\b/i.test(text)) return 'BORROWED';
  if (/\bloan\b/i.test(text)) return type === 'INCOME' ? 'BORROWED' : type === 'EXPENSE' ? 'LENT' : undefined;
  return undefined;
};

const normalizeSplits = (rows: AIFields['splits'], proposal: ConversationProposal, scope: TransactionConversationScope) => {
  if (!rows?.length || !proposal.amount || !proposal.type || proposal.type === 'TRANSFER') return undefined;
  const splits = rows.map((row, index) => {
    const amount = typeof row.amount === 'number' ? row.amount : parseLocaleAmount(String(row.amount || ''));
    const category = findCategory(row.category, scope.categories, proposal.type)?.name || '';
    return { id: `conversation-${Date.now()}-${index}`, amount: Math.round(Number(amount || 0) * 100) / 100, category, description: row.description?.trim() };
  });
  if (splits.length < 2 || splits.some(split => !split.category || split.amount <= 0)) return undefined;
  return splits;
};

const parseConversationSplits = (text: string, proposal: ConversationProposal, scope: TransactionConversationScope) => {
  if (!proposal.amount || !proposal.type || proposal.type === 'TRANSFER') return undefined;
  const percentageRows = [...text.matchAll(/(\d+(?:\.\d+)?)\s*%\s+(.*?)(?=\s+(?:and|&)\s+\d+(?:\.\d+)?\s*%|$)/gi)];
  if (percentageRows.length >= 2) {
    const rows = percentageRows.map((match, index) => ({
      id: `conversation-percent-${Date.now()}-${index}`,
      amount: Math.round(proposal.amount! * Number(match[1]) ) / 100,
      category: findCategory(match[2], scope.categories, proposal.type)?.name || '',
      description: match[2].trim(),
    }));
    const percentageTotal = percentageRows.reduce((sum, match) => sum + Number(match[1]), 0);
    if (Math.abs(percentageTotal - 100) < 0.001) {
      const prior = rows.slice(0, -1).reduce((sum, row) => sum + row.amount, 0);
      rows[rows.length - 1].amount = Math.round((proposal.amount - prior) * 100) / 100;
    }
    return rows;
  }
  if (/\b(?:split )?(?:equally|equal)\b/i.test(text)) {
    const mentioned = scope.categories.filter(category => normalize(category.type) === normalize(proposal.type)
      && new RegExp(`\\b${normalize(category.name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(normalize(text)));
    if (mentioned.length >= 2) {
      const each = Math.floor((proposal.amount / mentioned.length) * 100) / 100;
      let used = 0;
      return mentioned.map((category, index) => {
        const amount = index === mentioned.length - 1 ? Math.round((proposal.amount! - used) * 100) / 100 : each;
        used += amount;
        return { id: `conversation-equal-${Date.now()}-${index}`, amount, category: category.name, description: category.name };
      });
    }
  }
  return undefined;
};

const validateSplits = (proposal: ConversationProposal) => {
  if (!proposal.splits.length) { proposal.splitIssue = undefined; return; }
  const total = Math.round(proposal.splits.reduce((sum, split) => sum + split.amount, 0) * 100) / 100;
  const expected = Math.round(Number(proposal.amount || 0) * 100) / 100;
  proposal.splitIssue = proposal.splits.length < 2 || proposal.splits.some(split => !split.category || split.amount <= 0)
    ? 'Every split needs a positive amount and a real category.'
    : total !== expected ? `The split total is ${total}, but the transaction amount is ${expected}.` : undefined;
};

const mentionedCategory = (text: string, categories: QuickAddCategory[], type?: TransactionType) => {
  const haystack = ` ${normalize(text)} `;
  const matches = categories.filter(category => (!type || normalize(category.type) === normalize(type)) && haystack.includes(` ${normalize(category.name)} `));
  return matches.length === 1 ? matches[0] : undefined;
};

const explicitType = (text: string): TransactionType | undefined => {
  if (/\b(?:transfer(?:red|ring)?|moved|move|between my|own account)\b/i.test(text)) return 'TRANSFER';
  if (/\b(?:income|received|earned|salary|paid me|refund received|borrowed|loan received)\b/i.test(text)) return 'INCOME';
  if (/\b(?:expense|spent|bought|paid|sent|purchase|lent|loaned|loan given)\b/i.test(text)) return 'EXPENSE';
  return undefined;
};

const parseDateAnswer = (text: string, now = new Date()) => {
  if (/\btoday\b/i.test(text)) return now.getTime();
  if (/\byesterday\b/i.test(text)) { const date = new Date(now); date.setDate(date.getDate() - 1); return date.getTime(); }
  const match = text.match(/\b(20\d{2})[-/](\d{1,2})[-/](\d{1,2})\b/);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12);
  return Number.isNaN(date.getTime()) ? undefined : date.getTime();
};

const candidateRecipient = (value: { sender_receiver?: string; description?: string }) => value.sender_receiver || value.description || '';

/** Candidate ranking is deterministic. Exact amount is required, and amount alone is never enough to offer a link. */
export function rankTransactionEvidence(proposal: ConversationProposal, scope: TransactionConversationScope): TransactionEvidenceCandidate[] {
  if (!proposal.amount) return [];
  const recipient = normalize(proposal.recipient || proposal.description);
  const rows: TransactionEvidenceCandidate[] = [];
  const add = (kind: 'SMS' | 'TRANSACTION', record: DraftTransaction | Transaction) => {
    if (Math.abs(Number(record.amount) - proposal.amount!) > 0.01) return;
    let score = 45;
    const reasons = ['same amount'];
    let corroboratingSignals = 0;
    if (proposal.accountId && record.account_id === proposal.accountId) { score += 20; corroboratingSignals += 1; reasons.push('same account'); }
    if (proposal.type && record.type === proposal.type) { score += 10; corroboratingSignals += 1; reasons.push('same direction'); }
    const recordRecipient = normalize(candidateRecipient(record));
    if (recipient && recordRecipient && (recordRecipient.includes(recipient) || recipient.includes(recordRecipient))) {
      score += 20; corroboratingSignals += 1; reasons.push('matching person or description');
    }
    if (proposal.date && Math.abs(record.date - proposal.date) <= DAY) { score += 15; corroboratingSignals += 1; reasons.push('within one day'); }
    if (!corroboratingSignals) return;
    const account = scope.accounts.find(item => item.id === record.account_id);
    rows.push({
      id: record.id,
      kind,
      amount: Number(record.amount),
      date: record.date,
      type: record.type,
      accountId: record.account_id,
      accountName: account?.name,
      category: record.category,
      recipient: record.sender_receiver,
      description: record.description,
      score: Math.min(100, score),
      reasons,
    });
  };
  scope.smsDrafts.filter(item => item.status === 'PENDING').forEach(item => add('SMS', item));
  scope.transactions.forEach(item => add('TRANSACTION', item));
  return rows.sort((a, b) => b.score - a.score || b.date - a.date).slice(0, 5);
}

export function nextConversationQuestion(proposal: ConversationProposal, candidates: TransactionEvidenceCandidate[]) {
  const skipped = new Set(proposal.skipped);
  const result = (pendingField: ConversationField, question: string) => ({ pendingField, question, ready: false });
  if (!proposal.type) return result('type', 'Was this an expense, income, or a transfer between your accounts?');
  if (!proposal.amount) return result('amount', 'What was the amount?');
  if (!proposal.accountId) return result('account', 'Which account was used?');
  if (proposal.type === 'TRANSFER' && !proposal.toAccountId) return result('destination', 'Which of your accounts received the transfer?');
  if (proposal.type !== 'TRANSFER' && !proposal.recipient && !skipped.has('recipient')) return result('recipient', proposal.type === 'INCOME' ? 'Who sent the money? You can say “skip” if unknown.' : 'Who received the money? You can say “skip” if unknown.');
  if (proposal.personCandidates?.length && !proposal.personId && !skipped.has('person')) return result('person', `Which saved person is this: ${proposal.personCandidates.map(person => person.name).join(', ')}? Say “skip” to keep the name without linking.`);
  if (proposal.type !== 'TRANSFER' && !proposal.category) return result('category', 'Which category should this use?');
  if (!proposal.date) return result('date', 'When did it happen? For example: today, yesterday, or 2026-10-19.');
  if (proposal.projectRequested && !proposal.project && !skipped.has('project')) return result('project', 'Which saved Mela project should this transaction use? Say its project code or title, or say “skip”.');
  if (proposal.loanKind && !proposal.loanDueDate) return result('loan', 'When is this loan due? For example: tomorrow, next month, or 2026-12-31. If I misunderstood, say “not a loan”.');
  if (proposal.splitIssue) return result('splits', `${proposal.splitIssue} Give every part again, for example: 300 Food and 200 Transport.`);
  if (candidates.length && !proposal.selectedEvidence && !skipped.has('evidence')) return result('evidence', `I found ${candidates.length} possible SMS or recorded payment${candidates.length === 1 ? '' : 's'}. Choose one below, or say “none”.`);
  if (!skipped.has('details')) return result('details', 'Any note, tags, split categories, project, fee, or correction? Say “done” when the proposal is complete.');
  return { pendingField: 'details' as const, question: 'The proposal is ready. Review every field before saving.', ready: true };
}

export function createTransactionConversation(): TransactionConversationState {
  const proposal: ConversationProposal = { tags: [], splits: [], provenance: {}, skipped: [] };
  const question = 'Tell me about the payment in your own words. I will ask about anything missing and check for matching SMS.';
  return { messages: [{ id: id('assistant'), role: 'assistant', text: question, createdAt: Date.now() }], proposal, candidates: [], pendingField: 'type', question, ready: false };
}

export function createSmsTransactionConversation(
  draft: DraftTransaction,
  scope: TransactionConversationScope,
  initial?: Partial<Pick<ConversationProposal, 'type' | 'accountId' | 'toAccountId' | 'category' | 'recipient' | 'personId' | 'personName' | 'description' | 'tags' | 'splits' | 'project' | 'loanKind' | 'loanDueDate'>>,
): TransactionConversationState {
  const type = initial?.type || (draft.is_transfer ? 'TRANSFER' : draft.type);
  const category = /^(?:other|uncategorized|unknown)$/i.test(initial?.category || draft.category) ? undefined : (initial?.category || draft.category);
  const accountId = initial?.accountId || draft.transfer_from_account_id || draft.account_id;
  const evidence: TransactionEvidenceCandidate = {
    id: draft.id,
    kind: 'SMS',
    amount: draft.amount,
    date: draft.date,
    type: draft.type,
    accountId: draft.account_id,
    accountName: scope.accounts.find(item => item.id === draft.account_id)?.name,
    category: draft.category,
    recipient: draft.sender_receiver,
    description: draft.description,
    score: 100,
    reasons: ['selected SMS evidence'],
  };
  const proposal: ConversationProposal = {
    type,
    amount: draft.amount,
    accountId,
    toAccountId: (initial?.toAccountId || draft.transfer_to_account_id) !== accountId ? (initial?.toAccountId || draft.transfer_to_account_id) : undefined,
    category: type === 'TRANSFER' ? undefined : category,
    recipient: initial?.recipient ?? draft.sender_receiver,
    personId: initial?.personId || draft.person_id,
    personName: initial?.personName || draft.person_name_snapshot,
    description: initial?.description || draft.description,
    date: draft.date,
    project: initial?.project,
    projectRequested: !!initial?.project,
    loanKind: initial?.loanKind || (draft.is_loan_disbursement ? (type === 'INCOME' ? 'BORROWED' : 'LENT') : undefined),
    loanDueDate: initial?.loanDueDate,
    tags: initial?.tags || [],
    splits: initial?.splits || draft.suggested_splits || [],
    provenance: { type: 'SMS', amount: 'SMS', account: 'SMS', recipient: 'SMS', category: category ? 'SMS' : undefined, date: 'SMS' },
    skipped: ['evidence'],
    selectedEvidence: evidence,
  };
  if (!proposal.personId && proposal.recipient) resolvePerson(proposal, scope);
  validateSplits(proposal);
  const next = nextConversationQuestion(proposal, []);
  const opening = `I am using the selected ${scope.accounts.find(item => item.id === draft.account_id)?.name || 'bank'} SMS for ${draft.amount} ${scope.currency}. Its amount, date, fees and reference stay unchanged. ${next.question}`;
  return {
    messages: [{ id: id('assistant'), role: 'assistant', text: opening, createdAt: Date.now() }],
    proposal,
    candidates: [],
    pendingField: next.pendingField,
    question: next.question,
    ready: next.ready,
  };
}

/** Reassert immutable bank evidence after every conversational turn in SMS confirmation. */
export function preserveSmsConversationEvidence(state: TransactionConversationState, draft: DraftTransaction) {
  const proposal: ConversationProposal = {
    ...state.proposal,
    amount: draft.amount,
    date: draft.date,
    selectedEvidence: state.proposal.selectedEvidence,
    provenance: { ...state.proposal.provenance, amount: 'SMS', date: 'SMS' },
  };
  if (proposal.type !== 'TRANSFER') {
    proposal.accountId = draft.account_id;
    proposal.toAccountId = undefined;
    proposal.provenance.account = 'SMS';
  } else if (proposal.toAccountId === proposal.accountId) {
    proposal.toAccountId = undefined;
    delete proposal.provenance.destination;
  }
  const next = nextConversationQuestion(proposal, []);
  const messages = state.messages.length && state.messages[state.messages.length - 1].role === 'assistant'
    ? [...state.messages.slice(0, -1), { ...state.messages[state.messages.length - 1], text: next.question }]
    : state.messages;
  return { ...state, proposal, candidates: [], pendingField: next.pendingField, question: next.question, ready: next.ready, messages };
}

/** Re-resolve local directory references after People or project catalogs finish loading. */
export function refreshConversationReferences(state: TransactionConversationState, scope: TransactionConversationScope) {
  const proposal: ConversationProposal = {
    ...state.proposal,
    tags: [...state.proposal.tags],
    splits: [...state.proposal.splits],
    skipped: [...state.proposal.skipped],
    provenance: { ...state.proposal.provenance },
  };
  if (proposal.recipient && !proposal.personId && !proposal.skipped.includes('person')) resolvePerson(proposal, scope);
  validateSplits(proposal);
  const next = nextConversationQuestion(proposal, state.candidates);
  return { ...state, proposal, pendingField: next.pendingField, question: next.question, ready: next.ready };
}

function applyFields(proposal: ConversationProposal, fields: AIFields, scope: TransactionConversationScope, source: ProposalSource) {
  const next: ConversationProposal = { ...proposal, tags: [...proposal.tags], splits: [...proposal.splits], skipped: [...proposal.skipped], provenance: { ...proposal.provenance } };
  const type = explicitType(fields.type || '') || (['INCOME', 'EXPENSE', 'TRANSFER'].includes(String(fields.type).toUpperCase()) ? String(fields.type).toUpperCase() as TransactionType : undefined);
  if (type && !next.type) { next.type = type; next.provenance.type = source; }
  const amount = typeof fields.amount === 'number' ? fields.amount : parseLocaleAmount(String(fields.amount || ''));
  if (amount && amount > 0 && !next.amount) { next.amount = Math.round(amount * 100) / 100; next.provenance.amount = source; }
  const account = findAccount(fields.account, scope.accounts);
  if (account && !next.accountId) { next.accountId = account.id; next.provenance.account = source; }
  const destination = findAccount(fields.destinationAccount, scope.accounts);
  if (destination && !next.toAccountId && destination.id !== next.accountId) { next.toAccountId = destination.id; next.provenance.destination = source; }
  const category = findCategory(fields.category, scope.categories, next.type);
  if (category && !next.category) { next.category = category.name; next.provenance.category = source; }
  if (fields.recipient?.trim() && !next.recipient) { next.recipient = fields.recipient.trim(); next.provenance.recipient = source; }
  if (!next.personId && (fields.person || fields.recipient || next.recipient)) resolvePerson(next, scope, fields.person || fields.recipient || next.recipient, source);
  if (fields.description?.trim() && !next.description) { next.description = fields.description.trim(); }
  const date = fields.date ? parseDateAnswer(fields.date) : undefined;
  if (date && !next.date) { next.date = date; next.provenance.date = source; }
  if (Array.isArray(fields.tags)) next.tags = [...new Set([...next.tags, ...fields.tags.map(item => String(item).replace(/^#/, '').trim()).filter(Boolean)])];
  if (fields.project?.trim()) {
    next.projectRequested = true;
    const project = findProject(fields.project, scope.projects || []);
    if (project) { next.project = asProjectLink(project); next.provenance.project = source; }
  }
  const loanKind = loanKindFromText(fields.loanKind || '', next.type);
  if (loanKind) { next.loanKind = loanKind; next.provenance.loan = source; }
  const dueDate = fields.dueDate ? parseDueDate(fields.dueDate) : undefined;
  if (dueDate) { next.loanDueDate = dueDate; next.provenance.loan = source; }
  const splits = normalizeSplits(fields.splits, next, scope);
  if (splits && next.provenance.splits !== 'USER') { next.splits = splits; next.provenance.splits = source; }
  validateSplits(next);
  return next;
}

function applyLocalTurn(state: TransactionConversationState, text: string, scope: TransactionConversationScope) {
  let proposal: ConversationProposal = { ...state.proposal, tags: [...state.proposal.tags], splits: [...state.proposal.splits], skipped: [...state.proposal.skipped], provenance: { ...state.proposal.provenance } };
  if (state.pendingField === 'loan' && /\bnot (?:a )?loan\b/i.test(text)) {
    proposal.loanKind = undefined; proposal.loanDueDate = undefined; delete proposal.provenance.loan;
    return proposal;
  }
  if ((state.pendingField === 'loan' || state.pendingField === 'splits') && isSkip(text)) return proposal;
  if (isSkip(text)) {
    if (!proposal.skipped.includes(state.pendingField)) proposal.skipped.push(state.pendingField);
    return proposal;
  }
  const parsed = parseQuickAdd(text, scope.accounts, scope.categories, scope.transactions);
  const conversationalSplits = parseConversationSplits(text, proposal, scope) || parsed.splits;
  const type = explicitType(text);
  if (type) {
    const priorType = proposal.type;
    proposal.type = type; proposal.provenance.type = 'USER';
    if (type === 'TRANSFER') {
      proposal.category = undefined; proposal.recipient = undefined; proposal.personId = undefined; proposal.personName = undefined;
      proposal.personCandidates = undefined; proposal.project = undefined; proposal.projectRequested = false;
      proposal.loanKind = undefined; proposal.loanDueDate = undefined; proposal.splits = []; proposal.splitIssue = undefined;
    } else if (priorType && priorType !== type && proposal.category && !findCategory(proposal.category, scope.categories, type)) {
      proposal.category = undefined; delete proposal.provenance.category;
    }
  }
  if (parsed.amount && (!proposal.amount || /\b(?:change|correct|amount is)\b/i.test(text))) { proposal.amount = parsed.amount; proposal.provenance.amount = 'USER'; }
  if (parsed.accountId) { proposal.accountId = parsed.accountId; proposal.provenance.account = 'USER'; }
  if (parsed.recipient) {
    if (proposal.personId && normalize(parsed.recipient) !== normalize(proposal.personName)) {
      proposal.personId = undefined; proposal.personName = undefined; proposal.personCandidates = undefined; delete proposal.provenance.person;
    }
    proposal.recipient = parsed.recipient; proposal.provenance.recipient = 'USER';
  }
  const categoryFromText = parsed.category ? { name: parsed.category } : mentionedCategory(text, scope.categories, proposal.type);
  if (categoryFromText && conversationalSplits.length < 2) { proposal.category = categoryFromText.name; proposal.provenance.category = 'USER'; }
  if (parsed.tags.length) proposal.tags = [...new Set([...proposal.tags, ...parsed.tags])];
  if (conversationalSplits.length > 1) { proposal.splits = conversationalSplits; proposal.provenance.splits = 'USER'; }
  if (hasExplicitDate(text)) { proposal.date = parsed.date; proposal.provenance.date = 'USER'; }
  if (!proposal.description && state.pendingField !== 'details') proposal.description = parsed.description || text.trim();

  if (proposal.recipient && !proposal.personId) resolvePerson(proposal, scope);
  if (/\bproject(?: cost)?\b/i.test(text)) {
    proposal.projectRequested = true;
    const requested = text.match(/\bproject(?: cost)?\s+(?:for\s+)?(.+?)(?=\s+(?:due|split|today|yesterday|on)\b|$)/i)?.[1];
    const project = findProject(requested, scope.projects || []);
    if (project) { proposal.project = asProjectLink(project); proposal.provenance.project = 'USER'; }
  }
  if (/\bnot (?:a )?loan\b/i.test(text)) {
    proposal.loanKind = undefined; proposal.loanDueDate = undefined; delete proposal.provenance.loan;
  } else {
    const loanKind = loanKindFromText(text, proposal.type);
    if (loanKind) { proposal.loanKind = loanKind; proposal.provenance.loan = 'USER'; }
  }
  const dueText = text.match(/\bdue\s+(.+)$/i)?.[1];
  const dueDate = dueText ? parseDueDate(dueText) : undefined;
  if (dueDate) { proposal.loanDueDate = dueDate; proposal.provenance.loan = 'USER'; }

  if (proposal.type === 'TRANSFER') {
    const fromMatch = text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)(?=\s+(?:today|yesterday|on|for)\b|$)/i);
    if (fromMatch) {
      const sourceAccount = findAccount(fromMatch[1], scope.accounts);
      const destination = findAccount(fromMatch[2], scope.accounts);
      if (sourceAccount) { proposal.accountId = sourceAccount.id; proposal.provenance.account = 'USER'; }
      if (destination && destination.id !== sourceAccount?.id) { proposal.toAccountId = destination.id; proposal.provenance.destination = 'USER'; }
    }
  }

  if (state.pendingField === 'type' && !proposal.type) {
    const direct = explicitType(text);
    if (direct) { proposal.type = direct; proposal.provenance.type = 'USER'; }
  } else if (state.pendingField === 'amount' && !proposal.amount) {
    const amount = parseLocaleAmount(text.replace(/[^\d.,]/g, ''));
    if (amount) { proposal.amount = amount; proposal.provenance.amount = 'USER'; }
  } else if (state.pendingField === 'account') {
    const account = findAccount(text, scope.accounts);
    if (account) { proposal.accountId = account.id; proposal.provenance.account = 'USER'; }
  } else if (state.pendingField === 'destination') {
    const account = findAccount(text, scope.accounts);
    if (account && account.id !== proposal.accountId) { proposal.toAccountId = account.id; proposal.provenance.destination = 'USER'; }
  } else if (state.pendingField === 'recipient' && !proposal.recipient) {
    proposal.recipient = text.trim(); proposal.provenance.recipient = 'USER';
    resolvePerson(proposal, scope, text);
  } else if (state.pendingField === 'person') {
    const person = findPeople(text, scope.people);
    if (person.length === 1) {
      proposal.personId = person[0].id; proposal.personName = person[0].displayName; proposal.recipient = person[0].displayName;
      proposal.personCandidates = undefined; proposal.provenance.person = 'USER';
    }
  } else if (state.pendingField === 'category') {
    const category = findCategory(text, scope.categories, proposal.type);
    if (category) { proposal.category = category.name; proposal.provenance.category = 'USER'; }
  } else if (state.pendingField === 'date') {
    const date = parseDateAnswer(text);
    if (date) { proposal.date = date; proposal.provenance.date = 'USER'; }
  } else if (state.pendingField === 'project') {
    proposal.projectRequested = true;
    const project = findProject(text, scope.projects || []);
    if (project) { proposal.project = asProjectLink(project); proposal.provenance.project = 'USER'; }
  } else if (state.pendingField === 'loan') {
    const date = parseDueDate(text);
    if (date) { proposal.loanDueDate = date; proposal.provenance.loan = 'USER'; }
  } else if (state.pendingField === 'splits') {
    if (conversationalSplits.length > 1) { proposal.splits = conversationalSplits; proposal.provenance.splits = 'USER'; }
  } else if (state.pendingField === 'evidence' && /\b(?:none|new|no match)\b/i.test(text)) {
    if (!proposal.skipped.includes('evidence')) proposal.skipped.push('evidence');
  } else if (state.pendingField === 'details' && /\b(?:done|nothing|no more|finish|complete)\b/i.test(text)) {
    if (!proposal.skipped.includes('details')) proposal.skipped.push('details');
  }
  validateSplits(proposal);
  return proposal;
}

async function extractWithAI(text: string, state: TransactionConversationState, scope: TransactionConversationScope, keys: CompletionKeys) {
  const prompt = `You extract transaction details. Return JSON only. Never invent an account, category, saved person, or project. A loanKind is LENT when the user gave money and BORROWED when the user received it. Split amounts must add to the transaction amount.\nSchema: {"fields":{"type":"EXPENSE|INCOME|TRANSFER","amount":number,"account":string,"destinationAccount":string,"category":string,"recipient":string,"person":string,"description":string,"date":"today|yesterday|YYYY-MM-DD","tags":[string],"project":string,"loanKind":"LENT|BORROWED","dueDate":"tomorrow|next week|next month|YYYY-MM-DD","splits":[{"amount":number,"category":string,"description":string}]}}\nAvailable accounts: ${scope.accounts.map(item => item.name).join(', ') || 'none'}\nAvailable categories: ${scope.categories.map(item => item.name).join(', ') || 'none'}\nSaved people: ${(scope.people || []).map(item => item.displayName).join(', ') || 'none'}\nSaved projects: ${(scope.projects || []).map(item => `${item.code || item.id}: ${item.title}`).join(', ') || 'none'}\nCurrent proposal: ${JSON.stringify({ type: state.proposal.type, amount: state.proposal.amount, account: scope.accounts.find(item => item.id === state.proposal.accountId)?.name, destinationAccount: scope.accounts.find(item => item.id === state.proposal.toAccountId)?.name, category: state.proposal.category, recipient: state.proposal.recipient, person: state.proposal.personName, project: state.proposal.project?.title, loanKind: state.proposal.loanKind, dueDate: state.proposal.loanDueDate ? new Date(state.proposal.loanDueDate).toISOString().slice(0, 10) : undefined, splits: state.proposal.splits, date: state.proposal.date ? new Date(state.proposal.date).toISOString().slice(0, 10) : undefined, tags: state.proposal.tags })}\nCurrent question: ${state.question}\nUser answer: ${text}`;
  const completion = await completeText(prompt, keys);
  return { parsed: extractJson<AIReply>(completion.text), provider: completion.provider };
}

export async function continueTransactionConversation(state: TransactionConversationState, text: string, scope: TransactionConversationScope, options: { useAI: boolean; keys: CompletionKeys }) {
  const trimmed = text.trim();
  if (!trimmed) return state;
  let proposal = applyLocalTurn(state, trimmed, scope);
  let provider = state.provider;
  if (options.useAI) {
    try {
      const ai = await extractWithAI(trimmed, { ...state, proposal }, scope, options.keys);
      provider = ai.provider;
      if (ai.parsed?.fields) proposal = applyFields(proposal, ai.parsed.fields, scope, 'AI');
    } catch { /* Local clarification remains available when a provider is unavailable. */ }
  }
  const candidates = rankTransactionEvidence(proposal, scope);
  const next = nextConversationQuestion(proposal, candidates);
  const response = next.question;
  return {
    messages: [...state.messages, { id: id('user'), role: 'user' as const, text: trimmed, createdAt: Date.now() }, { id: id('assistant'), role: 'assistant' as const, text: response, createdAt: Date.now() }],
    proposal,
    candidates,
    pendingField: next.pendingField,
    question: response,
    ready: next.ready,
    provider,
  };
}

export function selectTransactionEvidence(state: TransactionConversationState, candidate: TransactionEvidenceCandidate, scope: TransactionConversationScope) {
  const proposal: ConversationProposal = {
    ...state.proposal,
    amount: candidate.amount,
    type: candidate.type,
    accountId: candidate.accountId || state.proposal.accountId,
    toAccountId: state.proposal.toAccountId,
    category: state.proposal.category || candidate.category,
    recipient: state.proposal.recipient || candidate.recipient,
    description: state.proposal.description || candidate.description,
    date: candidate.date,
    selectedEvidence: candidate,
    tags: [...state.proposal.tags],
    splits: [...state.proposal.splits],
    skipped: [...state.proposal.skipped],
    provenance: { ...state.proposal.provenance, amount: candidate.kind, type: candidate.kind, account: candidate.kind, date: candidate.kind },
  };
  const candidates = rankTransactionEvidence(proposal, scope);
  const next = nextConversationQuestion(proposal, candidates);
  return { ...state, proposal, candidates, pendingField: next.pendingField, question: next.question, ready: next.ready, messages: [...state.messages, { id: id('assistant'), role: 'assistant' as const, text: `Using ${candidate.kind === 'SMS' ? 'the pending SMS' : 'the recorded transaction'} from ${new Date(candidate.date).toLocaleDateString()}. ${next.question}`, createdAt: Date.now() }] };
}

export function conversationFingerprint(proposal: ConversationProposal) {
  const base = `${proposal.type}|${proposal.amount}|${proposal.accountId}|${proposal.toAccountId || ''}|${proposal.date}|${proposal.recipient || ''}|${proposal.personId || ''}|${proposal.project?.id || ''}|${proposal.loanKind || ''}|${proposal.loanDueDate || ''}|${JSON.stringify(proposal.splits)}|${proposal.selectedEvidence?.kind || ''}:${proposal.selectedEvidence?.id || ''}`;
  let hash = 2166136261;
  for (let index = 0; index < base.length; index += 1) hash = Math.imul(hash ^ base.charCodeAt(index), 16777619);
  return `conversation:${(hash >>> 0).toString(36)}`;
}
