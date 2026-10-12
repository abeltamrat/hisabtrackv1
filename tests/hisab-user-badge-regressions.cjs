const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

test('linked HisabTrack people use one accessible coin-and-link badge', () => {
  const badge = read('components/HisabUserBadge.tsx');
  assert.match(badge, /hisab-coin-icon\.png/);
  assert.match(badge, /name="link"/);
  assert.match(badge, /accessibilityLabel="HisabTrack user"/);
  assert.match(badge, /if \(!linked\) return null/);
});

test('the app-user badge follows people through shared fields, records and workflows', () => {
  const surfaces = [
    'components/PersonPicker.tsx',
    'components/PersonLinkField.tsx',
    'app/people/index.tsx',
    'app/people/[id].tsx',
    'app/modal.tsx',
    'app/draft-transactions.tsx',
    'app/(tabs)/transactions.tsx',
    'app/transaction/[id].tsx',
    'app/loans.tsx',
    'app/loan/[id].tsx',
    'app/recurring.tsx',
    'app/community.tsx',
    'app/messages/index.tsx',
    'app/smart-review.tsx',
    'app/funds.tsx',
    'components/funds/FundEntryRow.tsx',
    'components/funds/FundInviteSheets.tsx',
    'components/LinkedLoanPendingBanner.tsx',
  ];
  for (const file of surfaces) assert.match(read(file), /HisabUserBadge/, file);
  assert.match(read('components/HisabUserBadge.tsx'), /people\.filter\(person => !!person\.linkedUid/);
});
