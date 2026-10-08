const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const nodeCrypto = require('node:crypto');

class HttpsError extends Error { constructor(code, message) { super(message); this.code = code; } }

// Same in-memory Firestore as functions-regressions.cjs, plus collection
// queries (== / array-contains) and an email-addressable auth directory.
function environment({ users = {} } = {}) {
  const rows = new Map(); let chain = Promise.resolve();
  const snapshot = ref => ({ exists: rows.has(ref.path), data: () => structuredClone(rows.get(ref.path)), ref, id: ref.path.split('/').at(-1) });
  const children = p => [...rows.keys()].filter(k => k.startsWith(p + '/') && !k.slice(p.length + 1).includes('/'));
  const collection = p => {
    const filters = [];
    const q = {
      path: p, query: true, doc: id => doc(p + '/' + id),
      where(field, op, value) { filters.push({ field, op, value }); return q; },
      get: async () => ({ docs: children(p).filter(k => filters.every(({ field, op, value }) => {
        const actual = rows.get(k)[field];
        return op === '==' ? actual === value : op === 'array-contains' ? Array.isArray(actual) && actual.includes(value) : false;
      })).map(k => snapshot(doc(k))) }),
    };
    return q;
  };
  const doc = p => ({
    path: p, id: p.split('/').at(-1), collection: n => collection(p + '/' + n), get: async () => snapshot(doc(p)),
    set: async value => rows.set(p, structuredClone(value)),
    update: async value => rows.set(p, { ...rows.get(p), ...structuredClone(value) }),
    delete: async () => rows.delete(p),
  });
  const db = {
    doc, collection,
    recursiveDelete: async ref => { for (const k of [...rows.keys()]) if (k === ref.path || k.startsWith(ref.path + '/')) rows.delete(k); },
    runTransaction: fn => {
      const next = chain.then(async () => {
        const writes = [];
        const tx = {
          get: async ref => (ref.query ? ref.get() : snapshot(ref)),
          set: (ref, v) => writes.push(() => rows.set(ref.path, structuredClone(v))),
          update: (ref, v) => writes.push(() => { if (!rows.has(ref.path)) throw Error('missing ' + ref.path); rows.set(ref.path, { ...rows.get(ref.path), ...structuredClone(v) }); }),
          create: (ref, v) => { if (rows.has(ref.path)) throw Error('exists ' + ref.path); writes.push(() => rows.set(ref.path, structuredClone(v))); },
        };
        const result = await fn(tx); writes.forEach(write => write()); return result;
      });
      chain = next.catch(() => {}); return next;
    },
  };
  const deletedUsers = [];
  const auth = {
    getUser: async uid => ({ uid, displayName: uid }),
    getUserByEmail: async email => {
      const found = Object.entries(users).find(([, user]) => user.email === email);
      if (!found) { const error = new Error('no user'); error.code = 'auth/user-not-found'; throw error; }
      return { uid: found[0], ...found[1] };
    },
    deleteUser: async uid => { deletedUsers.push(uid); },
  };
  const wrap = (_, fn) => fn;
  const mocks = {
    crypto: nodeCrypto,
    'firebase-admin': { initializeApp() {}, firestore: Object.assign(() => db, { FieldValue: { serverTimestamp: () => Date.now() } }), auth: () => auth },
    'expo-server-sdk': { Expo: class { static isExpoPushToken() { return true; } } },
    'firebase-functions': { logger: { info() {}, debug() {}, warn() {}, error() {} } },
    'firebase-functions/v2/firestore': { onDocumentCreated: wrap },
    'firebase-functions/v2/scheduler': { onSchedule: wrap },
    'firebase-functions/v2/https': { onCall: wrap, HttpsError },
  };
  const api = {};
  new Function('require', 'exports', fs.readFileSync(path.join(__dirname, '../functions/index.js'), 'utf8'))(name => mocks[name], api);
  const call = (uid, data, token = {}) => api.mutateSharedFund({ auth: { uid, token }, data });
  return { rows, api, call, deletedUsers };
}

const day = Date.UTC(2026, 9, 1);
const EVERYONE = {
  bob: { email: 'bob@example.com', emailVerified: true, displayName: 'Bob' },
  eve: { email: 'eve@example.com', emailVerified: false, displayName: 'Eve', providerData: [{ providerId: 'password' }] },
  gus: { email: 'gus@example.com', emailVerified: false, displayName: 'Gus', providerData: [{ providerId: 'google.com' }] },
};

// Owner alice creates a fund and bob joins it with the code.
async function acceptedFund(env, extra = {}) {
  const created = await env.call('alice', { action: 'create', fundId: 'f1', name: 'Office petty cash', currency: 'ETB', floatTarget: 5000, myName: 'Alice', ...extra });
  await env.call('bob', { action: 'accept', code: created.code, myName: 'Bob' });
  return created;
}
const fund = env => env.rows.get('sharedFunds/f1');

test('fund invites only find proven emails and never leak more than a display name', async () => {
  const env = environment({ users: EVERYONE });
  const found = await env.call('alice', { action: 'create', fundId: 'a', name: 'A', currency: 'ETB', email: ' Bob@Example.com ' });
  assert.equal(found.found, true);
  assert.equal(found.displayName, 'Bob');
  assert.equal(found.email, undefined);
  assert.deepEqual(env.rows.get('sharedFunds/a').members, ['alice', 'bob']);
  assert.equal(env.rows.get('sharedFunds/a').inviteEmailHint, 'b***@example.com');
  assert.match(found.code, /^[A-HJ-NP-Z2-9]{8}$/);

  // An unverified email/password account cannot claim someone else's address.
  const unverified = await env.call('alice', { action: 'create', fundId: 'b', name: 'B', currency: 'ETB', email: 'eve@example.com' });
  assert.equal(unverified.found, false);
  assert.deepEqual(env.rows.get('sharedFunds/b').members, ['alice']);
  const google = await env.call('alice', { action: 'create', fundId: 'c', name: 'C', currency: 'ETB', email: 'gus@example.com' });
  assert.equal(google.found, true);

  await assert.rejects(env.call('bob', { action: 'create', fundId: 'd', name: 'D', currency: 'ETB', email: 'bob@example.com' }), { code: 'invalid-argument' });
  await assert.rejects(env.api.mutateSharedFund({ data: { action: 'create' } }), { code: 'unauthenticated' });
});

test('an invite code works once, never for the owner, and guessing is rate limited', async () => {
  const env = environment();
  const { code } = await env.call('alice', { action: 'create', fundId: 'f1', name: 'Float', currency: 'ETB' });
  await assert.rejects(env.call('alice', { action: 'accept', code }), { code: 'permission-denied' });
  const joined = await env.call('bob', { action: 'accept', code: `${code.slice(0, 4)}-${code.slice(4).toLowerCase()}` });
  assert.equal(joined.fundId, 'f1');
  assert.equal(fund(env).linkStatus, 'ACCEPTED');
  assert.deepEqual(fund(env).members, ['alice', 'bob']);
  assert.equal(fund(env).inviteCode, null);
  // Idempotent for the person who joined, closed to everyone else.
  await env.call('bob', { action: 'accept', code });
  await assert.rejects(env.call('carol', { action: 'accept', code }), { code: 'failed-precondition' });

  // Ten guesses an hour are allowed; the eleventh is refused.
  for (let i = 0; i < 10; i++) await assert.rejects(env.call('mallory', { action: 'accept', code: 'ZZZZZZZZ' }), { code: 'not-found' });
  await assert.rejects(env.call('mallory', { action: 'accept', code: 'ZZZZZZZZ' }), { code: 'resource-exhausted' });
});

test('an expired invite code is refused and a fresh one replaces it', async () => {
  const env = environment();
  const { code } = await env.call('alice', { action: 'create', fundId: 'f1', name: 'Float', currency: 'ETB' });
  env.rows.set(`fundInvites/${code}`, { ...env.rows.get(`fundInvites/${code}`), expiresAt: Date.now() - 1 });
  await assert.rejects(env.call('bob', { action: 'accept', code }), { code: 'failed-precondition' });
  const renewed = await env.call('alice', { action: 'reinvite', fundId: 'f1' });
  assert.notEqual(renewed.code, code);
  await env.call('bob', { action: 'accept', code: renewed.code });
  assert.equal(fund(env).custodianUid, 'bob');
});

test('outsiders and invitees cannot touch an accepted fund', async () => {
  const env = environment();
  await acceptedFund(env);
  const spend = { action: 'record', fundId: 'f1', entryId: 'e1', kind: 'SPEND', amount: 10, date: day };
  await assert.rejects(env.call('mallory', spend), { code: 'permission-denied' });
  await assert.rejects(env.call('mallory', { action: 'close', fundId: 'f1' }), { code: 'permission-denied' });
  await assert.rejects(env.call('mallory', { action: 'classify', fundId: 'f1', entryId: 'e1', ownerCategory: 'X' }), { code: 'permission-denied' });
});

test('each role can only record what it actually did', async () => {
  const env = environment();
  await acceptedFund(env);
  const base = { action: 'record', fundId: 'f1', amount: 100, date: day };
  await assert.rejects(env.call('alice', { ...base, entryId: 'a', kind: 'SPEND' }), { code: 'permission-denied' });
  await assert.rejects(env.call('bob', { ...base, entryId: 'b', kind: 'DEPOSIT', source: 'OWNER' }), { code: 'permission-denied' });
  await assert.rejects(env.call('alice', { ...base, entryId: 'c', kind: 'DEPOSIT', source: 'THIRD_PARTY', payerName: 'X' }), { code: 'permission-denied' });
  await assert.rejects(env.call('bob', { ...base, entryId: 'd', kind: 'DEPOSIT', source: 'THIRD_PARTY' }), { code: 'invalid-argument' });
  await assert.rejects(env.call('bob', { ...base, entryId: 'e', kind: 'SPEND', ownerAccountId: 'acct' }), { code: 'invalid-argument' });
  await env.call('bob', { ...base, entryId: 'f', kind: 'DEPOSIT', source: 'OWNER_UNRECORDED' });
  await env.call('alice', { ...base, entryId: 'g', kind: 'RETURN', ownerAccountId: 'cbe' });
  await env.call('bob', { ...base, entryId: 'h', kind: 'RETURN' });
});

test('recording is idempotent and a retry with different details is refused', async () => {
  const env = environment();
  await acceptedFund(env);
  const spend = { action: 'record', fundId: 'f1', entryId: 'e1', kind: 'SPEND', amount: 250, date: day, category: 'Transport', recipient: 'Ride' };
  await env.call('bob', spend);
  const again = await env.call('bob', spend);
  assert.equal(again.existing, true);
  assert.equal(fund(env).totalSpent, 250);
  assert.equal(fund(env).entryVersion, 1);
  await assert.rejects(env.call('bob', { ...spend, amount: 260 }), { code: 'already-exists' });
});

test('the balance is exact to the cent through deposits, splits, returns and voids', async () => {
  const env = environment();
  await acceptedFund(env);
  await env.call('alice', { action: 'record', fundId: 'f1', entryId: 'top', kind: 'DEPOSIT', source: 'OWNER', amount: 5000, date: day, ownerAccountId: 'cbe' });
  await env.call('bob', {
    action: 'record', fundId: 'f1', entryId: 'buy', kind: 'SPEND', amount: 1234.56, date: day, category: 'Office',
    receipt_url: 'https://apps.cbe.com.et/receipt?id=FT26', reference_number: 'FT26', tags: [' work ', 'Work', 'q4'],
    splits: [{ id: 's1', amount: 1000.5, category: 'Office supplies' }, { id: 's2', amount: 234.06, category: 'Transport', tags: ['taxi'] }],
  });
  await env.call('bob', { action: 'record', fundId: 'f1', entryId: 'back', kind: 'RETURN', amount: 1000, date: day });
  assert.equal(fund(env).balance, 2765.44);
  assert.equal(fund(env).totalIn, 5000);
  assert.equal(fund(env).totalSpent, 1234.56);
  assert.equal(fund(env).totalReturned, 1000);
  assert.deepEqual(env.rows.get('sharedFunds/f1/entries/buy').tags, ['work', 'q4']);

  await env.call('bob', { action: 'void', fundId: 'f1', entryId: 'buy', reason: 'Duplicate' });
  assert.equal(fund(env).balance, 4000);
  assert.equal(fund(env).totalSpent, 0);
  assert.equal(env.rows.get('sharedFunds/f1/entries/buy').status, 'VOIDED');
  // Voiding twice changes nothing.
  await env.call('alice', { action: 'void', fundId: 'f1', entryId: 'buy' });
  assert.equal(fund(env).balance, 4000);
  // Overspending is allowed: it means the custodian advanced their own money.
  await env.call('bob', { action: 'record', fundId: 'f1', entryId: 'big', kind: 'SPEND', amount: 4300.01, date: day });
  assert.equal(fund(env).balance, -300.01);
});

test('an expected deposit stays out of the balance until the custodian confirms it', async () => {
  const env = environment();
  await acceptedFund(env);
  await env.call('alice', { action: 'announce', fundId: 'f1', entryId: 'x', amount: 10000, date: day, payerName: 'Mr X', note: 'Invoice 12' });
  assert.equal(fund(env).pendingIn, 10000);
  assert.equal(fund(env).balance, 0);
  assert.equal(env.rows.get('sharedFunds/f1/entries/x').status, 'PENDING');
  await assert.rejects(env.call('alice', { action: 'ack', fundId: 'f1', entryId: 'x' }), { code: 'permission-denied' });

  await env.call('bob', { action: 'ack', fundId: 'f1', entryId: 'x', reference_number: 'FT99', receipt_url: 'https://bank/r', sms_linked: true });
  const entry = env.rows.get('sharedFunds/f1/entries/x');
  assert.equal(entry.status, 'ACTIVE');
  assert.equal(entry.reference_number, 'FT99');
  assert.equal(entry.sms_linked, true);
  assert.equal(fund(env).pendingIn, 0);
  assert.equal(fund(env).balance, 10000);
  assert.equal(fund(env).totalIn, 10000);

  // Undoing the confirmation puts it back to expected, exactly once.
  await env.call('bob', { action: 'unack', fundId: 'f1', entryId: 'x' });
  await env.call('bob', { action: 'unack', fundId: 'f1', entryId: 'x' });
  assert.equal(env.rows.get('sharedFunds/f1/entries/x').status, 'PENDING');
  assert.equal(fund(env).pendingIn, 10000);
  assert.equal(fund(env).balance, 0);
  await env.call('bob', { action: 'ack', fundId: 'f1', entryId: 'x' });
  assert.equal(fund(env).balance, 10000);

  await env.call('alice', { action: 'announce', fundId: 'f1', entryId: 'y', amount: 300, date: day, payerName: 'Mr Y' });
  await env.call('bob', { action: 'reject', fundId: 'f1', entryId: 'y', reason: 'Never arrived' });
  assert.equal(env.rows.get('sharedFunds/f1/entries/y').status, 'VOIDED');
  assert.equal(fund(env).pendingIn, 0);
  assert.equal(fund(env).balance, 10000);
  await assert.rejects(env.call('bob', { action: 'reject', fundId: 'f1', entryId: 'x' }), { code: 'failed-precondition' });
});

test('only the owner classifies, and owner splits must add up', async () => {
  const env = environment();
  await acceptedFund(env);
  await env.call('bob', { action: 'record', fundId: 'f1', entryId: 'dep', kind: 'DEPOSIT', source: 'THIRD_PARTY', payerName: 'Mr X', amount: 900, date: day });
  await assert.rejects(env.call('bob', { action: 'classify', fundId: 'f1', entryId: 'dep', ownerCategory: 'Sales' }), { code: 'permission-denied' });
  await env.call('alice', { action: 'classify', fundId: 'f1', entryId: 'dep', ownerCategory: 'Sales', ownerPurpose: 'OPERATING' });
  assert.equal(env.rows.get('sharedFunds/f1/entries/dep').ownerCategory, 'Sales');
  assert.equal(env.rows.get('sharedFunds/f1/entries/dep').ownerPurpose, 'OPERATING');
  await assert.rejects(env.call('alice', { action: 'classify', fundId: 'f1', entryId: 'dep', ownerPurpose: 'INCOME' }), { code: 'invalid-argument' });
  await assert.rejects(env.call('alice', { action: 'classify', fundId: 'f1', entryId: 'dep', ownerSplits: [{ id: 'a', amount: 500, category: 'A' }, { id: 'b', amount: 300, category: 'B' }] }), { code: 'invalid-argument' });
  // Classification never changes what the custodian holds.
  assert.equal(fund(env).balance, 900);
});

test('bad receipt links, splits and amounts are rejected before anything is written', async () => {
  const env = environment();
  await acceptedFund(env);
  const spend = { action: 'record', fundId: 'f1', kind: 'SPEND', date: day };
  await assert.rejects(env.call('bob', { ...spend, entryId: 'a', amount: 10, receipt_url: 'http://insecure' }), { code: 'invalid-argument' });
  await assert.rejects(env.call('bob', { ...spend, entryId: 'b', amount: 10, receipt_url: 'javascript:alert(1)' }), { code: 'invalid-argument' });
  await assert.rejects(env.call('bob', { ...spend, entryId: 'c', amount: 10, splits: [{ id: 'x', amount: 4, category: 'A' }, { id: 'y', amount: 5, category: 'B' }] }), { code: 'invalid-argument' });
  await assert.rejects(env.call('bob', { ...spend, entryId: 'd', amount: 10.005 }), { code: 'invalid-argument' });
  await assert.rejects(env.call('bob', { ...spend, entryId: 'e', amount: -5 }), { code: 'invalid-argument' });
  await assert.rejects(env.call('bob', { ...spend, entryId: 'f', amount: 5, date: Date.now() + 3 * 86400000 }), { code: 'invalid-argument' });
  await assert.rejects(env.call('bob', { ...spend, entryId: 'g', amount: 5, tags: Array.from({ length: 13 }, (_, i) => `t${i}`) }), { code: 'invalid-argument' });
  assert.equal(fund(env).entryVersion, 0);
  assert.equal([...env.rows.keys()].filter(key => key.includes('/entries/')).length, 0);
});

test('questions flow owner to custodian and back, and closing a fund stops new entries', async () => {
  const env = environment();
  await acceptedFund(env);
  await env.call('bob', { action: 'record', fundId: 'f1', entryId: 'e', kind: 'SPEND', amount: 80, date: day });
  await assert.rejects(env.call('bob', { action: 'flag', fundId: 'f1', entryId: 'e', note: 'hm' }), { code: 'permission-denied' });
  await assert.rejects(env.call('bob', { action: 'reply', fundId: 'f1', entryId: 'e', reply: 'early' }), { code: 'failed-precondition' });
  await env.call('alice', { action: 'flag', fundId: 'f1', entryId: 'e', note: 'What was this for?' });
  await env.call('bob', { action: 'reply', fundId: 'f1', entryId: 'e', reply: 'Printer toner' });
  await env.call('alice', { action: 'resolve', fundId: 'f1', entryId: 'e' });
  const flag = env.rows.get('sharedFunds/f1/entries/e').flag;
  assert.equal(flag.note, 'What was this for?');
  assert.equal(flag.reply, 'Printer toner');
  assert.equal(flag.resolved, true);

  await env.call('alice', { action: 'close', fundId: 'f1' });
  await assert.rejects(env.call('bob', { action: 'record', fundId: 'f1', entryId: 'late', kind: 'SPEND', amount: 5, date: day }), { code: 'failed-precondition' });
  await env.call('alice', { action: 'reopen', fundId: 'f1' });
  await env.call('bob', { action: 'record', fundId: 'f1', entryId: 'late', kind: 'SPEND', amount: 5, date: day });
});

test('every change leaves an audit entry naming who did it', async () => {
  const env = environment();
  await acceptedFund(env);
  await env.call('bob', { action: 'record', fundId: 'f1', entryId: 'e', kind: 'SPEND', amount: 80, date: day });
  const log = [...env.rows.entries()].filter(([key]) => key.startsWith('sharedFunds/f1/changelog/')).map(([, value]) => value);
  assert.ok(log.some(item => item.action === 'Fund created' && item.actorName === 'Alice'));
  assert.ok(log.some(item => item.action === 'Joined the fund' && item.actorName === 'Bob'));
  assert.ok(log.some(item => item.action === 'Paid 80.00' && item.actorUid === 'bob' && item.entryId === 'e'));
});

test('two changes in the same millisecond both reach the audit log', async () => {
  const env = environment();
  await acceptedFund(env);
  await env.call('alice', { action: 'announce', fundId: 'f1', entryId: 'x', amount: 50, date: day, payerName: 'Mr X' });
  const realNow = Date.now;
  Date.now = () => 1_800_000_000_000;
  try {
    for (let i = 0; i < 3; i++) {
      await env.call('bob', { action: 'ack', fundId: 'f1', entryId: 'x' });
      await env.call('bob', { action: 'unack', fundId: 'f1', entryId: 'x' });
    }
  } finally { Date.now = realNow; }
  const confirmations = [...env.rows.entries()].filter(([key, value]) => key.startsWith('sharedFunds/f1/changelog/') && value.action.startsWith('Confirmed receiving'));
  assert.equal(confirmations.length, 3);
});

test('deleting a custodian account anonymises their entries and closes the fund for the owner', async () => {
  const env = environment();
  await acceptedFund(env);
  await env.call('bob', { action: 'record', fundId: 'f1', entryId: 'e', kind: 'SPEND', amount: 80, date: day });
  await env.api.deleteMyAccount({ auth: { uid: 'bob', token: { auth_time: Date.now() / 1000 } } });
  assert.deepEqual(fund(env).members, ['alice']);
  assert.equal(fund(env).custodianUid, null);
  assert.equal(fund(env).custodianName, 'Deleted account');
  assert.equal(fund(env).status, 'CLOSED');
  assert.equal(env.rows.get('sharedFunds/f1/entries/e').recordedByUid, 'deleted-account');
  assert.equal(env.rows.get('sharedFunds/f1/entries/e').amount, 80);
  const log = [...env.rows.entries()].filter(([key]) => key.startsWith('sharedFunds/f1/changelog/')).map(([, value]) => value);
  assert.ok(!log.some(item => item.actorUid === 'bob'));
  assert.deepEqual(env.deletedUsers, ['bob']);
});

test('fund rules let members read and nobody write', () => {
  const rules = fs.readFileSync(path.join(__dirname, '../firestore.rules'), 'utf8');
  const block = rules.slice(rules.indexOf('match /sharedFunds/{fundId}'));
  assert.ok(block.length > 30, 'sharedFunds rules are missing');
  assert.match(block, /allow read: if signedIn\(\) && request\.auth\.uid in resource\.data\.members;/);
  assert.match(block, /allow write: if false;/);
  assert.ok(!/allow (create|update|write): if (?!false)/.test(block.slice(0, block.indexOf('match /pushDevices'))), 'clients must never write fund data directly');
});
