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

test('project is an opt-in "project cost" toggle under split, not a field on every expense', () => {
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const picker = read('components/ProjectPicker.tsx');
  assert.match(picker, /export function ProjectCostToggle/);
  assert.match(read('app/modal.tsx'), /if \(!next\) \{[\s\S]*setProject\(undefined\);[\s\S]*setLines\(current => withoutProjects\(current\)\);[\s\S]*project: undefined/, 'unticking clears the transaction, item, and split projects');
  const modal = read('app/modal.tsx');
  assert.ok(!/<ProjectField /.test(modal), 'no always-on project field');
  assert.ok(modal.indexOf('<ProjectCostToggle') > modal.indexOf('Split across categories'), 'toggle sits under split');
  const drafts = read('app/draft-transactions.tsx');
  assert.ok(drafts.indexOf('<ProjectCostToggle') > drafts.indexOf('accessibilityLabel="Split across categories"'));
  assert.match(drafts, /editedType !== 'TRANSFER' && project \? \{ project \}/);
  assert.match(drafts, /input\.project \? \{ project: input\.project \}/, 'fund entries from SMS carry the project');
  assert.match(read('components/funds/FundEntrySheet.tsx'), /<ProjectCostToggle checked=\{projectCost\}/);
});

test('with a split, the project lives on each part and the main toggle becomes a batch control', () => {
  const { pushProjectIntoSplits, commonSplitProject } = load('./utils/projectFinance.ts');
  const villa = { source: 'mela', id: 7, title: 'Bole villa' };
  const office = { source: 'mela', id: 9, title: 'Office' };
  const parts = pushProjectIntoSplits(villa, [{ id: 'a', amount: 60 }, { id: 'b', amount: 40, project: office }]);
  assert.deepEqual(parts.map(p => p.project.id), [7, 9], 'only parts without a project inherit it');
  assert.equal(commonSplitProject([{ project: villa }, { project: { ...villa } }]).id, 7);
  assert.equal(commonSplitProject([{ project: villa }, { project: office }]), undefined, 'mixed projects collapse to none');
  assert.equal(commonSplitProject([{ project: villa }, {}]), undefined);

  // Old saved shape (transaction project + split) and new shape (pushed onto parts) report the same totals.
  const old = { id: 'o', type: 'EXPENSE', amount: 100, date: 1, project: villa, splits: [{ id: 'a', amount: 60, category: 'A' }, { id: 'b', amount: 40, category: 'B', project: office }] };
  const fresh = { ...old, project: undefined, splits: pushProjectIntoSplits(villa, old.splits) };
  for (const tx of [old, fresh]) {
    const entries = projectEntries([tx]);
    assert.equal(projectTotals(entries.get(projectKey(villa))).paid, 60);
    assert.equal(projectTotals(entries.get(projectKey(office))).paid, 40);
  }
  // Items on a split whose parts share one project still count toward it.
  const itemized = { id: 'i', type: 'EXPENSE', amount: 100, date: 1, splits: [{ id: 'a', amount: 50, category: 'A', project: villa }, { id: 'b', amount: 50, category: 'B', project: villa }], lines: [{ id: 'l', item: { source: 'local', id: 'x', name: 'x' }, quantity: 1, unit_price: 70, amount: 70 }] };
  assert.equal(projectTotals(projectEntries([itemized]).get(projectKey(villa))).paid, 100);

  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  assert.match(read('app/modal.tsx'), /<ProjectCostToggle/);
  assert.match(read('app/modal.tsx'), /batch=\{splitEnabled\}/);
  assert.match(read('app/modal.tsx'), /project: type !== 'TRANSFER' && !splitEnabled && projectCost \? project : undefined/);
  assert.match(read('app/draft-transactions.tsx'), /<ProjectCostToggle/);
  assert.match(read('app/draft-transactions.tsx'), /batch=\{splitEnabled\}/);
  assert.match(read('components/funds/FundEntrySheet.tsx'), /\{!splitEnabled && <ProjectCostToggle/);
  assert.match(read('functions/index.js'), /tags: fundTags\(split\.tags\), project: fundProject\(split\.project\)/, 'server keeps each part\'s project');
  assert.match(read('services/SharedFundService.ts'), /parseProject\(item\.project\)/);
});

test('with a split, each part has its own "project cost" and "itemize" checkboxes', () => {
  const lines = load('./utils/splitLines.ts');
  const item = name => ({ source: 'local', id: name, name });
  const line = (id, amount, extra = {}) => ({ id, item: item(id), quantity: 1, unit_price: amount, amount, ...extra });
  const parts = [{ id: 'a', amount: 100, category: 'Materials' }, { id: 'b', amount: 50, category: 'Labour' }];

  // Turning split on: items go to the first part with room; off: they're the transaction's again.
  const attached = lines.attachLinesToSplits([line('x', 80), line('y', 40)], parts);
  assert.deepEqual(attached.map(l => l.split_id), ['a', 'b']);
  assert.deepEqual(lines.detachLines(attached).map(l => l.split_id), [undefined, undefined]);
  // Saving keeps only items of existing parts and drops blank rows; without a split, no part links.
  assert.deepEqual(lines.linesForSave([...attached, line('z', 5, { split_id: 'gone' }), { ...line('blank', 0), item: item('') }], parts).map(l => l.id), ['x', 'y']);
  assert.equal(lines.linesForSave(attached)[0].split_id, undefined);
  assert.equal(lines.overfilledSplit([line('x', 60, { split_id: 'b' })], parts).split.id, 'b');
  assert.deepEqual(lines.withoutProjects([{ project: { source: 'mela', id: 1, title: 't' } }, {}]), [{}, {}]);

  // Validation: an item must belong to an existing part and fit inside it.
  const base = { type: 'EXPENSE', account_id: 'a', amount: 150, date: 1, category: 'X', description: 'x', splits: parts };
  assert.doesNotThrow(() => validateTransaction({ ...base, lines: [line('x', 80, { split_id: 'a' })] }));
  assert.throws(() => validateTransaction({ ...base, lines: [line('x', 60, { split_id: 'b' })] }), /exceed their split part/);
  assert.throws(() => validateTransaction({ ...base, lines: [line('x', 10, { split_id: 'nope' })] }), /missing split part/);

  // Reports: a project part counts its items and remainder; a non-project part counts nowhere.
  const villa = { source: 'mela', id: 7, title: 'Villa' };
  const tx = { ...base, id: 't', splits: [{ ...parts[0], project: villa }, parts[1]], lines: [line('cement', 70, { split_id: 'a' }), line('food', 20, { split_id: 'b' })] };
  const entries = projectEntries([tx]).get(projectKey(villa));
  assert.equal(projectTotals(entries).paid, 100);
  assert.deepEqual(entries.map(e => e.lineId ?? 'rest'), ['cement', 'rest']);
  const records = load('./utils/itemFinance.ts').purchaseRecords([tx]);
  assert.equal(records.find(r => r.lineId === 'cement').project.id, 7, 'item prices know the part\'s project');
  assert.equal(records.find(r => r.lineId === 'food').project, undefined);

  // UI: per-part checkboxes; the whole-transaction ones hide while split.
  const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
  const editor = read('components/TransactionSplitEditor.tsx');
  assert.match(editor, /This is a project cost/);
  assert.match(editor, /Itemize this part/);
  assert.match(read('app/modal.tsx'), /type !== 'TRANSFER' && !splitEnabled && \(\s*<View[^>]*>\s*<TouchableOpacity accessibilityRole="checkbox" accessibilityState=\{\{ checked: itemize \}\}/);
  assert.match(read('functions/index.js'), /split_id: line\.split_id === undefined \|\| line\.split_id === null \? undefined : fundSplitRef\(line\.split_id, splits\)/);
});
