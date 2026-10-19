const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
let aiResponse;
const mocks = {
  '@/services/AICompletion': { completeText: async () => {
    if (!aiResponse) throw new Error('AI is disabled in local tests');
    return { text: JSON.stringify(aiResponse), provider: 'groq' };
  }, extractJson: JSON.parse },
};
function load(name, parent = root) {
  if (mocks[name]) return mocks[name];
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(dep => load(dep, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}

const service = load('./services/TransactionConversationService.ts');
const now = new Date(2026, 9, 19, 12).getTime();
const accounts = [{ id: 'cbe', name: 'CBE', type: 'BANK', balance: 0, currency: 'ETB', is_locked: false, locked_amount: 0, created_at: 1 }];
const categories = [{ id: 'food', name: 'Food', type: 'expense' }, { id: 'salary', name: 'Salary', type: 'income' }];
const sms = (id, extra = {}) => ({ id, account_id: 'cbe', type: 'EXPENSE', amount: 500, category: 'Other', description: 'Transfer to Daniel', sender_receiver: 'Daniel', date: now, sms_id: id, raw_sms: 'private bank message', status: 'PENDING', is_recorded: false, created_at: now, ...extra });
const scope = { accounts, categories, transactions: [], smsDrafts: [sms('one'), sms('two', { sender_receiver: 'Hana', description: 'Transfer to Hana' })], currency: 'ETB' };

test('amount alone never offers or selects an SMS match', () => {
  const candidates = service.rankTransactionEvidence({ amount: 500, tags: [], splits: [], provenance: {}, skipped: [] }, scope);
  assert.deepEqual(candidates, []);
});

test('corroborating evidence can rank candidates but never selects one automatically', () => {
  const proposal = { amount: 500, recipient: 'Daniel', tags: [], splits: [], provenance: {}, skipped: [] };
  const candidates = service.rankTransactionEvidence(proposal, scope);
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].id, 'one');
  assert.equal(proposal.selectedEvidence, undefined);
  assert.match(candidates[0].reasons.join(' '), /matching person/);
});

test('clarification asks one required field at a time', () => {
  const blank = { tags: [], splits: [], provenance: {}, skipped: [] };
  assert.equal(service.nextConversationQuestion(blank, []).pendingField, 'type');
  assert.equal(service.nextConversationQuestion({ ...blank, type: 'EXPENSE' }, []).pendingField, 'amount');
  assert.equal(service.nextConversationQuestion({ ...blank, type: 'EXPENSE', amount: 500 }, []).pendingField, 'account');
  assert.equal(service.nextConversationQuestion({ ...blank, type: 'EXPENSE', amount: 500, accountId: 'cbe' }, []).pendingField, 'recipient');
});

test('a complete proposal still requires the final details check', () => {
  const proposal = { type: 'EXPENSE', amount: 500, accountId: 'cbe', recipient: 'Daniel', category: 'Food', date: now, tags: [], splits: [], provenance: {}, skipped: ['evidence'] };
  const before = service.nextConversationQuestion(proposal, []);
  assert.equal(before.pendingField, 'details');
  assert.equal(before.ready, false);
  const after = service.nextConversationQuestion({ ...proposal, skipped: ['evidence', 'details'] }, []);
  assert.equal(after.ready, true);
});

test('own-account transfers require and resolve a distinct destination account', async () => {
  const transferScope = { ...scope, accounts: [...accounts, { ...accounts[0], id: 'telebirr', name: 'Telebirr', type: 'MOBILE_MONEY' }] };
  let state = service.createTransactionConversation();
  state = await service.continueTransactionConversation(state, 'I transferred 500 from CBE to Telebirr today', transferScope, { useAI: false, keys: {} });
  assert.equal(state.proposal.type, 'TRANSFER');
  assert.equal(state.proposal.accountId, 'cbe');
  assert.equal(state.proposal.toAccountId, 'telebirr');
  assert.notEqual(state.pendingField, 'destination');
});

test('local conversation resolves only real accounts and categories', async () => {
  let state = service.createTransactionConversation();
  state = await service.continueTransactionConversation(state, 'I spent 500 to Daniel from CBE for Food today', scope, { useAI: false, keys: {} });
  assert.equal(state.proposal.accountId, 'cbe');
  assert.equal(state.proposal.category, 'Food');
  const prior = state.proposal.category;
  state = { ...state, pendingField: 'category', question: 'Which category?' };
  state = await service.continueTransactionConversation(state, 'Imaginary category', scope, { useAI: false, keys: {} });
  assert.equal(state.proposal.category, prior, 'unknown category names cannot replace a resolved category');
});

test('AI extraction cannot overwrite fields explicitly supplied by the user', async () => {
  aiResponse = { fields: { type: 'INCOME', amount: 9000, account: 'CBE', category: 'Salary', recipient: 'Wrong person', date: 'yesterday' } };
  try {
    let state = service.createTransactionConversation();
    state = await service.continueTransactionConversation(state, 'I spent 500 to Daniel from CBE for Food today', scope, { useAI: true, keys: { groqApiKey: 'test' } });
    assert.equal(state.proposal.type, 'EXPENSE');
    assert.equal(state.proposal.amount, 500);
    assert.equal(state.proposal.category, 'Food');
    assert.equal(state.proposal.recipient, 'Daniel');
    assert.equal(state.proposal.provenance.date, 'USER');
  } finally { aiResponse = undefined; }
});

test('choosing evidence is explicit and preserves its source ID for review', () => {
  const proposal = { type: 'EXPENSE', amount: 500, accountId: 'cbe', recipient: 'Daniel', category: 'Food', date: now, tags: [], splits: [], provenance: {}, skipped: ['details'] };
  const candidates = service.rankTransactionEvidence(proposal, scope);
  const state = { ...service.createTransactionConversation(), proposal, candidates, pendingField: 'evidence', question: 'Choose', ready: false };
  const selected = service.selectTransactionEvidence(state, candidates[0], scope);
  assert.equal(selected.proposal.selectedEvidence.id, 'one');
  assert.equal(selected.proposal.selectedEvidence.kind, 'SMS');
  assert.equal(selected.proposal.category, 'Food', 'the user category wins over the SMS placeholder category');
});

test('saying done keeps the original transaction description', async () => {
  const proposal = { type: 'EXPENSE', amount: 500, accountId: 'cbe', recipient: 'Daniel', category: 'Food', description: 'Lunch with Daniel', date: now, tags: [], splits: [], provenance: {}, skipped: ['evidence'] };
  const state = { ...service.createTransactionConversation(), proposal, candidates: [], pendingField: 'details', question: 'Anything else?', ready: false };
  const next = await service.continueTransactionConversation(state, 'done', scope, { useAI: false, keys: {} });
  assert.equal(next.proposal.description, 'Lunch with Daniel');
  assert.equal(next.ready, true);
});

test('conversation UI routes through existing review screens and does not write the ledger', () => {
  const source = fs.readFileSync(path.join(root, 'components/smart-input/ConversationInput.tsx'), 'utf8');
  assert.match(source, /InputDraftService\.save/);
  assert.match(source, /pathname: '\/modal'/);
  assert.match(source, /pathname: '\/draft-transactions'/);
  assert.doesNotMatch(source, /addTransaction|dispatch\s*\(/);
  assert.match(source, /Nothing is added to your ledger until you review and save/);
});
