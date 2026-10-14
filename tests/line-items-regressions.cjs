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
