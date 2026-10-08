const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');

const cache = new Map();
const mocks = {};
function load(name, parent = root) {
  if (!name.startsWith('.') && !name.startsWith('@/') && !mocks[name]) return require(name);
  if (mocks[name]) return { __esModule: true, ...mocks[name] };
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} }; cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', js)(n => load(n, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}

// ── Minimal DOM, enough to drive utils/alert.web.ts ────────────────────────
function makeDom() {
  const listeners = new Map();
  class El {
    constructor(tag) {
      this.tagName = String(tag).toUpperCase();
      this.style = {}; this.children = []; this.attrs = {};
      this.parentNode = null; this.handlers = {}; this.focused = false;
      this.textContent = ''; this.type = ''; this.id = '';
    }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    addEventListener(type, fn) { (this.handlers[type] ||= []).push(fn); }
    removeEventListener(type, fn) { this.handlers[type] = (this.handlers[type] || []).filter(h => h !== fn); }
    remove() {
      if (!this.parentNode) return;
      this.parentNode.children = this.parentNode.children.filter(c => c !== this);
      this.parentNode = null;
    }
    focus() { this.focused = true; document.activeElement = this; }
    click() { (this.handlers.click || []).forEach(fn => fn({ target: this })); }
    /** Every descendant button, in document order. */
    get buttons() {
      return this.children.flatMap(c => [...(c.tagName === 'BUTTON' ? [c] : []), ...c.buttons]);
    }
    get text() {
      return [this.textContent, ...this.children.map(c => c.text)].filter(Boolean).join(' ');
    }
  }
  const document = {
    body: new El('body'),
    activeElement: null,
    createElement: tag => new El(tag),
    addEventListener: (type, fn) => { (listeners.get(type) || listeners.set(type, []).get(type)).push(fn); },
    removeEventListener: (type, fn) => listeners.set(type, (listeners.get(type) || []).filter(h => h !== fn)),
    dispatch: (type, event) => [...(listeners.get(type) || [])].forEach(fn => fn(event)),
  };
  listeners.set('keydown', []);
  document.addEventListener = (type, fn) => { if (!listeners.has(type)) listeners.set(type, []); listeners.get(type).push(fn); };
  const window = { matchMedia: () => ({ matches: false }) };
  return { document, window };
}

async function withDom(fn) {
  const dom = makeDom();
  const saved = { document: global.document, window: global.window };
  global.document = dom.document;
  global.window = dom.window;
  // The alert module keeps its own queue, so each case needs a fresh instance.
  cache.clear();
  try { return await fn(dom); } finally { global.document = saved.document; global.window = saved.window; }
}

/** The dialog focuses its default button on a timer, so let microtasks+timers run. */
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

test('web Alert renders a real dialog so confirmations are reachable', async () => {
  await withDom(async ({ document }) => {
    const { Alert } = load('./utils/alert.web.ts');
    const calls = [];

    Alert.alert('Delete Account', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel', onPress: () => calls.push('cancel') },
      { text: 'Delete', style: 'destructive', onPress: () => calls.push('delete') },
    ]);
    await settle();

    const dialog = document.body.children[0];
    assert.ok(dialog, 'a dialog is mounted — react-native-web Alert would have rendered nothing');
    const card = dialog.children[0];
    assert.equal(card.getAttribute('role'), 'alertdialog');
    assert.equal(card.getAttribute('aria-modal'), 'true');
    assert.match(card.text, /Delete Account/);
    assert.match(card.text, /Are you sure\?/);

    const buttons = dialog.buttons;
    assert.deepEqual(buttons.map(b => b.textContent), ['Cancel', 'Delete']);
    // The destructive action must be reachable, and must actually run its handler.
    buttons[1].click();
    assert.deepEqual(calls, ['delete'], 'pressing Delete runs the onPress the app relies on');
    assert.equal(document.body.children.length, 0, 'dialog is torn down after a choice');
  });
});

test('web Alert supports three buttons, destructive styling and a default OK', async () => {
  await withDom(async ({ document }) => {
    const { Alert } = load('./utils/alert.web.ts');
    const pressed = [];

    // window.confirm could not express this; three buttons must all render.
    Alert.alert('Restore Backup?', 'Pick a mode', [
      { text: 'Cancel', style: 'cancel', onPress: () => pressed.push('cancel') },
      { text: 'Merge', onPress: () => pressed.push('merge') },
      { text: 'Replace', style: 'destructive', onPress: () => pressed.push('replace') },
    ]);
    await settle();

    let buttons = document.body.children[0].buttons;
    assert.deepEqual(buttons.map(b => b.textContent), ['Cancel', 'Merge', 'Replace']);
    assert.equal(buttons[2].style.backgroundColor, '#dc2626', 'destructive button is red');
    assert.notEqual(buttons[0].style.backgroundColor, '#dc2626');
    // Every button is at least 44px tall for coarse pointers.
    buttons.forEach(b => assert.equal(b.style.minHeight, '44px'));
    buttons[1].click();
    assert.deepEqual(pressed, ['merge']);

    // A message with no buttons still gets a dismissable OK.
    Alert.alert('Saved', 'Account updated');
    await settle();
    buttons = document.body.children[0].buttons;
    assert.deepEqual(buttons.map(b => b.textContent), ['OK']);
    buttons[0].click();
    assert.equal(document.body.children.length, 0);
  });
});

test('web Alert queues concurrent calls and Escape chooses cancel', async () => {
  await withDom(async ({ document }) => {
    const { Alert } = load('./utils/alert.web.ts');
    const chosen = [];

    Alert.alert('First', 'one', [{ text: 'Cancel', style: 'cancel', onPress: () => chosen.push('first-cancel') }]);
    Alert.alert('Second', 'two', [{ text: 'OK', onPress: () => chosen.push('second-ok') }]);
    await settle();

    // Only one dialog is visible; the second must not be dropped.
    assert.equal(document.body.children.length, 1);
    assert.match(document.body.children[0].text, /First/);

    let prevented = false;
    document.dispatch('keydown', { key: 'Escape', preventDefault: () => { prevented = true; }, stopPropagation() {} });
    assert.ok(prevented, 'Escape is handled');
    assert.deepEqual(chosen, ['first-cancel'], 'Escape runs the cancel handler');

    await settle();
    assert.equal(document.body.children.length, 1, 'the queued dialog is presented next');
    assert.match(document.body.children[0].text, /Second/);
    document.body.children[0].buttons[0].click();
    assert.deepEqual(chosen, ['first-cancel', 'second-ok']);
    assert.equal(document.body.children.length, 0);
  });
});

test('web Alert honours cancelable:false and reports dismissal', async () => {
  await withDom(async ({ document }) => {
    const { Alert } = load('./utils/alert.web.ts');
    let dismissed = 0;

    Alert.alert('Updating', 'Do not close', [{ text: 'Wait' }], { cancelable: false });
    await settle();
    document.dispatch('keydown', { key: 'Escape', preventDefault() {}, stopPropagation() {} });
    assert.equal(document.body.children.length, 1, 'a non-cancelable dialog ignores Escape');
    document.body.children[0].buttons[0].click();

    // Backdrop dismissal with no cancel button reports onDismiss instead.
    Alert.alert('Note', 'Tap outside', [{ text: 'OK' }], { onDismiss: () => { dismissed += 1; } });
    await settle();
    const backdrop = document.body.children[0];
    backdrop.handlers.click.forEach(fn => fn({ target: backdrop }));
    assert.equal(dismissed, 1);
    assert.equal(document.body.children.length, 0);
  });
});

test('web Alert is inert during static prerender, where there is no document', () => {
  const saved = { document: global.document, window: global.window };
  global.document = undefined;
  global.window = undefined;
  try {
    const { Alert } = load('./utils/alert.web.ts');
    // `expo export` prerenders routes in Node; this must not throw.
    assert.doesNotThrow(() => Alert.alert('Prerender', 'no DOM here'));
  } finally {
    global.document = saved.document;
    global.window = saved.window;
  }
});

test('web Alert keeps its structural and colour contract when Aurora Glass is active', async () => {
  await withDom(async ({ document }) => {
    const { auroraFlag } = load('@/components/aurora/auroraFlag.ts');
    auroraFlag.set(true);
    try {
      const { Alert } = load('./utils/alert.web.ts');
      const pressed = [];
      Alert.alert('Delete Account', 'Are you sure?', [
        { text: 'Cancel', style: 'cancel', onPress: () => pressed.push('cancel') },
        { text: 'Keep', onPress: () => pressed.push('keep') },
        { text: 'Delete', style: 'destructive', onPress: () => pressed.push('delete') },
      ]);
      await settle();

      const dialog = document.body.children[0];
      const card = dialog.children[0];
      // The structural contract — role, attachment point, button order — is
      // identical to the non-Aurora path; only colours/blur differ.
      assert.equal(card.getAttribute('role'), 'alertdialog');
      assert.equal(card.getAttribute('aria-modal'), 'true');
      const buttons = dialog.buttons;
      assert.deepEqual(buttons.map(b => b.textContent), ['Cancel', 'Keep', 'Delete']);
      // Destructive stays this exact red regardless of theme.
      assert.equal(buttons[2].style.backgroundColor, '#dc2626');
      buttons.forEach(b => assert.equal(b.style.minHeight, '44px'));
      // The confirm action picks up the Aurora accent instead of indigo.
      assert.equal(buttons[1].style.backgroundColor, '#67e8f9');
      buttons[1].click();
      assert.deepEqual(pressed, ['keep']);
    } finally {
      auroraFlag.set(false);
    }
  });
});

test('no screen imports Alert from react-native, which is a no-op on web', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      // Comments are stripped: the docs on FormField and useFormErrors name the
      // Alert.alert pattern they exist to replace.
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      if (!/\bAlert\s*\.\s*alert\s*\(/.test(src)) continue;
      // The import must resolve to utils/alert, which is platform-split.
      const fromRn = /import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*'react-native'/s.test(src);
      const fromShim = /import\s*\{[^}]*\bAlert\b[^}]*\}\s*from\s*'@\/utils\/alert'/.test(src);
      if (fromRn || !fromShim) offenders.push(rel);
    }
  };
  ['app', 'components', 'services', 'contexts', 'hooks'].forEach(walk);
  assert.deepEqual(offenders, [], 'these files would show no dialog at all on web');
});

// ── i18n ──────────────────────────────────────────────────────────────────
function readDictionaries() {
  const src = fs.readFileSync(path.join(root, 'contexts/I18nContext.tsx'), 'utf8');
  const dictionaries = {};
  for (const locale of ['EN', 'ES', 'AM', 'OM', 'TI']) {
    const start = src.indexOf(`const ${locale}: LanguageDictionary = {`);
    assert.notEqual(start, -1, `dictionary ${locale} is missing`);
    const body = src.slice(start, src.indexOf('\n};', start));
    dictionaries[locale] = new Set([...body.matchAll(/^\s{2}'?([A-Za-z0-9_.]+)'?:/gm)].map(m => m[1]));
  }
  return dictionaries;
}

function usedTranslationKeys() {
  const keys = new Map();
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const match of src.matchAll(/(?<![A-Za-z0-9_$.])t\('([^']+)'\)/g)) {
        if (!keys.has(match[1])) keys.set(match[1], rel);
      }
    }
  };
  ['app', 'components'].forEach(walk);
  return keys;
}

test('every t() key is defined, so no screen renders a raw key name', () => {
  const en = readDictionaries().EN;
  const missing = [...usedTranslationKeys()].filter(([key]) => !en.has(key));
  assert.deepEqual(
    missing.map(([key, file]) => `${key} (${file})`),
    [],
    'these keys would be displayed verbatim to the user'
  );
});

test('all locales define the same keys, so no language silently falls back', () => {
  const dictionaries = readDictionaries();
  const gaps = [];
  for (const [locale, keys] of Object.entries(dictionaries)) {
    for (const key of dictionaries.EN) if (!keys.has(key)) gaps.push(`${locale} missing ${key}`);
    for (const key of keys) if (!dictionaries.EN.has(key)) gaps.push(`${locale} has orphan ${key}`);
  }
  assert.deepEqual(gaps, []);
});

test('no dead `t(key) || fallback` expressions remain', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      // `t()` never returns a falsy value, so the right-hand side is unreachable.
      for (const match of src.matchAll(/t\('[^']+'\)\s*\|\|/g)) offenders.push(`${rel}: ${match[0]}`);
    }
  };
  ['app', 'components'].forEach(walk);
  assert.deepEqual(offenders, []);
});

// ── Assistant currency ────────────────────────────────────────────────────
test('the assistant reports the ledger currency, never a hardcoded $', () => {
  mocks['react-native'] = { Platform: { OS: 'android' } };
  try {
    const { AIFinancialAssistant } = load('./services/AIFinancialAssistant.ts');
    const data = {
      totalIncome: 26400, totalExpense: 600.58, balance: 25799.42,
      transactions: [
        { id: 't1', type: 'INCOME', amount: 26400, category: 'Salary', date: Date.now(), description: 'Salary' },
        { id: 't2', type: 'EXPENSE', amount: 600.58, category: 'Transfer', date: Date.now(), description: 'Shop' },
      ],
      budgets: [], loans: [],
      accounts: [{ id: 'a1', name: 'CBE', currency: 'ETB', balance: 25799.42 }],
      savingsRate: 97.7, monthlyAverage: 600.58,
    };

    // The offline fallback is the path users hit with no API key configured.
    const offline = AIFinancialAssistant.getFallbackAnalysis
      ? AIFinancialAssistant.getFallbackAnalysis(data)
      : AIFinancialAssistant.getLocalChatFallback('how am i doing', data);
    assert.ok(!/\$\s?\d/.test(offline), `offline reply still prints a dollar amount:\n${offline}`);
    assert.match(offline, /ETB\s?\d/, 'offline reply states amounts in the ledger currency');

    const context = AIFinancialAssistant.generateFinancialContext(data);
    assert.ok(!/\$\s?\d/.test(context), `prompt context still prints a dollar amount:\n${context}`);
    assert.match(context, /Reporting currency: ETB/);
    assert.match(context, /Total Income: ETB 26400\.00/);

    // A different ledger currency must follow through.
    const usd = AIFinancialAssistant.generateFinancialContext({ ...data, accounts: [{ ...data.accounts[0], currency: 'USD' }] });
    assert.match(usd, /Reporting currency: USD/);
    assert.match(usd, /Total Income: USD 26400\.00/);
  } finally {
    delete mocks['react-native'];
    cache.clear();
  }
});

// ── Text integrity ────────────────────────────────────────────────────────
test('financial advisor insights use the selected ledger currency', () => {
  const { FinancialAdvisorService } = load('./services/FinancialAdvisorService.ts');
  const now = Date.now();
  const transactions = [
    { id: 'income', type: 'INCOME', amount: 1000, category: 'Salary', date: now, description: 'Salary' },
    { id: 'expense', type: 'EXPENSE', amount: 150.01, category: 'Food', date: now, description: 'Groceries' },
  ];
  const budgets = [{
    id: 'food-budget', category: 'Food', period: 'MONTHLY', limit_amount: 100,
    start_date: now - 1000, end_date: now + 1000,
  }];

  const insights = FinancialAdvisorService.analyzeTransactions(
    transactions, [], budgets, [], [], 'KES'
  );
  const budgetInsight = insights.find(insight => insight.id === 'budget-exceeded-food-budget');
  assert.ok(budgetInsight, 'an exceeded budget produces an insight');
  assert.match(budgetInsight.description, /KES 50/);
  assert.doesNotMatch(insights.map(insight => insight.description).join('\n'), /\$\s?\d/);
  cache.clear();
});

test('financial screens and notifications do not render dollar-only amounts', () => {
  const files = [
    'app/goals.tsx',
    'app/loans.tsx',
    'services/AppNotificationService.ts',
    'services/NotificationService.ts',
    'services/FinancialAdvisorService.ts',
    'services/AIFinancialAssistant.ts',
  ];
  const offenders = files.flatMap(file => {
    const source = fs.readFileSync(path.join(root, file), 'utf8');
    return [...source.matchAll(/(?:\$\$\{|\$\s*\d)/g)].map(match => `${file}: ${match[0]}`);
  });
  assert.deepEqual(offenders, []);
});

test('financial records and navigation identifiers are not written to debug logs', () => {
  const files = [
    'app/loans.tsx',
    'app/accounts.tsx',
    'app/recurring.tsx',
    'app/_layout.tsx',
    'services/database/web.ts',
  ];
  const offenders = files.filter(file =>
    /console\.log\s*\(/.test(fs.readFileSync(path.join(root, file), 'utf8'))
  );
  assert.deepEqual(offenders, []);
});

test('account deletion does not promise an unrecorded balancing expense', () => {
  const source = fs.readFileSync(path.join(root, 'app/accounts.tsx'), 'utf8');
  assert.doesNotMatch(source, /remaining balance.*recorded as an expense/i);
  assert.match(source, /has ledger history/);
});

test('linked loan deletion validates locally before detaching the other party', () => {
  const source = fs.readFileSync(path.join(root, 'app/loans.tsx'), 'utf8');
  const flow = source.slice(source.indexOf('const handleDeleteItem'), source.indexOf('// Payment Handlers'));
  assert.match(flow, /hasLedgerHistory/);
  assert.ok(flow.indexOf('dispatch(deleteLoan') < flow.indexOf('LinkedLoanService.detachLoan'));
  assert.match(flow, /upsertLoan\(loan\)/, 'a failed remote detach restores the local loan');
});

test('no user-facing string uses "?" where an ellipsis or bullet belongs', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      // A bullet list whose later markers became "?" during an encoding round-trip.
      for (const m of src.matchAll(/\n\?\s/g)) offenders.push(`${rel}: ${JSON.stringify(m[0])} (bullet lost)`);
      // Progress messages read as questions: "Opening your data?" etc.
      for (const m of src.matchAll(/'((?:Opening|Refreshing|Loading|Checking|Saving|Syncing|Preparing)[^']*)\?'/g)) {
        offenders.push(`${rel}: "${m[1]}?" (ellipsis lost)`);
      }
      if (/�/.test(src)) offenders.push(`${rel}: contains U+FFFD replacement character`);
    }
  };
  ['app', 'components', 'contexts', 'services', 'utils'].forEach(walk);
  assert.deepEqual(offenders, []);
});

// ── Update integrity ──────────────────────────────────────────────────────
const crypto = require('node:crypto');

function updateServiceWithFakeApk(bytes) {
  const deleted = [];
  mocks['react-native'] = { Platform: { OS: 'android' }, Alert: { alert() {} }, Linking: {} };
  mocks['expo-application'] = { nativeApplicationVersion: '1.0.3', nativeBuildVersion: '3', applicationId: 'com.example' };
  mocks['expo-constants'] = { default: { expoConfig: { extra: {} } } };
  mocks['expo-file-system'] = {
    File: class {
      constructor(uri) { this.uri = uri; this.exists = true; this.size = bytes.length; }
      async bytes() { return new Uint8Array(bytes); }
      delete() { deleted.push(this.uri); }
    },
  };
  mocks['expo-crypto'] = {
    CryptoDigestAlgorithm: { SHA256: 'SHA-256' },
    async digest(_algorithm, data) {
      return crypto.createHash('sha256').update(Buffer.from(data)).digest().buffer;
    },
  };
  const { UpdateService } = load('./services/UpdateService.ts');
  return { UpdateService, deleted };
}

function clearUpdateMocks() {
  for (const key of ['react-native', 'expo-application', 'expo-constants', 'expo-file-system', 'expo-crypto']) delete mocks[key];
  cache.clear();
}

test('an APK is only installed when its SHA-256 matches the manifest', async () => {
  const apk = Buffer.from('pretend-this-is-an-apk');
  const digest = crypto.createHash('sha256').update(apk).digest('hex');
  const { UpdateService, deleted } = updateServiceWithFakeApk(apk);
  try {
    // Matching digest: accepted, file kept for the installer.
    await UpdateService.verifyDownloadedPackage('file:///ok.apk', { sha256: digest, size: apk.length });
    assert.deepEqual(deleted, []);

    // The app holds REQUEST_INSTALL_PACKAGES, so an unverifiable package must
    // never reach the Android installer — this has to fail closed.
    await assert.rejects(
      () => UpdateService.verifyDownloadedPackage('file:///nohash.apk', {}),
      /missing its SHA-256 checksum/
    );

    const tampered = digest.replace(/.$/, c => (c === 'a' ? 'b' : 'a'));
    await assert.rejects(
      () => UpdateService.verifyDownloadedPackage('file:///bad.apk', { sha256: tampered }),
      /failed its integrity check/
    );
    assert.ok(deleted.includes('file:///bad.apk'), 'an unverified APK must not be left on disk');

    await assert.rejects(
      () => UpdateService.verifyDownloadedPackage('file:///short.apk', { sha256: digest, size: apk.length + 1 }),
      /wrong size/
    );
  } finally { clearUpdateMocks(); }
});

test('only a well-formed hex digest from the manifest is trusted', () => {
  const { UpdateService } = updateServiceWithFakeApk(Buffer.alloc(0));
  try {
    const valid = 'a'.repeat(64);
    assert.equal(UpdateService.getExpectedSha256({ androidSha256: valid.toUpperCase() }), valid);
    assert.equal(UpdateService.getExpectedSha256({ sha256: valid }), valid);
    // Anything malformed is treated as absent, which makes the install fail closed.
    for (const bad of ['', 'nope', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64)]) {
      assert.equal(UpdateService.getExpectedSha256({ androidSha256: bad }), undefined, `rejected: ${bad}`);
    }
    assert.equal(UpdateService.getExpectedSize({ androidSize: 1024 }), 1024);
    for (const bad of [0, -1, 1.5, '1024']) {
      assert.equal(UpdateService.getExpectedSize({ androidSize: bad }), undefined);
    }
  } finally { clearUpdateMocks(); }
});

// ── Firestore rules structure ─────────────────────────────────────────────
test('no recursive wildcard re-grants writes the push rules deny', () => {
  const rules = fs.readFileSync(path.join(root, 'firestore.rules'), 'utf8');
  // Firestore rules are additive: a `match /users/{uid}/{document=**}` allowing
  // write would override the narrower push_jobs and devices rules entirely.
  assert.ok(
    !/match\s+\/users\/\{[^}]+\}\/\{[^}]*=\*\*\}/.test(rules),
    'a recursive wildcard under /users would defeat the per-collection rules'
  );
  assert.match(rules, /match \/users\/\{userId\}\/push_jobs\/\{jobId\} \{[^}]*allow write: if false;/s);
  assert.match(rules, /match \/users\/\{userId\}\/push_receipts\/\{receiptId\} \{[^}]*allow write: if false;/s);
  // The ledger collections the client genuinely owns must still be reachable.
  for (const collectionName of ['accounts', 'transactions', 'budgets', 'loans', 'meta']) {
    const expected = `match /users/{userId}/${collectionName}/{id} { allow read, write: if owner(userId); }`;
    assert.ok(rules.includes(expected), `missing rule: ${expected}`);
  }
});

test('multi-field collection-group queries have declared composite indexes', () => {
  const functionsSrc = fs.readFileSync(path.join(root, 'functions/index.js'), 'utf8');
  const declared = new Set(
    JSON.parse(fs.readFileSync(path.join(root, 'firestore.indexes.json'), 'utf8'))
      .indexes.filter(i => i.queryScope === 'COLLECTION_GROUP').map(i => i.collectionGroup)
  );
  // Single-field equality queries use Firestore's automatic index; only these
  // multi-field/range queries need explicit composite definitions.
  assert.match(functionsSrc, /collectionGroup\('loans'\)[\s\S]*?where\('status'[\s\S]*?where\('reminderEnabled'[\s\S]*?where\('reminder_at'/);
  assert.match(functionsSrc, /collectionGroup\(PUSH_RECEIPTS_COLLECTION\)[\s\S]*?where\('status'[\s\S]*?orderBy\('createdAt'/);
  assert.ok(declared.has('loans'));
  assert.ok(declared.has('push_receipts'));
  assert.ok(!declared.has('devices'), 'single-field device-token lookup must use the automatic index');
});

// ── Contrast and legibility ───────────────────────────────────────────────
function styleSources() {
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (/\.tsx?$/.test(entry.name)) found.push([rel, fs.readFileSync(path.join(root, rel), 'utf8')]);
    }
  };
  ['app', 'components'].forEach(walk);
  return found;
}

/** WCAG relative-luminance contrast ratio between two hex colours. */
function contrast(a, b) {
  const channel = value => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const luminance = hex => {
    const n = parseInt(hex.slice(1), 16);
    return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light + 0.05) / (dark + 0.05);
}

test('the muted text palette meets WCAG AA in both themes', () => {
  const WHITE = '#ffffff';
  const SLATE_900 = '#0f172a'; // background.dark in tailwind.config.js
  // These are the pairings the codebase standardises on.
  assert.ok(contrast('#64748b', WHITE) >= 4.5, 'slate-500 must pass AA on white');
  assert.ok(contrast('#94a3b8', SLATE_900) >= 4.5, 'slate-400 must pass AA on the dark background');
  // And the values that were in use before, which did not.
  assert.ok(contrast('#94a3b8', WHITE) < 4.5, 'slate-400 on white is the failure being guarded against');
  assert.ok(contrast('#64748b', SLATE_900) < 4.5, 'slate-500 on dark is the failure being guarded against');
});

test('no light-mode muted text falls below AA', () => {
  const offenders = [];
  for (const [file, src] of styleSources()) {
    // Bare (non-`dark:`) slate-300/400 renders on a white or slate-50 surface.
    for (const m of src.matchAll(/(?<!:)\btext-slate-(300|400)\b/g)) offenders.push(`${file}: text-slate-${m[1]}`);
    // slate-500 on the dark background is 3.75:1.
    for (const _ of src.matchAll(/\bdark:text-slate-500\b/g)) offenders.push(`${file}: dark:text-slate-500`);
    // White below 90% over the indigo headers drops under 4.5:1.
    for (const m of src.matchAll(/\btext-white\/(\d+)\b/g)) {
      if (Number(m[1]) < 90) offenders.push(`${file}: text-white/${m[1]}`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no label text is smaller than the 10px baseline', () => {
  const offenders = [];
  for (const [file, src] of styleSources()) {
    for (const m of src.matchAll(/\btext-\[(\d+)px\]/g)) {
      if (Number(m[1]) < 10) offenders.push(`${file}: text-[${m[1]}px]`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the tab bar and dashboard actions are labelled for screen readers', () => {
  const tabBar = fs.readFileSync(path.join(root, 'components/CustomTabBar.tsx'), 'utf8');
  assert.match(tabBar, /accessibilityRole="tab"/);
  // Without selected state a reader cannot tell which tab is current.
  assert.match(tabBar, /accessibilityState=\{\{ selected: isActive \}\}/);
  assert.match(tabBar, /accessibilityLabel=\{t\(entry\.a11yKey\)\}/);
  // The centre FAB is icon-only and was previously unannounced.
  assert.match(tabBar, /accessibilityLabel=\{t\('addNew'\)\}/);

  const dashboard = fs.readFileSync(path.join(root, 'app/(tabs)/index.tsx'), 'utf8');
  const labels = [...dashboard.matchAll(/accessibilityLabel=/g)].length;
  // Eight quick actions plus the header refresh control.
  assert.ok(labels >= 9, `dashboard has only ${labels} accessibility labels`);
  assert.match(dashboard, /accessibilityState=\{\{ disabled: refreshing, busy: refreshing \}\}/);
});

// ── Budget period roll-forward ────────────────────────────────────────────
const { BudgetService } = load('./services/BudgetService.ts');

const MAY = (d, h = 0, m = 0, s = 0, ms = 0) => new Date(2026, 4, d, h, m, s, ms).getTime();
const periodDates = (period, over) => {
  const { start, end } = BudgetService.getCurrentPeriodRange(period, over);
  return { start_date: start, end_date: end };
};
const monthBudget = (over, extra = {}) => ({
  id: `b-${over}`, category: 'Food', period: 'MONTHLY', limit_amount: 1000,
  base_limit_amount: 1000, rollover_mode: 'NONE',
  ...periodDates('MONTHLY', over), ...extra,
});

test('budgets carry into the new period instead of disappearing', () => {
  const april = monthBudget(new Date(2026, 3, 10).getTime());

  // On the 1st of May the April budget no longer covers "now", which is what
  // made every budget vanish from the screen.
  const planned = BudgetService.planRollForward([april], MAY(1, 9));
  assert.equal(planned.length, 1);
  assert.equal(planned[0].category, 'Food');
  assert.equal(planned[0].limit_amount, 1000);
  assert.equal(planned[0].period, 'MONTHLY');
  assert.ok(planned[0].start_date <= MAY(1, 9) && planned[0].end_date >= MAY(1, 9),
    'the new period covers today');

  // Contiguity is what links the rollover chain: findPreviousBudget requires
  // exactly 1ms between one period's end and the next one's start.
  assert.equal(planned[0].start_date - april.end_date, 1);
});

test('roll-forward is idempotent and respects deletion', () => {
  const may = monthBudget(MAY(10));
  assert.deepEqual(BudgetService.planRollForward([may], MAY(15)), [],
    'a budget already covering today must not be duplicated');

  // Simulate two launches in the new period.
  const april = monthBudget(new Date(2026, 3, 10).getTime());
  const first = BudgetService.planRollForward([april], MAY(2));
  const after = [april, ...first.map((b, i) => ({ ...b, id: `new-${i}` }))];
  assert.deepEqual(BudgetService.planRollForward(after, MAY(2)), [],
    'a second launch in the same period creates nothing');

  // A deleted category has no chain left, so nothing is resurrected.
  assert.deepEqual(BudgetService.planRollForward([], MAY(2)), []);
});

test('roll-forward ids are deterministic across devices', () => {
  const april = monthBudget(new Date(2026, 3, 10).getTime());
  const first = BudgetService.planRollForward([april], MAY(2));
  const second = BudgetService.planRollForward([structuredClone(april)], MAY(2));
  assert.equal(first.length, 1);
  assert.equal(first[0].id, second[0].id);
  assert.match(first[0].id, /^rollover-MONTHLY-/);
});

test('carry-over survives a month boundary once the chain is extended', () => {
  const april = monthBudget(new Date(2026, 3, 10).getTime(), { rollover_mode: 'CARRY_UNUSED' });
  const [mayPlan] = BudgetService.planRollForward([april], MAY(2));
  const may = { ...mayPlan, id: 'may' };
  const budgets = [april, may];

  // 400 spent of April's 1000 leaves 600 to carry into May.
  const spentInApril = {
    id: 't1', type: 'EXPENSE', category: 'Food', amount: 400,
    date: new Date(2026, 3, 15).getTime(), account_id: 'a1', description: 'Groceries',
  };
  const metrics = BudgetService.calculateBudgetMetrics(may, budgets, [spentInApril]);
  assert.equal(metrics.rolloverDelta, 600, 'unused April budget carries into May');
  assert.equal(metrics.effectiveLimit, 1600);
  assert.equal(metrics.baseLimit, 1000, 'the stored limit stays the user-chosen amount');
});

test('a long-stale chain restarts cleanly rather than compounding old surplus', () => {
  const old = monthBudget(new Date(2023, 0, 10).getTime(), { rollover_mode: 'CARRY_UNUSED' });
  const planned = BudgetService.planRollForward([old], MAY(5));

  assert.equal(planned.length, 1, 'does not create three years of monthly rows');
  assert.equal(planned[0].rollover_mode, 'NONE', 'a years-old surplus is not carried forward');
  assert.ok(planned[0].start_date <= MAY(5) && planned[0].end_date >= MAY(5));
  assert.equal(planned[0].limit_amount, 1000);
});

test('weekly budgets roll forward on a weekly cadence', () => {
  const week = {
    id: 'w1', category: 'Transport', period: 'WEEKLY', limit_amount: 300,
    base_limit_amount: 300, rollover_mode: 'NONE',
    ...periodDates('WEEKLY', MAY(4)),
  };
  const planned = BudgetService.planRollForward([week], MAY(12));
  assert.ok(planned.length >= 1);
  const last = planned[planned.length - 1];
  assert.equal(last.period, 'WEEKLY');
  assert.ok(last.start_date <= MAY(12) && last.end_date >= MAY(12));
  // Each generated week is contiguous with the one before it.
  let previousEnd = week.end_date;
  for (const row of planned) {
    assert.equal(row.start_date - previousEnd, 1);
    assert.equal(row.end_date - row.start_date, 7 * 24 * 60 * 60 * 1000 - 1);
    previousEnd = row.end_date;
  }
});

// ── Report trend windows ──────────────────────────────────────────────────
const { trendBuckets, reportPeriod } = load('./utils/finance.ts');

test('trend buckets cover exactly the selected reporting period', () => {
  const now = new Date(2026, 4, 5, 14, 30).getTime(); // 5 May, month-to-date

  // "Month" is calendar month-to-date, so the chart must be 5 daily buckets —
  // not a trailing 30-day window with 25 empty slots.
  const month = reportPeriod('month', now);
  const monthBuckets = trendBuckets(month.start, month.end);
  assert.equal(monthBuckets.length, 5);
  assert.ok(monthBuckets.every(b => b.granularity === 'day'));
  assert.equal(monthBuckets[0].start, month.start, 'starts on the 1st');
  assert.equal(monthBuckets[monthBuckets.length - 1].end, month.end, 'ends at "now"');

  const week = reportPeriod('week', now);
  const weekBuckets = trendBuckets(week.start, week.end);
  assert.ok(weekBuckets.length >= 1 && weekBuckets.length <= 7);
  assert.ok(weekBuckets.every(b => b.granularity === 'day'));
});

test('"All" spans the whole history by month, not the last 12 days', () => {
  const now = new Date(2026, 4, 5).getTime();
  const oldest = new Date(2024, 0, 17).getTime();
  const all = reportPeriod('all', now, oldest);
  const buckets = trendBuckets(all.start, all.end);

  // Jan 2024 .. May 2026 inclusive = 29 months.
  assert.equal(buckets.length, 29);
  assert.ok(buckets.every(b => b.granularity === 'month'));
  assert.equal(buckets[0].start, all.start);
  assert.equal(buckets[buckets.length - 1].end, all.end);

  const year = reportPeriod('year', now);
  const yearBuckets = trendBuckets(year.start, year.end);
  // Jan..May of the current year, aggregated by month (125 days > daily cap).
  assert.equal(yearBuckets.length, 5);
  assert.ok(yearBuckets.every(b => b.granularity === 'month'));
});

test('trend buckets are contiguous, non-overlapping and bounded', () => {
  const now = new Date(2026, 4, 5, 9).getTime();
  for (const range of ['week', 'month', 'year', 'all']) {
    const period = reportPeriod(range, now, new Date(2025, 2, 3).getTime());
    const buckets = trendBuckets(period.start, period.end);
    assert.ok(buckets.length > 0, `${range} produced no buckets`);
    for (let i = 0; i < buckets.length; i++) {
      assert.ok(buckets[i].end >= buckets[i].start, `${range} bucket ${i} inverted`);
      if (i > 0) assert.equal(buckets[i].start - buckets[i - 1].end, 1, `${range} gap at ${i}`);
    }
    // No bucket may extend past the period, which would pull in future postings.
    assert.equal(buckets[0].start, period.start);
    assert.equal(buckets[buckets.length - 1].end, period.end);
  }
});

test('degenerate ranges do not produce buckets', () => {
  assert.deepEqual(trendBuckets(100, 50), [], 'end before start');
  assert.deepEqual(trendBuckets(NaN, 50), []);
  const sameDay = trendBuckets(new Date(2026, 4, 5, 1).getTime(), new Date(2026, 4, 5, 23).getTime());
  assert.equal(sameDay.length, 1);
});

// ── Ledger write cost ─────────────────────────────────────────────────────
test('transaction writes use a keyed lookup instead of scanning the table', async () => {
  mocks['@/utils/uuid'] = { generateUUID: (() => { let n = 0; return () => `id-${++n}`; })() };
  mocks['@/services/LocalChangeEmitter'] = { default: { emit() {}, subscribe: () => () => {} } };
  mocks['../LocalChangeEmitter'] = mocks['@/services/LocalChangeEmitter'];
  cache.clear();
  try {
    const { LedgerDatabase } = load('./services/database/ledger.ts');

    class CountingAdapter {
      constructor() {
        this.rows = { accounts: new Map(), transactions: new Map(), budgets: new Map(), loans: new Map() };
        this.meta = {};
        this.scans = 0;
        this.keyedLookups = 0;
      }
      async init() {}
      async getAccounts() { return structuredClone([...this.rows.accounts.values()]); }
      async getTransactions() { this.scans += 1; return structuredClone([...this.rows.transactions.values()]); }
      async getTransactionById(id) { this.keyedLookups += 1; return structuredClone(this.rows.transactions.get(id)); }
      async getBudgets() { return []; }
      async getLoans() { return []; }
      async readMeta(key) { return structuredClone(this.meta[key]); }
      async commitRows(rows, meta = {}) {
        for (const row of rows) {
          if (row.value === undefined) this.rows[row.table].delete(row.id);
          else this.rows[row.table].set(row.id, structuredClone(row.value));
        }
        Object.assign(this.meta, structuredClone(meta));
      }
    }

    const adapter = new CountingAdapter();
    const db = new LedgerDatabase(adapter, 'user-1');
    await db.init();
    const account = await db.createAccount({ name: 'CBE', type: 'BANK', balance: 1000, currency: 'ETB', is_locked: false, locked_amount: 0 });

    const created = await db.createTransaction({
      account_id: account.id, amount: 250, type: 'EXPENSE', category: 'Food',
      description: 'Lunch', date: Date.now(),
    });

    const scansBefore = adapter.scans;
    const keyedBefore = adapter.keyedLookups;

    await db.updateTransaction(created.id, { amount: 275 });
    await db.deleteTransaction(created.id);

    assert.equal(adapter.scans, scansBefore,
      'update and delete must not read the whole transactions table');
    assert.ok(adapter.keyedLookups > keyedBefore, 'they go through the keyed lookup instead');

    // An operation_id retry is also keyed, and stays idempotent.
    const first = await db.createTransaction({
      account_id: account.id, amount: 90, type: 'EXPENSE', category: 'Food',
      description: 'Coffee', date: Date.now(), operation_id: 'op-abc',
    });
    const retry = await db.createTransaction({
      account_id: account.id, amount: 90, type: 'EXPENSE', category: 'Food',
      description: 'Coffee', date: Date.now(), operation_id: 'op-abc',
    });
    assert.equal(retry.id, first.id, 'a retried operation must not create a second row');
    assert.equal(adapter.rows.transactions.size, 2, 'opening balance plus the one retried posting');
  } finally {
    for (const key of ['@/utils/uuid', '@/services/LocalChangeEmitter', '../LocalChangeEmitter']) delete mocks[key];
    cache.clear();
  }
});

test('the keyed lookup falls back for adapters that lack it', async () => {
  mocks['@/utils/uuid'] = { generateUUID: (() => { let n = 0; return () => `fb-${++n}`; })() };
  mocks['@/services/LocalChangeEmitter'] = { default: { emit() {}, subscribe: () => () => {} } };
  mocks['../LocalChangeEmitter'] = mocks['@/services/LocalChangeEmitter'];
  cache.clear();
  try {
    const { LedgerDatabase } = load('./services/database/ledger.ts');
    // No getTransactionById: older adapters and test doubles must still work.
    class LegacyAdapter {
      constructor() {
        this.rows = { accounts: new Map(), transactions: new Map(), budgets: new Map(), loans: new Map() };
        this.meta = {};
      }
      async init() {}
      async getAccounts() { return structuredClone([...this.rows.accounts.values()]); }
      async getTransactions() { return structuredClone([...this.rows.transactions.values()]); }
      async getBudgets() { return []; }
      async getLoans() { return []; }
      async readMeta(key) { return structuredClone(this.meta[key]); }
      async commitRows(rows, meta = {}) {
        for (const row of rows) {
          if (row.value === undefined) this.rows[row.table].delete(row.id);
          else this.rows[row.table].set(row.id, structuredClone(row.value));
        }
        Object.assign(this.meta, structuredClone(meta));
      }
    }
    const adapter = new LegacyAdapter();
    const db = new LedgerDatabase(adapter, 'user-1');
    await db.init();
    const account = await db.createAccount({ name: 'Cash', type: 'CASH', balance: 0, currency: 'ETB', is_locked: false, locked_amount: 0 });
    const tx = await db.createTransaction({
      account_id: account.id, amount: 40, type: 'EXPENSE', category: 'Food',
      description: 'Snack', date: Date.now(),
    });
    const updated = await db.updateTransaction(tx.id, { amount: 45 });
    assert.equal(updated.amount, 45);
    await db.deleteTransaction(tx.id);
    assert.equal(adapter.rows.transactions.size, 0);
  } finally {
    for (const key of ['@/utils/uuid', '@/services/LocalChangeEmitter', '../LocalChangeEmitter']) delete mocks[key];
    cache.clear();
  }
});

// ── Reported figures must be real ─────────────────────────────────────────
test('no screen renders a fabricated metric as user data', () => {
  const reports = fs.readFileSync(path.join(root, 'app/(tabs)/reports.tsx'), 'utf8');
  // The Budget ring of the Financial Health chart was a literal 0.75, shown to
  // every user regardless of their budgets.
  const progressChart = reports.slice(reports.indexOf('<ProgressChart'));
  const block = progressChart.slice(0, progressChart.indexOf('/>'));
  assert.ok(!/0\.75/.test(block), 'the health chart must not contain a hardcoded ratio');
  assert.match(block, /budgetHealth/, 'it is computed from real budget data');
  // With no budgets there is nothing to measure, so the ring is omitted
  // rather than filled with a placeholder.
  assert.match(reports, /budgetHealth === null \? \['Savings'\]/);
});

test('the SMS permission screen requests the real permission', () => {
  const screen = fs.readFileSync(path.join(root, 'app/(auth)/sms-permissions.tsx'), 'utf8');
  // It used to simulate the request and then claim success.
  assert.match(screen, /SMSSyncService\.requestPermissions\(\)/);
  assert.match(screen, /SMSSyncService\.hasReadSmsPermission\(\)/);
  // The stub granted itself the permission from a button handler.
  assert.ok(!/onPress: \(\) => \{\s*setHasPermission\(true\)/.test(screen),
    'permission state must never be set from a dialog button');
  // Success may only be reported when the OS actually granted it.
  assert.match(screen, /const granted = await SMSSyncService\.requestPermissions\(\);/);
  assert.match(screen, /if \(granted\)/);
  // The old copy promised data never leaves the device, contradicting the
  // privacy policy's disclosure of the optional AI provider path.
  assert.ok(!/No data is sent to external servers/.test(screen));
  assert.match(screen, /sent to the AI provider you choose/);
});

test('Android receives configured bank SMS while the app process is stopped', () => {
  const appConfig = JSON.parse(fs.readFileSync(path.join(root, 'app.json'), 'utf8'));
  const plugin = fs.readFileSync(path.join(root, 'plugins/withSmsReceiver.js'), 'utf8');
  const syncService = fs.readFileSync(path.join(root, 'services/SMSSyncService.ts'), 'utf8');
  const autoSync = fs.readFileSync(path.join(root, 'components/SMSAutoSync.tsx'), 'utf8');

  assert.ok(appConfig.expo.plugins.includes('./plugins/withSmsReceiver'));
  assert.match(plugin, /android\.provider\.Telephony\.SMS_RECEIVED/);
  assert.match(plugin, /android\.permission\.BROADCAST_SMS/);
  assert.match(plugin, /MAX_PENDING = 100/);
  assert.doesNotMatch(plugin, /put\("body"/,
    'the native handoff must not duplicate financial SMS bodies into preferences');
  assert.match(syncService, /PERMISSIONS\.READ_SMS/);
  assert.match(syncService, /PERMISSIONS\.RECEIVE_SMS/);
  assert.match(autoSync, /NativeSmsReceiver\.subscribe/);
  assert.match(autoSync, /configureSenders\(accountsLoaded \? smsSenders : \[\]\)/,
    'logout must clear the native sender allowlist');
});

// ── Keyboard handling inside modals ───────────────────────────────────────
function modalsWithInputs() {
  const found = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8').replace(/\r\n/g, '\n');
      if (!src.includes('<TextInput')) continue;
      const lines = src.split('\n');
      const opens = lines.map((l, i) => (/<Modal\b/.test(l) ? i : -1)).filter(i => i >= 0);
      const closes = lines.map((l, i) => (l.includes('</Modal>') ? i : -1)).filter(i => i >= 0);
      for (const start of opens) {
        const end = closes.find(c => c > start);
        if (end === undefined) continue;
        const body = lines.slice(start, end + 1).join('\n');
        if (!body.includes('<TextInput')) continue;
        found.push({ file: rel, line: start + 1, body });
      }
    }
  };
  ['app', 'components'].forEach(walk);
  return found;
}

test('no form field sits in a modal without keyboard handling', () => {
  // A Modal is its own window on Android, so a KeyboardAvoidingView declared
  // on the surrounding screen never reaches the fields inside it. Twelve forms
  // were affected, including creating a loan and recording a payment.
  const offenders = modalsWithInputs()
    .filter(m => !m.body.includes('<KeyboardAvoidingView') && !m.body.includes('<FormSheet'))
    .map(m => `${m.file}:${m.line}`);
  assert.deepEqual(offenders, [], 'these fields would be covered by the keyboard');
});

test('FormSheet handles the keyboard inside the modal window', () => {
  const sheet = fs.readFileSync(path.join(root, 'components/FormSheet.tsx'), 'utf8');
  // KeyboardAvoidingView does not resize a modal window, so the height is
  // measured from the keyboard events directly.
  assert.match(sheet, /Keyboard\.addListener/);
  assert.match(sheet, /keyboardWillShow|keyboardDidShow/);
  assert.match(sheet, /keyboardWillHide|keyboardDidHide/);
  // A tap on a button while the keyboard is open must not be swallowed.
  assert.match(sheet, /keyboardShouldPersistTaps="handled"/);
  // The card must clear the Android gesture bar.
  assert.match(sheet, /useSafeAreaInsets/);
  assert.match(sheet, /insets\.bottom/);
  // Screen readers need to be trapped in the dialog.
  assert.match(sheet, /accessibilityViewIsModal/);
});

test('forms share one sheet component rather than hand-rolled modals', () => {
  const adopters = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      if (fs.readFileSync(path.join(root, rel), 'utf8').includes('<FormSheet')) adopters.push(rel);
    }
  };
  walk('app');
  // Every screen whose form was covered by the keyboard now uses it.
  for (const screen of ['loans', 'accounts', 'goals', 'settings', 'categories', 'recurring',
                        'draft-transactions', 'manage-assets', 'manage-sms-rules',
                        'old-manage-assets', 'loan/[id]']) {
    assert.ok(adopters.includes(`app/${screen}.tsx`), `app/${screen}.tsx should use FormSheet`);
  }
});

test('a destructive confirmation cannot be dismissed by a stray backdrop tap', () => {
  const settings = fs.readFileSync(path.join(root, 'app/settings.tsx'), 'utf8');
  const reset = settings.slice(settings.indexOf('Confirm permanent account reset') - 600,
                               settings.indexOf('Confirm permanent account reset') + 200);
  assert.match(reset, /dismissOnBackdropPress=\{false\}/);
});

test('no screen ships invented financial records as the user\'s own', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      // Strip comments so documenting a removed placeholder does not trip this.
      const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
      // Placeholder card holders and card numbers rendered as real data.
      if (/John Doe|Jane Doe/.test(code)) offenders.push(`${rel}: placeholder card holder`);
      if (/\d{4} \*{4} \*{4} \d{4}/.test(code)) offenders.push(`${rel}: fabricated card number`);
      if (/Demo (Premium|Gold|Business)/.test(code)) offenders.push(`${rel}: demo account name`);
    }
  };
  ['app', 'components'].forEach(walk);
  assert.deepEqual(offenders, []);
});

test('the cards screen is driven by real ledger accounts', () => {
  const cards = fs.readFileSync(path.join(root, 'app/cards.tsx'), 'utf8');
  assert.match(cards, /useSelector/, 'reads accounts from the store');
  assert.match(cards, /account\.type === 'CARD' \|\| account\.type === 'SAVINGS'/);
  // Credit limits, expiry dates and networks are not in the data model, so
  // they must not be displayed at all rather than invented.
  for (const invented of ['expiry', 'network', 'limit']) {
    assert.ok(!new RegExp(`${invented}:`).test(cards), `${invented} is not a ledger field`);
  }
  assert.match(cards, /ScreenInfoCard/, 'has an empty state');
});

test('every quick action on the cards screen does something', () => {
  const cards = fs.readFileSync(path.join(root, 'app/cards.tsx'), 'utf8');
  // Three actions previously rendered with no onPress at all.
  const buttons = [...cards.matchAll(/<QuickAction\b[\s\S]*?\/>/g)].map(m => m[0]);
  assert.ok(buttons.length >= 3, `expected the action row, found ${buttons.length}`);
  for (const button of buttons) {
    assert.match(button, /onPress=\{/, 'a quick action with no handler is a dead control');
    assert.match(button, /accessibilityLabel=/);
  }
});

test('Reports shows a first-run state instead of zeroed charts', () => {
  const reports = fs.readFileSync(path.join(root, 'app/(tabs)/reports.tsx'), 'utf8');
  assert.match(reports, /hasNoLedgerData/);
  assert.match(reports, /ScreenInfoCard/);
  // Every tab must be behind the guard, or a tab switch reveals empty charts.
  for (const tab of ['overview', 'forecast', 'income', 'expense', 'trends', 'comparison']) {
    const guarded = new RegExp(`!hasNoLedgerData && activeTab === '${tab}'`);
    assert.match(reports, guarded, `the ${tab} tab is not guarded`);
  }
  // A quiet period is real data and must still render its charts.
  assert.match(reports, /accounts\.length === 0 && transactions\.length === 0/);
});

// ── Inline field validation ───────────────────────────────────────────────
const FIELD_VALIDATION_HINT = new RegExp(
  'please (enter|select|choose|pick|provide|fill)|is required|cannot be empty'
  + '|enter a valid|valid amount|valid balance|invalid amount'
  + '|select an account|select both|enter account|enter your', 'i');

test('form problems are reported on the field, not in a blocking dialog', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      // Comments are stripped: FormField's docs quote the dialog it replaces.
      const src = fs.readFileSync(path.join(root, rel), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      for (const m of src.matchAll(/Alert\.alert\(\s*'([^']*)'\s*,\s*'([^']*)'/g)) {
        const [, title, body] = m;
        // Permission prompts are a system concern, not a field problem.
        if (/permission/i.test(title + body)) continue;
        if (FIELD_VALIDATION_HINT.test(`${title} ${body}`)) offenders.push(`${rel}: "${title}: ${body}"`);
      }
    }
  };
  ['app', 'components'].forEach(walk);
  assert.deepEqual(offenders, [],
    'these dialogs name no field, so the user must hunt for the problem');
});

test('useFormErrors reports every problem at once and treats false as valid', () => {
  const { useFormErrors } = load('./hooks/useFormErrors.ts');
  // Exercise the reducer logic directly, without a React renderer.
  const states = [];
  let current = {};
  const React = require('react');
  // Minimal hook harness: useState/useCallback stand-ins.
  const originalUseState = React.useState;
  const originalUseCallback = React.useCallback;
  React.useState = (initial) => [current, (next) => {
    current = typeof next === 'function' ? next(current) : next;
    states.push(current);
  }];
  React.useCallback = (fn) => fn;
  try {
    const form = useFormErrors();
    // All failing checks surface together.
    assert.equal(form.validate({ a: 'A is wrong', b: 'B is wrong' }), false);
    assert.deepEqual(current, { a: 'A is wrong', b: 'B is wrong' });
    // `false` means the check passed, so it must not become an error.
    assert.equal(form.validate({ a: false, b: null, c: undefined }), true);
    assert.deepEqual(current, {});
    // Editing one field clears only that field.
    form.validate({ a: 'A is wrong', b: 'B is wrong' });
    form.clearError('a');
    assert.deepEqual(current, { b: 'B is wrong' });
  } finally {
    React.useState = originalUseState;
    React.useCallback = originalUseCallback;
  }
});

test('the main forms wire inline errors to their fields', () => {
  const forms = {
    'app/accounts.tsx': ['name', 'balance'],
    'app/transfer.tsx': ['amount', 'from', 'to'],
    'app/modal.tsx': ['amount', 'account', 'category'],
    'app/budget-modal.tsx': ['amount', 'category'],
    'app/loans.tsx': ['personName', 'accountId', 'amount', 'dueDate', 'paymentAmount'],
    'app/(auth)/login.tsx': ['identifier', 'email', 'password'],
    'app/categories.tsx': ['name'],
    'app/loan/[id].tsx': ['recordAmount', 'recordAccount'],
  };
  for (const [file, fields] of Object.entries(forms)) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    assert.match(src, /useFormErrors/, `${file} should use the hook`);
    for (const field of fields) {
      assert.ok(src.includes(`errors.${field}`), `${file} never renders errors.${field}`);
      assert.ok(src.includes(`clearError('${field}')`), `${file} never clears errors.${field} on edit`);
    }
    // A message the reader cannot hear is only half a fix.
    assert.match(src, /accessibilityRole="alert"/, `${file} should announce its errors`);
  }
});

// ── Icon-only controls ────────────────────────────────────────────────────
test('every icon-only control has a screen-reader label', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      // A TouchableOpacity whose only child is an icon announces nothing at all.
      for (const block of src.match(/<TouchableOpacity(?![A-Za-z])[\s\S]{0,900}?<\/TouchableOpacity>/g) ?? []) {
        if (!block.includes('<FontAwesome')) continue;
        if (block.includes('<Text')) continue;
        if (block.includes('accessibilityLabel')) continue;
        const icon = block.match(/<FontAwesome\s+name=([^\s]+)/);
        offenders.push(`${rel}: ${icon ? icon[1] : 'unknown icon'}`);
      }
    }
  };
  ['app', 'components'].forEach(walk);
  assert.deepEqual(offenders, [], 'these buttons are silent to a screen reader');
});

test('toggles expose their state, not just a label', () => {
  // A label alone cannot tell a reader whether a switch is on.
  const checks = [
    ['app/loans.tsx', /accessibilityState=\{\{ checked: globalRemindersEnabled \}\}/],
    ['app/loans.tsx', /accessibilityState=\{\{ checked: !!item\.reminderEnabled \}\}/],
    ['app/(tabs)/transactions.tsx', /accessibilityState=\{\{ selected: viewMode === 'table' \}\}/],
    ['app/(tabs)/transactions.tsx', /accessibilityState=\{\{ selected: viewMode === 'card' \}\}/],
    ['app/categories.tsx', /accessibilityState=\{\{ expanded: !isCollapsed \}\}/],
    ['app/goals.tsx', /accessibilityState=\{\{ selected: formData\.icon === icon \}\}/],
    ['components/CustomTabBar.tsx', /accessibilityState=\{\{ selected: isActive \}\}/],
  ];
  for (const [file, pattern] of checks) {
    assert.match(fs.readFileSync(path.join(root, file), 'utf8'), pattern, `${file} is missing ${pattern}`);
  }
});

test('the app bar controls are labelled and large enough to hit', () => {
  const shell = fs.readFileSync(path.join(root, 'components/AppShell.tsx'), 'utf8');
  assert.match(shell, /accessibilityLabel="Open menu"/);
  assert.match(shell, /accessibilityLabel=\{unreadCount > 0 \? `Notifications, \$\{unreadCount\} unread` : 'Notifications'\}/);
  // These were 36px icon targets built from padding: 8.
  assert.match(shell, /width: 44, height: 44/);
  // The status-bar strip and the sync banner must follow the theme.
  // Aurora shows its background through the strip; Light and Dark keep their fills.
  assert.match(shell, /backgroundColor: (isAurora \? 'transparent' : )?actualTheme === 'dark' \? '#0f172a' : '#ffffff'/);
  assert.ok(!/backgroundColor: '#fee2e2'/.test(shell), 'the sync banner must not be fixed light');
});

test('the status bar follows the theme instead of being pinned dark', () => {
  const layout = fs.readFileSync(path.join(root, 'app/_layout.tsx'), 'utf8');
  assert.match(layout, /statusBarStyle: isDark \? 'light' : 'dark'/);
  assert.ok(!/statusBarStyle: 'dark'/.test(layout), 'a pinned value fights the per-screen StatusBar');
});

// ── Theme tokens ──────────────────────────────────────────────────────────
test('theme tokens match the Tailwind palette and meet AA both ways', () => {
  const { themeTokens } = load('./constants/theme.ts');
  const light = themeTokens(false);
  const dark = themeTokens(true);

  // Backgrounds come straight from tailwind.config.js.
  assert.equal(light.background, '#f8fafc');
  assert.equal(dark.background, '#0f172a');

  // Secondary text is the pairing the contrast sweep standardised on.
  assert.ok(contrast(light.textMuted, light.surface) >= 4.5,
    `light textMuted is ${contrast(light.textMuted, light.surface).toFixed(2)}:1 on surface`);
  assert.ok(contrast(dark.textMuted, dark.background) >= 4.5,
    `dark textMuted is ${contrast(dark.textMuted, dark.background).toFixed(2)}:1 on background`);
  // Body text must clear AA comfortably in both themes.
  assert.ok(contrast(light.text, light.surface) >= 7);
  assert.ok(contrast(dark.text, dark.surface) >= 7);

  // Both themes define every token, so a screen cannot read undefined.
  assert.deepEqual(Object.keys(light).sort(), Object.keys(dark).sort());
  for (const [key, value] of Object.entries(light)) {
    assert.match(value, /^#[0-9a-f]{6}$/i, `light.${key} is not a hex colour`);
    assert.match(dark[key], /^#[0-9a-f]{6}$/i, `dark.${key} is not a hex colour`);
  }
});

test('screens using theme tokens declare them in scope', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      const usesTokens = /theme\.(background|surface|surfaceMuted|text|textMuted|textSubtle|border|primary|danger|success|warning)\b/.test(src);
      if (!usesTokens) continue;
      if (!src.includes('const theme = themeTokens(')) offenders.push(`${rel}: no themeTokens() call`);
      if (!src.includes("from '@/constants/theme'")) offenders.push(`${rel}: missing import`);
    }
  };
  ['app', 'components'].forEach(walk);
  assert.deepEqual(offenders, []);
});

// ── i18n consistency ──────────────────────────────────────────────────────
/**
 * Screens that already call `t()` must not also hardcode user-facing text:
 * a half-translated screen shows an Amharic, Oromo or Tigrinya speaker a
 * mixture of their language and English, which reads worse than either.
 *
 * These counts are a ratchet, not a target. Lower them as strings are
 * extracted; the test fails if a screen gains new hardcoded text.
 */
const HARDCODED_BASELINE = {
  'app/(tabs)/index.tsx': 0,
  'app/(tabs)/reports.tsx': 16,
  'app/(tabs)/transactions.tsx': 6,
  'app/loans.tsx': 5,
  'app/settings.tsx': 60,
};

function hardcodedJsxText(src) {
  const found = new Set();
  for (const m of src.matchAll(/>([A-Z][A-Za-z][A-Za-z &',.%-]{6,40})</g)) {
    const text = m[1].trim();
    if (text.split(/\s+/).length >= 2) found.add(text);
  }
  return found;
}

test('localised screens do not gain new hardcoded text', () => {
  const regressions = [];
  for (const [file, baseline] of Object.entries(HARDCODED_BASELINE)) {
    const src = fs.readFileSync(path.join(root, file), 'utf8');
    const count = hardcodedJsxText(src).size;
    if (count > baseline) {
      regressions.push(`${file}: ${count} hardcoded strings, baseline ${baseline}`);
    }
  }
  assert.deepEqual(regressions, [],
    'extract these into the dictionary, or raise the baseline deliberately');
});

test('a screen that uses t() keeps every locale able to render it', () => {
  // `t()` falls back EN -> key, so a missing EN entry is the only hard failure;
  // the per-locale check above guards parity for everything the app ships.
  const en = readDictionaries().EN;
  const unresolvable = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
      for (const m of src.matchAll(/(?<![A-Za-z0-9_$.])t\('([^']+)'\)/g)) {
        if (!en.has(m[1])) unresolvable.push(`${rel}: ${m[1]}`);
      }
    }
  };
  ['app', 'components'].forEach(walk);
  assert.deepEqual(unresolvable, []);
});

// ── Dark mode and overflow ────────────────────────────────────────────────
function tsxSources() {
  const out = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx$/.test(entry.name)) continue;
      const raw = fs.readFileSync(path.join(root, rel), 'utf8');
      // Comments are stripped so notes about removed patterns do not trip these.
      out.push([rel, raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')]);
    }
  };
  ['app', 'components'].forEach(walk);
  return out;
}

test('muted body text is readable on the dark cards', () => {
  // slate-500 is 4.76:1 on white but only 3.07:1 on the slate-800 cards, so a
  // bare occurrence looks like text that never switched theme.
  const offenders = [];
  for (const [file, src] of tsxSources()) {
    for (const m of src.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/gs)) {
      const tokens = (m[1] ?? m[2] ?? '').split(/\s+/);
      if (!tokens.includes('text-slate-500')) continue;
      if (tokens.some(t => t.startsWith('dark:text-'))) continue;
      offenders.push(`${file}: text-slate-500 with no dark variant`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('no CSS pseudo-class or sibling utility is used, since none apply', () => {
  const offenders = [];
  for (const [file, src] of tsxSources()) {
    // `last:`/`active:` and `space-y-*` rely on selectors React Native has no
    // equivalent for; they compile away and silently do nothing.
    for (const m of src.matchAll(/\b(last|first|odd|even|hover|active|focus|visited):/g)) {
      offenders.push(`${file}: ${m[1]}:`);
    }
    for (const m of src.matchAll(/\bspace-[xy]-\d/g)) offenders.push(`${file}: ${m[0]}`);
  }
  assert.deepEqual(offenders, [], 'use gap-* and activeOpacity instead');
});

test('no icon colour is hardcoded black or white against an unknown surface', () => {
  const offenders = [];
  for (const [file, src] of tsxSources()) {
    for (const m of src.matchAll(/color="(#000|#000000)"/g)) {
      offenders.push(`${file}: ${m[1]} is invisible on the dark theme`);
    }
  }
  assert.deepEqual(offenders, []);
});

test('the reported screens constrain long values and amounts', () => {
  const detail = fs.readFileSync(path.join(root, 'app/transaction/[id].tsx'), 'utf8');
  // Every label/value row goes through one component that truncates the value.
  assert.match(detail, /function DetailRow/);
  assert.match(detail, /numberOfLines=\{lines\}[\s\S]*?className="[^"]*flex-1 text-right"/);
  // The amount shrinks rather than pushing out of the card.
  assert.match(detail, /adjustsFontSizeToFit/);
  assert.match(detail, /themeTokens/, 'icon colours must follow the theme');

  const accounts = fs.readFileSync(path.join(root, 'app/accounts.tsx'), 'utf8');
  // sms_number is a comma-separated sender list and ran past the card edge.
  assert.match(accounts, /numberOfLines=\{1\} className="text-slate-500 text-xs dark:text-slate-400">SMS:/);
  assert.match(accounts, /adjustsFontSizeToFit/);
  assert.match(accounts, /themeTokens/);

  const account = fs.readFileSync(path.join(root, 'app/account/[id].tsx'), 'utf8');
  // The header title had no colour class at all, so it rendered black on dark.
  assert.match(account, /className="font-bold text-lg text-slate-900 dark:text-white flex-1 text-center"/);
  assert.match(account, /tint=\{isDark \? 'dark' : 'light'\}/);
  assert.match(account, /adjustsFontSizeToFit/);
});
