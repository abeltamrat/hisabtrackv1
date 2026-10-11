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

const store = new Map();
const secure = new Map();
mocks['./SessionStorage'] = {
  default: { getItem: async k => store.get(k) ?? null, setItem: async (k, v) => { store.set(k, v); }, removeItem: async k => { store.delete(k); } },
  getSessionScope: () => 'user1',
  sessionLocalStorage: { getItem: k => secure.get(k) ?? null, setItem: (k, v) => secure.set(k, v), removeItem: k => secure.delete(k) },
};
mocks['react-native'] = { Platform: { OS: 'android' } };
mocks['expo-secure-store'] = { setItemAsync: async (k, v) => { secure.set(k, v); }, getItemAsync: async k => secure.get(k) ?? null, deleteItemAsync: async k => { secure.delete(k); } };

const { default: MelaService, MELA_API_URL, sortProjects } = load('./services/MelaService.ts');
const { projectEntries, projectTotals, projectKey } = load('./utils/projectFinance.ts');
const { validateTransaction } = load('./utils/finance.ts');

const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test('connecting signs in, keeps only the token, and imports projects', async () => {
  store.clear(); secure.clear();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (url.endsWith('action=login')) return reply(200, { token: 'tok.sig', expires_at: 2000000000, company: 'kingswood', user: { name: 'Abel T', email: 'a@x.com' } });
    return reply(200, { projects: [{ id: 7, code: 'P-7', title: 'Bole villa', status: 'inprogress', customer: 'Mr. K' }, { id: 3, code: null, title: '', status: 'Done', customer: null }] });
  };
  try {
    const connection = await MelaService.connect(' Kingswood ', 'a@x.com', 'secret-pass');
    assert.equal(connection.company, 'kingswood');
    assert.equal(JSON.parse(calls[0].init.body).company, 'kingswood');
    assert.ok(calls[0].url.startsWith(MELA_API_URL));
    assert.equal(calls[1].init.headers.Authorization, 'Bearer tok.sig');
    assert.ok(![...store.values()].some(v => v.includes('secret-pass')) && ![...secure.values()].some(v => v.includes('secret-pass')), 'the password is never stored');
    const projects = await MelaService.getProjects();
    assert.equal(projects.length, 2);
    assert.equal(projects.find(p => p.id === 3).title, 'Project 3', 'a blank title still gets a usable label');
    assert.ok((await MelaService.getConnection()).lastSyncAt);
  } finally { globalThis.fetch = originalFetch; }
});

test('a rejected token flags the connection for sign-in but keeps cached projects', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => reply(401, { error: 'token_revoked' });
  try {
    await assert.rejects(MelaService.syncProjects(), /expired/i);
    const connection = await MelaService.getConnection();
    assert.equal(connection.needsReconnect, true);
    assert.equal((await MelaService.getProjects()).length, 2);
    // A stale-sync check doesn't hammer the server once flagged.
    let called = false; globalThis.fetch = async () => { called = true; return reply(200, { projects: [] }); };
    await MelaService.syncIfStale();
    assert.equal(called, false);
  } finally { globalThis.fetch = originalFetch; }
});

test('disconnect removes the token and the imported list', async () => {
  await MelaService.disconnect();
  assert.equal(await MelaService.getConnection(), null);
  assert.deepEqual(await MelaService.getProjects(), []);
  assert.equal(secure.size, 0);
});

test('open projects sort before finished ones', () => {
  const sorted = sortProjects([{ id: 1, title: 'A', status: 'Done' }, { id: 2, title: 'B', status: 'inprogress' }, { id: 3, title: 'C', status: 'completed' }]);
  assert.deepEqual(sorted.map(p => p.id), [2, 1, 3]);
});

test('project totals follow splits: a part\'s own project wins, others inherit the transaction\'s', () => {
  const villa = { source: 'mela', id: 7, title: 'Bole villa' };
  const office = { source: 'mela', id: 9, title: 'Office fit-out' };
  const txs = [
    { id: 'a', type: 'EXPENSE', amount: 1000, category: 'Materials', project: villa, date: 1 },
    { id: 'b', type: 'EXPENSE', amount: 900, category: 'Materials', project: villa, date: 2,
      splits: [{ id: 's1', amount: 600, category: 'Cement' }, { id: 's2', amount: 300, category: 'Paint', project: office }] },
    { id: 'c', type: 'INCOME', amount: 5000, category: 'Client payment', project: villa, date: 3 },
    { id: 'd', type: 'TRANSFER', amount: 50, category: 'Transfer', project: villa, date: 4 },
  ];
  const entries = projectEntries(txs);
  const v = projectTotals(entries.get(projectKey(villa)));
  assert.deepEqual({ paid: v.paid, received: v.received, net: v.net, count: v.count }, { paid: 1600, received: 5000, net: 3400, count: 3 });
  assert.equal(projectTotals(entries.get(projectKey(office))).paid, 300);
});

test('validation accepts a proper project link and rejects a malformed one', () => {
  const base = { type: 'EXPENSE', account_id: 'acc', amount: 100, date: 1, category: 'X', description: 'x' };
  assert.doesNotThrow(() => validateTransaction({ ...base, project: { source: 'mela', id: 7, title: 'Bole villa' } }));
  assert.throws(() => validateTransaction({ ...base, project: { source: 'mela', id: 'seven', title: 'x' } }), /Invalid project link/);
  assert.throws(() => validateTransaction({ ...base, splits: [{ id: '1', amount: 50, category: 'A', project: { source: 'x', id: 1, title: 't' } }, { id: '2', amount: 50, category: 'B' }] }), /Invalid project link/);
});

test('sync imports items and suppliers, and a list the role cannot see is skipped, not a sign-in failure', async () => {
  store.clear(); secure.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => {
    if (url.endsWith('action=login')) return reply(200, { token: 't.s', expires_at: 2000000000, company: 'kingswood', user: { name: 'A' }, permissions: { projects: true, items: true, suppliers: false } });
    if (url.endsWith('action=projects')) return reply(200, { projects: [{ id: 1, title: 'P1' }] });
    if (url.endsWith('action=items')) return reply(200, { items: [{ id: 5, code: 'item_5', name: 'Cement 50kg', type: 'Raw material', category: 'Materials', unit: 'bag' }, { id: 6, name: 'Hilti drill', type: 'Power tool', unit: 'pcs' }, { id: 7, name: '  ' }] });
    if (url.endsWith('action=suppliers')) return reply(403, { error: 'no_supplier_access' });
    return reply(404, {});
  };
  try {
    const connection = await MelaService.connect('kingswood', 'a@x.com', 'pw');
    assert.ok(!connection.needsReconnect, 'a skipped list is not a sign-in failure');
    assert.deepEqual(connection.permissions, { projects: true, items: true, suppliers: false });
    const items = await MelaService.getItems();
    assert.deepEqual(items.map(i => i.name), ['Cement 50kg', 'Hilti drill'], 'blank names dropped');
    assert.deepEqual(await MelaService.getSuppliers(), []);
  } finally { globalThis.fetch = originalFetch; }
});

test('Mela item types map to tool vs material, and links carry unit and category', () => {
  const { melaItemKind, melaItemLink, supplierLink } = load('./services/MelaService.ts');
  assert.equal(melaItemKind('Power tool'), 'TOOL');
  assert.equal(melaItemKind('Equipment'), 'TOOL');
  assert.equal(melaItemKind('Raw material'), 'MATERIAL');
  assert.equal(melaItemKind(null), 'MATERIAL');
  assert.deepEqual(melaItemLink({ id: 5, name: 'Cement', type: null, category: 'Materials', unit: 'bag' }), { source: 'mela', id: '5', name: 'Cement', kind: 'MATERIAL', category: 'Materials', unit: 'bag' });
  assert.equal(supplierLink({ id: 2, name: 'Abebe', store: 'Abebe Hardware' }).name, 'Abebe (Abebe Hardware)');
});

test('a Mela supplier is used in price history, and supplier links are validated', () => {
  const items = load('./utils/itemFinance.ts');
  const cement = { source: 'mela', id: '5', name: 'Cement' };
  const records = items.purchaseRecords([{ id: 't', type: 'EXPENSE', amount: 100, date: 1, sender_receiver: 'CBE TELEBIRR 0911', supplier: { source: 'mela', id: 2, name: 'Abebe Hardware' }, lines: [{ id: 'l', item: cement, quantity: 1, unit_price: 100, amount: 100 }] }]);
  assert.equal(records[0].supplier, 'Abebe Hardware');
  const base = { type: 'EXPENSE', account_id: 'a', amount: 1, date: 1, category: 'X', description: 'x' };
  assert.throws(() => validateTransaction({ ...base, supplier: { source: 'mela', id: 'x', name: 'n' } }), /Invalid supplier link/);
  assert.doesNotThrow(() => validateTransaction({ ...base, supplier: { source: 'mela', id: 2, name: 'Abebe' } }));
});

test('projects show the customer name next to the Mela customer id', async () => {
  const { customerLabel } = load('./services/MelaService.ts');
  assert.equal(customerLabel('Abebe Kebede', 'C-12'), 'Abebe Kebede (C-12)');
  assert.equal(customerLabel(null, 'C-12'), 'C-12', 'older Mela without names still shows the id');
  assert.equal(customerLabel('C-12', 'C-12'), 'C-12', 'unresolved id is not repeated');
  store.clear(); secure.clear();
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async url => url.endsWith('action=login')
    ? reply(200, { token: 't.s', expires_at: 2000000000, company: 'k', user: { name: 'A' }, permissions: { projects: true, items: false, suppliers: false } })
    : url.endsWith('action=projects') ? reply(200, { projects: [{ id: 1, title: 'Villa', customer: 'Abebe Kebede', customer_id: 'C-12' }] }) : reply(403, { error: 'no_item_access' });
  try {
    await MelaService.connect('k', 'a', 'pw');
    const [project] = await MelaService.getProjects();
    assert.equal(project.customer, 'Abebe Kebede (C-12)');
    assert.equal(project.customerId, 'C-12');
  } finally { globalThis.fetch = originalFetch; }
});
