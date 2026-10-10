const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
const mocks = {};
function load(name, parent = root) {
  if (mocks[name]) return { __esModule: true, default: mocks[name].default ?? mocks[name], ...mocks[name] };
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', js)(dep => load(dep, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}

// In-memory stand-ins for device storage, drafts, rules and settings.
const store = new Map();
mocks['./SessionStorage'] = { default: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); } } };
let drafts = [];
mocks['./DraftTransactionService'] = {
  DraftTransactionService: {
    getAll: async () => drafts.map(d => ({ ...d })),
    updateMany: async patches => { for (const { id, patch } of patches) drafts = drafts.map(d => (d.id === id ? { ...d, ...patch } : d)); },
  },
};
mocks['./SMSLearningService'] = { SMSLearningService: { getRule: async ({ rawMerchant }) => (rawMerchant === 'Ruled Shop' ? { category: 'Food' } : null) } };
let history = [];
mocks['./database'] = { getDatabase: async () => ({ getTransactions: async () => history }) };
const categories = [
  { id: '1', name: 'Food', type: 'EXPENSE' }, { id: '2', name: 'Transport', type: 'EXPENSE' },
  { id: '3', name: 'Utilities', type: 'EXPENSE' }, { id: '4', name: 'Salary', type: 'INCOME' },
];
mocks['@/utils/storage'] = { StorageService: { loadCategories: async () => categories } };
mocks['@/contexts/AppSettingsContext'] = { loadStoredAppSettings: async () => ({ aiSharingEnabled: true, topToolsApiKey: 'sk-test' }) };

const enrichment = load('./services/DraftEnrichmentService.ts');
const proactive = load('./services/ProactiveInsightsService.ts');
const { extractJson } = load('./services/AICompletion.ts');

const DAY = 86400000;
const draft = (id, extra) => ({ id, account_id: 'cbe', type: 'EXPENSE', amount: 100, category: 'Other', description: 'Transfer to ETHIO TEL 0911', date: Date.now(), sms_id: id, raw_sms: 'Debited ETB 100 from 1000123456 to ETHIO TEL 0911223344', status: 'PENDING', is_recorded: false, created_at: Date.now(), sms_sender: 'CBE', ...extra });

test('extractJson tolerates code fences and surrounding prose', () => {
  assert.deepEqual(extractJson('Sure!\n```json\n[{"id":"a"}]\n```'), [{ id: 'a' }]);
  assert.equal(extractJson('no json here'), undefined);
});

test('history mapping needs a clear, repeated choice', () => {
  const learned = enrichment.learnCounterpartyCategories([
    { type: 'EXPENSE', sender_receiver: 'Kaldis', category: 'Food' },
    { type: 'EXPENSE', sender_receiver: 'kaldis', category: 'Food' },
    { type: 'EXPENSE', sender_receiver: 'Kaldis', category: 'Transport' },
    { type: 'EXPENSE', sender_receiver: 'Once Only', category: 'Food' },
  ]);
  assert.equal(learned.get('kaldis'), 'Food');
  assert.equal(learned.has('once only'), false);
});

test('AI suggestions are validated against real categories and the transaction type', () => {
  const d = [draft('a'), draft('b', { type: 'INCOME' })];
  const out = enrichment.parseSuggestions('[{"id":"a","category":"utilities","merchant":"Ethio Telecom"},{"id":"b","category":"Food","merchant":"0911223344"},{"id":"zzz","category":"Food"}]', d, categories);
  assert.deepEqual(out.find(s => s.id === 'a'), { id: 'a', category: 'Utilities', merchant: 'Ethio Telecom' });
  const b = out.find(s => s.id === 'b');
  assert.equal(b.category, undefined, 'an expense category is not valid for income');
  assert.equal(b.merchant, undefined, 'a phone number is not a merchant name');
  assert.equal(out.length, 2);
});

test('merchant cleanup only rewrites counterparty templates, never "Paid via <bank>"', () => {
  assert.equal(enrichment.patchFor(draft('a'), { id: 'a', merchant: 'Ethio Telecom' }).description, 'Transfer to Ethio Telecom');
  assert.equal(enrichment.patchFor(draft('a', { description: 'Paid via CBE' }), { id: 'a', merchant: 'Ethio Telecom' }), null);
});

test('enrichment uses history first, AI for the rest, skips learned rules, and keeps user edits', async () => {
  store.clear();
  history = [
    { type: 'EXPENSE', sender_receiver: 'Kaldis', category: 'Food' },
    { type: 'EXPENSE', sender_receiver: 'Kaldis', category: 'Food' },
  ];
  drafts = [
    draft('hist', { sender_receiver: 'Kaldis', description: 'Transfer to Kaldis' }),
    draft('ai', { sender_receiver: 'ETHIO TEL 0911' }),
    draft('ruled', { sender_receiver: 'Ruled Shop' }),
    draft('edited', { sender_receiver: 'Someone' }),
    draft('transfer', { is_transfer: true }),
  ];
  const originalFetch = globalThis.fetch;
  const prompts = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    prompts.push(body.messages[0].content);
    // The user edits "edited" while the AI call is in flight.
    drafts = drafts.map(d => (d.id === 'edited' ? { ...d, category: 'Transport' } : d));
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '[{"id":"ai","category":"Utilities","merchant":"Ethio Telecom"},{"id":"edited","category":"Food","merchant":null}]' } }] }) };
  };
  try {
    const updated = await enrichment.DraftEnrichmentService.enrichPending();
    const byId = Object.fromEntries(drafts.map(d => [d.id, d]));
    assert.equal(byId.hist.category, 'Food', 'learned from history, no AI needed');
    assert.equal(byId.ai.category, 'Utilities');
    assert.equal(byId.ai.description, 'Transfer to Ethio Telecom');
    assert.equal(byId.ruled.category, 'Other', 'a learned rule is never second-guessed');
    assert.equal(byId.edited.category, 'Transport', 'a change the user made meanwhile is kept');
    assert.equal(byId.transfer.category, 'Other');
    assert.equal(updated, 2);
    assert.equal(prompts.length, 1, 'one batched call');
    assert.ok(!prompts[0].includes('1000123456'), 'account numbers are masked before sending');
    assert.ok(!prompts[0].includes('"id":"hist"') && !prompts[0].includes('"id":"ruled"'));
    // A second run doesn't re-send drafts already handled.
    prompts.length = 0;
    await enrichment.DraftEnrichmentService.enrichPending();
    assert.equal(prompts.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('an unusually large charge at a known merchant is flagged, normal ones are not', () => {
  const now = Date.now();
  const past = [1, 2, 3, 4].map(i => ({ id: `p${i}`, type: 'EXPENSE', amount: 200, category: 'Food', sender_receiver: 'Kaldis', description: 'Kaldis', date: now - i * 10 * DAY }));
  const big = { id: 'big', type: 'EXPENSE', amount: 1200, category: 'Food', sender_receiver: 'Kaldis', description: 'Kaldis', date: now - 3600000 };
  const normal = { id: 'ok', type: 'EXPENSE', amount: 220, category: 'Food', sender_receiver: 'Kaldis', description: 'Kaldis', date: now - 7200000 };
  const alerts = proactive.detectUnusualSpending([...past, big, normal], 'ETB', now);
  assert.deepEqual(alerts.map(a => a.sourceKey), ['proactive:unusual:big']);
  assert.match(alerts[0].message, /6\.0× your usual ETB 200\.00/);
});

test('a salary triggers a concrete savings nudge', () => {
  const now = Date.now();
  const alerts = proactive.detectIncomeArrived([{ id: 's', type: 'INCOME', amount: 20000, category: 'Salary', description: 'Salary', date: now - 3600000 }], 'ETB', now);
  assert.equal(alerts.length, 1);
  assert.match(alerts[0].message, /20% \(ETB 4000\.00\)/);
});
