import { getFunctions, httpsCallable } from 'firebase/functions';
import { getFirebaseApp } from '@/config/firebaseApp';
import { AuthService } from '@/services/AuthService';
import { SecureStorageService } from '@/services/SecureStorageService';
import { createSerialQueue } from '@/utils/asyncLock';

export const AI_PROVIDER_KEYS = ['geminiApiKey', 'groqApiKey', 'openRouterApiKey', 'topToolsApiKey'] as const;
export type AIProviderKey = typeof AI_PROVIDER_KEYS[number];
export type AIProviderKeys = Partial<Record<AIProviderKey, string>>;

interface PrivateConfiguration {
  aiKeys?: AIProviderKeys;
  melaInitialized?: boolean;
  mela?: {
    token: string;
    connection: Record<string, unknown>;
  } | null;
}

interface PrivateConfigurationState {
  pendingAI?: AIProviderKey[];
  pendingMela?: boolean;
}

const listeners = new Set<(keys: AIProviderKeys) => void>();
const mutate = createSerialQueue();
const call = async (action: string, data: Record<string, unknown> = {}) => {
  const callable = httpsCallable(getFunctions(getFirebaseApp()), 'managePrivateConfiguration');
  const response = await callable({ action, ...data });
  return (response.data || {}) as PrivateConfiguration;
};

const readState = async (): Promise<PrivateConfigurationState> => {
  const data = await SecureStorageService.getUserData();
  return data?.privateConfigurationState || {};
};

const writeState = async (state: PrivateConfigurationState) => {
  const data = await SecureStorageService.getUserData();
  await SecureStorageService.saveUserData({ ...(data || {}), privateConfigurationState: state });
};

const setPendingAI = async (provider: AIProviderKey, pending: boolean) => {
  const state = await readState();
  const providers = new Set(state.pendingAI || []);
  if (pending) providers.add(provider); else providers.delete(provider);
  await writeState({ ...state, pendingAI: [...providers] });
};

export default class PrivateConfigurationService {
  static subscribeAIKeys(listener: (keys: AIProviderKeys) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  }

  /** Save one key without exposing other providers to a stale-device overwrite. */
  static async updateAIProviderKey(provider: AIProviderKey, value: string): Promise<void> {
    await mutate(async () => {
      const uid = AuthService.getCurrentUser()?.uid;
      if (!uid) return;
      await setPendingAI(provider, true);
      try {
        await call('setAiKey', { provider, value: value.trim() });
        await setPendingAI(provider, false);
      } catch {
        // The pending marker makes the next normal cloud sync retry this value.
      }
    });
  }

  static async updateMelaConnection(): Promise<void> {
    await mutate(async () => {
      const uid = AuthService.getCurrentUser()?.uid;
      if (!uid) return;
      const state = await readState();
      await writeState({ ...state, pendingMela: true });
      try {
        const { default: MelaService } = await import('@/services/MelaService');
        const mela = await MelaService.exportPortableConnection();
        await call(mela ? 'setMela' : 'clearMela', mela || {});
        const next = await readState();
        await writeState({ ...next, pendingMela: false });
      } catch {
        // Retried by sync().
      }
    });
  }

  /** Reconcile server-protected secrets after the ordinary account data sync. */
  static async sync(uid: string): Promise<void> {
    if (AuthService.getCurrentUser()?.uid !== uid) return;
    const state = await readState();
    let remote = await call('get');
    const { loadStoredAppSettings, saveAIProviderKeysLocally } = await import('@/contexts/AppSettingsContext');
    const localSettings = await loadStoredAppSettings();
    const pending = new Set(state.pendingAI || []);

    for (const provider of AI_PROVIDER_KEYS) {
      const localValue = String(localSettings[provider] || '').trim();
      const hasRemoteValue = !!remote.aiKeys && Object.prototype.hasOwnProperty.call(remote.aiKeys, provider);
      if (pending.has(provider) || (!hasRemoteValue && !!localValue)) {
        await call('setAiKey', { provider, value: localValue });
        pending.delete(provider);
      }
    }

    if (pending.size !== (state.pendingAI || []).length || !remote.aiKeys) remote = await call('get');
    if (remote.aiKeys) {
      const keys = Object.fromEntries(AI_PROVIDER_KEYS.map(provider => [provider, String(remote.aiKeys?.[provider] || '')])) as AIProviderKeys;
      await saveAIProviderKeysLocally(keys);
      listeners.forEach(listener => listener(keys));
    }

    const { default: MelaService } = await import('@/services/MelaService');
    const localMela = await MelaService.exportPortableConnection();
    if (state.pendingMela || (remote.melaInitialized !== true && localMela)) {
      await call(localMela ? 'setMela' : 'clearMela', localMela || {});
      remote = await call('get');
    } else if (remote.melaInitialized && remote.mela) {
      if (remote.mela.token !== localMela?.token) await MelaService.restorePortableConnection(remote.mela);
    } else if (remote.melaInitialized && localMela) {
      await MelaService.clearRestoredConnection();
    }
    await writeState({ pendingAI: [...pending], pendingMela: false });
  }
}
