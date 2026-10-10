const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();
const mocks = {};
function load(name, parent = root) {
  if (mocks[name]) return { __esModule: true, ...mocks[name] };
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

mocks['@/contexts/AppSettingsContext'] = { loadStoredAppSettings: async () => ({ aiSharingEnabled: true }) };
const { runAgentTool, FinancialAgent } = load('./services/FinancialAgent.ts');

const day = s => new Date(`${s}T12:00:00`).getTime();
const scope = {
  currency: 'ETB',
  categories: ['Food', 'Transport', 'Rent', 'Salary'],
  accounts: [{ id: 'cbe', name: 'CBE', type: 'BANK', balance: 12000 }, { id: 'cash', name: 'Cash', type: 'CASH', balance: 800 }],
  transactions: [
    { id: 't1', type: 'EXPENSE', amount: 600, category: 'Food', description: 'Lunch', account_id: 'cbe', date: day('2026-09-03') },
    { id: 't2', type: 'EXPENSE', amount: 1000, category: 'Food', description: 'Market run', account_id: 'cbe', date: day('2026-09-10'),
      splits: [{ id: 's1', category: 'Food', amount: 700 }, { id: 's2', category: 'Transport', amount: 300 }] },
    { id: 't3', type: 'EXPENSE', amount: 5000, category: 'Rent', description: 'September rent', sender_receiver: 'Landlord', account_id: 'cbe', date: day('2026-09-01') },
    { id: 't4', type: 'INCOME', amount: 20000, category: 'Salary', description: 'Salary', account_id: 'cbe', date: day('2026-09-28') },
    { id: 't5', type: 'TRANSFER', amount: 500, category: 'Transfer', description: 'To cash', account_id: 'cbe', to_account_id: 'cash', date: day('2026-09-15') },
  ],
  budgets: [{ id: 'b1', category: 'Food', period: 'MONTHLY', limit_amount: 1000, start_date: day('2026-09-01'), end_date: day('2026-09-30') }],
  loans: [], recurring: [], goals: [],
};
const fresh = () => ({ evidence: new Set() });

test('category search counts only the matching split of a split transaction', () => {
  const result = runAgentTool('search_transactions', { category: 'Transport' }, scope, fresh());
  assert.equal(result.count, 1);
  assert.equal(result.rows[0].amount, 300);
  assert.equal(result.total, 'ETB 300.00');
});

test('breakdown attributes splits to their own categories and ignores transfers', () => {
  const state = fresh();
  const result = runAgentTool('spending_breakdown', { group_by: 'category', from: '2026-09-01', to: '2026-09-30' }, scope, state);
  const byCat = Object.fromEntries(result.groups.map(g => [g.category, g.total]));
  assert.deepEqual(byCat, { Rent: 5000, Food: 1300, Transport: 300 });
  assert.equal(result.total, 'ETB 6600.00');
  assert.ok(!state.evidence.has('t5'), 'a transfer between own accounts is not spending');
});

test('budget status uses split-aware spending', () => {
  const [food] = runAgentTool('get_budgets', {}, scope, fresh()).budgets;
  assert.equal(food.spent, 1300);
  assert.equal(food.remaining, -300);
});

test('write tools only prepare proposals and reject unknown names', () => {
  const state = fresh();
  assert.match(runAgentTool('propose_budget', { category: 'Gym', amount: 500 }, scope, state).error, /Unknown category/);
  assert.equal(state.proposal, undefined);
  runAgentTool('propose_budget', { category: 'food', amount: 1500 }, scope, state);
  assert.equal(state.proposal.kind, 'BUDGET');
  assert.equal(state.proposal.category, 'Food');
  assert.match(runAgentTool('propose_recurring', { name: 'Rent', amount: 5000, category: 'Rent', account: 'Nowhere', frequency: 'MONTHLY', type: 'EXPENSE' }, scope, fresh()).error, /Unknown account/);
});

test('the agent calls a tool, feeds the result back, and returns a grounded answer', async () => {
  const originalFetch = globalThis.fetch;
  const bodies = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    bodies.push(body);
    const message = bodies.length === 1
      ? { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'spending_breakdown', arguments: JSON.stringify({ group_by: 'category', from: '2026-09-01', to: '2026-09-30' }) } }] }
      : { role: 'assistant', content: 'You spent ETB 6600.00 in September; Rent was the largest at ETB 5000.' };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message }] }) };
  };
  try {
    const result = await FinancialAgent.run('Where did my money go in September?', [], scope, { topToolsApiKey: 'sk-test' });
    assert.equal(result.provider, 'toptools');
    assert.equal(result.toolCalls, 1);
    assert.match(result.answer, /6600/);
    assert.ok(bodies[0].tools.some(t => t.function.name === 'search_transactions'), 'tools are offered to the model');
    const toolReply = bodies[1].messages.find(m => m.role === 'tool');
    assert.match(toolReply.content, /"Rent"/, 'the real breakdown was sent back to the model');
    assert.ok(result.evidenceIds.includes('t3'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('the agent falls through to the next provider when one fails', async () => {
  const originalFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(url);
    if (url.includes('top-tools-ai')) return { ok: false, status: 502, json: async () => ({ error: { message: 'provider_unavailable' } }) };
    return { ok: true, status: 200, json: async () => ({ choices: [{ message: { role: 'assistant', content: 'Answer from Groq' } }] }) };
  };
  try {
    const result = await FinancialAgent.run('hi', [], scope, { topToolsApiKey: 'a', groqApiKey: 'b' });
    assert.equal(result.provider, 'groq');
    assert.ok(urls.some(u => u.includes('groq')));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
