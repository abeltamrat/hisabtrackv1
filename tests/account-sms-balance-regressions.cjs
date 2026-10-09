const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const cache = new Map();

function load(name, parent = root) {
  if (!name.startsWith('.') && !name.startsWith('@/')) return require(name);
  let file = name.startsWith('@/') ? path.join(root, name.slice(2)) : path.resolve(parent, name);
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file).exports;
  const mod = { exports: {} };
  cache.set(file, mod);
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', js)(dependency => load(dependency, path.dirname(file)), mod, mod.exports);
  return mod.exports;
}

const { findLatestSmsBalance } = load('./utils/latestSmsBalance.ts');

test('latest matching bank SMS supplies the stated balance', () => {
  const messages = [
    {
      id: 'older-right-account', address: 'CBE', date: 100,
      body: 'You have successfully transferred ETB100.00 from account 1***4191. Your current balance is ETB1,200.00.',
    },
    {
      id: 'newer-wrong-account', address: 'CBE', date: 300,
      body: 'You have successfully transferred ETB50.00 from account 1***2073. Your current balance is ETB9,999.00.',
    },
    {
      id: 'newest-right-account', address: 'CBE', date: 400,
      body: 'You have successfully transferred ETB200.00 from account 1***4191. Your current balance is ETB1,000.00.',
    },
  ];

  const result = findLatestSmsBalance(messages, '1000004191');
  assert.equal(result.balance, 1000);
  assert.equal(result.smsId, 'newest-right-account');
  assert.equal(result.accountNumber, '4191');
});

test('balance-only alerts and zero balances are supported', () => {
  const result = findLatestSmsBalance([{
    id: 'balance-only', address: 'MyBank', date: 500,
    body: 'Account ****4191 available balance: ETB 0.00',
  }], '4191');

  assert.equal(result.balance, 0);
  assert.equal(result.date, 500);
});

test('account form keeps manual override and places SMS before initial balance', () => {
  const source = fs.readFileSync(path.join(root, 'app/accounts.tsx'), 'utf8');
  assert.ok(source.indexOf('Bank SMS sender / number') < source.indexOf("editingId ? 'Current Balance' : 'Initial Balance'"));
  assert.match(source, /balanceEntrySource\.current = value\.trim\(\) \? 'MANUAL' : 'EMPTY'/);
  assert.match(source, /balanceEntrySource\.current !== 'MANUAL'/);
  assert.match(source, /balance_source: importedBalance \? 'SMS' : 'MANUAL'/);
});

test('SMS balance lookup is not restricted to Bank-type accounts', () => {
  // A card, savings, or mobile-money account can just as plausibly have a
  // bank/telco SMS sender with balance info — gating the lookup to only
  // accountType === 'BANK' meant picking a sender on any other type silently
  // did nothing, with no error or hint shown to explain why.
  const source = fs.readFileSync(path.join(root, 'app/accounts.tsx'), 'utf8');
  assert.doesNotMatch(source, /accountType !== 'BANK'/);
  assert.doesNotMatch(source, /accountType === 'BANK'/);
  assert.match(source, /!editingId && smsNumber\.trim\(\)/);
});

test('SMS-derived opening balance prevents older messages being counted again', () => {
  const source = fs.readFileSync(path.join(root, 'services/SMSSyncService.ts'), 'utf8');
  assert.match(source, /account\.balance_source === 'SMS'/);
  assert.match(source, /Math\.max\(sinceTimestamp, account\.balance_as_of \+ 1\)/);
});

test('database and backup validation reject malformed SMS balance metadata', () => {
  const ledger = fs.readFileSync(path.join(root, 'services/database/ledger.ts'), 'utf8');
  const backup = fs.readFileSync(path.join(root, 'services/BackupService.ts'), 'utf8');
  for (const source of [ledger, backup]) {
    assert.match(source, /\['MANUAL', 'SMS'\]\.includes\(a\.balance_source\)/);
    assert.match(source, /a\.balance_source === 'SMS' && a\.balance_as_of === undefined/);
  }
});
