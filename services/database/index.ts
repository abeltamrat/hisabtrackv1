import { Platform } from 'react-native';
import { LedgerDatabase } from './ledger';
import { WebDatabase } from './web';
let database: LedgerDatabase | null = null;
let currentScope = 'guest';
function create(scope: string, legacy: boolean) {
  const suffix = Array.from(scope).map(c => c.charCodeAt(0).toString(16)).join('');
  const adapter = Platform.OS === 'web'
    ? new WebDatabase(legacy ? 'finance-db' : `finance-${suffix}`)
    : new (require('./android').AndroidDatabase)(legacy ? 'hisabtrack.db' : `hisabtrack-${suffix}.db`);
  return new LedgerDatabase(adapter, scope);
}
export async function setDatabaseScope(scope: string, legacy = false) {
  if (database) { database.deactivate(); await database.drain(); }
  currentScope = scope;
  database = create(scope, legacy);
  await database.init();
}
export async function getDatabase(): Promise<LedgerDatabase> {
  if (!database) database = create(currentScope, false);
  const selected = database;
  await selected.init();
  return selected;
}
/** Cleanly releases the native handle before an OTA reload. See LedgerDatabase.close(). */
export async function closeDatabase() {
  if (!database) return;
  await database.close();
  database = null;
}
