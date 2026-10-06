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

test('no screen imports Alert from react-native, which is a no-op on web', () => {
  const offenders = [];
  const walk = dir => {
    for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${entry.name}`;
      if (entry.isDirectory()) { walk(rel); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(path.join(root, rel), 'utf8');
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
