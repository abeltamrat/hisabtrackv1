const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(read('utils/tags.ts'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(require, mod, mod.exports);
const { pushTagsIntoSplits, mergeSplitTags } = mod.exports;

test('whole-transaction tags fill only the parts that have none', () => {
  const parts = [{ id: 'a', tags: ['cement'] }, { id: 'b' }, { id: 'c', tags: [] }];
  const out = pushTagsIntoSplits(['wedding'], parts);
  assert.deepEqual(out.map(p => p.tags), [['cement'], ['wedding'], ['wedding']]);
  assert.notEqual(out[1].tags, out[2].tags, 'each part gets its own copy');
  assert.equal(pushTagsIntoSplits(undefined, parts), parts);
});

test('turning a split off merges part tags without duplicates', () => {
  assert.deepEqual(mergeSplitTags([{ tags: ['Wedding', 'cement'] }, { tags: ['wedding'] }, {}]), ['Wedding', 'cement']);
  assert.equal(mergeSplitTags([{}, {}]), undefined);
});

test('the transaction tag box hides while split, and splits save per-part tags only', () => {
  const modal = read('app/modal.tsx');
  assert.match(modal, /\{!\(type !== 'TRANSFER' && splitEnabled\) && <View[^>]*>\s*<Text[^>]*>Tags \(Optional\)/);
  assert.match(modal, /tags: type !== 'TRANSFER' && splitEnabled \? undefined : parseTagInput\(tagsInput\)/);
  assert.match(modal, /splits: pushProjectIntoSplits\(project, pushTagsIntoSplits\(parseTagInput\(tagsInput\), splits\)\)/);
  const drafts = read('app/draft-transactions.tsx');
  assert.match(drafts, /\{!\(editedType !== 'TRANSFER' && splitEnabled\) && <View className="mb-6">\s*<Text[^>]*>Tags \(Optional\)/);
  assert.match(drafts, /const parsedTags = splitActive \? undefined : parseTagInput\(tagsInput\)/);
  const fund = read('components/funds/FundEntrySheet.tsx');
  assert.match(fund, /\{!\(mode === 'pay' && splitEnabled\) && <View className="mb-4">/);
  assert.match(fund, /tags: splitActive \? undefined : tags/);
});
