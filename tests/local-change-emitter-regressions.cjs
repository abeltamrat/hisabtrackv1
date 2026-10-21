const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
function loadEmitter() {
  const file = path.join(root, 'services/LocalChangeEmitter.ts');
  const js = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', js)(require, mod, mod.exports);
  return mod.exports.default;
}
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

test('a burst of local changes reaches screen listeners once', async () => {
  const emitter = loadEmitter();
  let calls = 0;
  const unsubscribe = emitter.subscribe(() => { calls++; });
  for (let i = 0; i < 50; i++) emitter.emit();
  assert.equal(calls, 0, 'screen listeners are notified after the burst, not per write');
  await wait(150);
  assert.equal(calls, 1);
  emitter.emit();
  await wait(150);
  assert.equal(calls, 2, 'a later change is still delivered');
  unsubscribe();
});

test('immediate listeners see each change while the emitting code is still running', () => {
  // SyncService ignores changes it applies itself by checking a flag at emit
  // time; a deferred notification would arrive after the flag is cleared and
  // start another full sync in a loop.
  const emitter = loadEmitter();
  let applyingRemote = true;
  const scheduled = [];
  const unsubscribe = emitter.subscribeImmediate(() => { scheduled.push(applyingRemote); });
  emitter.emit();
  applyingRemote = false;
  emitter.emit();
  assert.deepEqual(scheduled, [true, false]);
  unsubscribe();
});

test('SyncService listens for local changes synchronously', () => {
  const source = fs.readFileSync(path.join(root, 'services/SyncService.ts'), 'utf8');
  assert.match(source, /LocalChangeEmitter\.subscribeImmediate\(\(\) => \{ if \(!this\.applyingRemote\) this\.schedule\(\); \}\)/);
});
