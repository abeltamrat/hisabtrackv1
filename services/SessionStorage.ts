import RawStorage from '@react-native-async-storage/async-storage';

let scope = 'guest';
export const getSessionScope = () => scope;
const prefix = (owner = scope) => `hisab-user:${encodeURIComponent(owner)}:`;
const storageKey = (key: string) => `${prefix()}${key}`;
const legacyKeys = new Set(['draft_transactions', 'app_notifications', 'sms_learning_rules', 'sms_ai_calibration_examples', 'recurring_transactions', 'app_settings', 'notifications', 'editedBundledLogos', 'global_loan_reminders_enabled', 'global_reminders_enabled', 'rememberedEmail', 'has_checked_initial_permissions', 'auth_token', 'user_data', 'refresh_token']);
const isLegacy = (key: string) => legacyKeys.has(key) || key.startsWith('@hisabtrack_') || key.startsWith('sms_last_sync_');

export async function setSessionScope(uid: string | null, adoptExistingSession = false): Promise<boolean> {
  const next = uid || 'guest';
  const owner = await RawStorage.getItem('hisab_legacy_owner');
  const adoptsLegacy = !!uid && (owner === uid || (!owner && adoptExistingSession));
  if (uid && adoptsLegacy && !(await RawStorage.getItem('hisab_legacy_migrated'))) {
    await RawStorage.setItem('hisab_legacy_owner', uid);
    const keys = (await RawStorage.getAllKeys()).filter(isLegacy);
    for (const key of keys) {
      const value = await RawStorage.getItem(key);
      if (value !== null) await RawStorage.setItem(`${prefix(uid)}${key}`, value);
    }
    await RawStorage.multiRemove(keys);
    if (typeof localStorage !== 'undefined') for (const key of Object.keys(localStorage).filter(isLegacy)) {
      const value = localStorage.getItem(key);
      if (value !== null) localStorage.setItem(`${prefix(uid)}${key}`, value);
      localStorage.removeItem(key);
    }
  }
  if (adoptsLegacy) await RawStorage.setItem('hisab_legacy_migrated', 'true');
  scope = next;
  return adoptsLegacy;
}

const SessionStorage = {
  getItem: (key: string) => RawStorage.getItem(storageKey(key)),
  setItem: (key: string, value: string) => RawStorage.setItem(storageKey(key), value),
  removeItem: (key: string) => RawStorage.removeItem(storageKey(key)),
  multiGet: (keys: readonly string[]) => { const p = prefix(); return RawStorage.multiGet(keys.map(key => p + key)).then(rows => rows.map(([key, value]) => [key.slice(p.length), value] as [string, string | null])); },
  multiSet: (pairs: readonly (readonly [string, string])[]) => RawStorage.multiSet(pairs.map(([key, value]) => [storageKey(key), value])),
  multiRemove: (keys: readonly string[]) => RawStorage.multiRemove(keys.map(storageKey)),
  getAllKeys: async () => { const p = prefix(); return (await RawStorage.getAllKeys()).filter(key => key.startsWith(p)).map(key => key.slice(p.length)); },
  clear: async () => { const p = prefix(); await RawStorage.multiRemove((await RawStorage.getAllKeys()).filter(key => key.startsWith(p))); },
};
export const sessionLocalStorage = {
  getItem: (key: string) => localStorage.getItem(storageKey(key)),
  setItem: (key: string, value: string) => localStorage.setItem(storageKey(key), value),
  removeItem: (key: string) => localStorage.removeItem(storageKey(key)),
  clear: () => { for (const key of Object.keys(localStorage).filter(key => key.startsWith(prefix()))) localStorage.removeItem(key); },
};
export default SessionStorage;
