const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'components', 'LineItemsEditor.tsx'), 'utf8');

test('purchase-history item suggestions remain selectable while the name input blurs', () => {
  assert.match(source, /blurTimer = useRef/);
  assert.match(source, /onPressIn=\{\(\) => \{ if \(blurTimer\.current\) clearTimeout\(blurTimer\.current\); \}\}/);
  assert.match(source, /onPress=\{\(\) => pick\(entry\)\}/);
  assert.match(source, /accessibilityLabel=\{`Use item \$\{entry\.item\.name\}`\}/);
  assert.match(source, /setQuery\(entry\.item\.name\)/);
  assert.match(source, /onChange\(\{ item: entry\.item/);
});

test('confirm-transaction sheet lets suggestion taps through while the keyboard is open', () => {
  const drafts = fs.readFileSync(path.join(__dirname, '..', 'app', 'draft-transactions.tsx'), 'utf8');
  assert.match(drafts, /<ScrollView className="max-h-\[60vh\]"[^>]*keyboardShouldPersistTaps="handled"/);
});

test('an itemized split part follows its items until the amount is typed', () => {
  const editor = fs.readFileSync(path.join(__dirname, '..', 'components', 'TransactionSplitEditor.tsx'), 'utf8');
  assert.match(editor, /if \(autoAmount\.has\(splitId\)\) update\(splitId, \{ amount: sumMoney\(next\.map\(line => line\.amount\)\) \}\)/);
  assert.match(editor, /onChangeText=\{value => \{ setAuto\(split\.id, false\);/);
  // Turning itemize off clears the items without zeroing the part.
  assert.doesNotMatch(editor, /setPartLines\(split\.id, \[\]\)/);
  assert.match(editor, /<LineItemsEditor[\s\S]*?nested/);
});
