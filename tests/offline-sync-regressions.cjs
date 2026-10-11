const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = rel => fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');

test('an unreachable cloud is "sync pending", not a data error, and keeps retrying', () => {
  const sync = read('services/SyncService.ts');
  const body = sync.match(/static isConnectivityError\(error: unknown\): boolean \{([\s\S]*?)\n  \}/)[1];
  const isConnectivityError = new Function('error', body.replace(/as \{ code\?: string; message\?: string \}/, ''));
  assert.equal(isConnectivityError({ code: 'unavailable', message: 'x' }), true);
  assert.equal(isConnectivityError(new Error('Failed to get document because the client is offline.')), true);
  assert.equal(isConnectivityError({ code: 'permission-denied', message: 'Missing or insufficient permissions.' }), false);
  assert.equal(isConnectivityError(new Error('Invalid loan')), false);
  assert.match(sync, /if \(this\.isConnectivityError\(error\)\) \{ this\.setStatus\('pending'\); throw error; \}/);
  assert.match(read('contexts/AuthContext.tsx'), /if \(SyncService\.isConnectivityError\(syncError\)\) SyncService\.startAutoSync\(firebaseUser\.uid\);/, 'a failed first sync still starts auto-sync');
});
