const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('main category applies to every split in transaction and SMS forms', () => {
  for (const file of ['app/modal.tsx', 'app/draft-transactions.tsx']) {
    const source = read(file);
    assert.match(source, /current\.map\(split => \(\{ \.\.\.split, category: name \}\)\)/, file);
    assert.match(source, /Choosing a main category applies it to every split/, file);
  }
});

test('main project applies to every split without overwriting later part edits on save', () => {
  for (const file of ['app/modal.tsx', 'app/draft-transactions.tsx']) {
    const source = read(file);
    assert.match(source, /current\.map\(split => \(\{ \.\.\.split, project: value \}\)\)/, file);
    assert.match(source, /batch=\{splitEnabled\}/, file);
  }
  assert.doesNotMatch(read('app/modal.tsx'), /splits: pushProjectIntoSplits\(project, pushTagsIntoSplits/);
  assert.doesNotMatch(read('app/draft-transactions.tsx'), /finalSplits = splitActive \? pushProjectIntoSplits/);
});

test('a split added after a batch choice inherits the shared category and project', () => {
  const editor = read('components/TransactionSplitEditor.tsx');
  assert.match(editor, /splits\.every\(split => split\.category === splits\[0\]\.category\)/);
  assert.match(editor, /category: sharedCategory \|\| categories\[0\]/);
  assert.match(editor, /project: commonSplitProject\(splits\)/);
});
