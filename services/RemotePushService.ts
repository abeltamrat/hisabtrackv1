import AsyncStorage from '@/services/SessionStorage';
import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { generateUUID } from '@/utils/uuid';
import { getFirebaseApp } from '@/config/firebaseApp';
import { getAuth } from 'firebase/auth';
import { collection, doc, getDoc, getFirestore, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import CloudProfileService from './CloudProfileService';

const INSTALLATION_ID_KEY = '@hisabtrack_push_installation_id';
const LAST_TOKEN_KEY = '@hisabtrack_expo_push_token';
const SMS_PARSER_SELECTED_KEY = '@hisabtrack_sms_parser_selected';
const PUSH_DOC_COLLECTION = 'devices';
const PUSH_JOB_COLLECTION = 'push_jobs';

type RemotePushStatus = 'unsupported' | 'denied' | 'registered' | 'error';

export interface RemotePushDeviceRecord {
  ownerUid: string;
  installationId: string;
  deviceName: string | null;
  modelName: string | null;
  expoPushToken: string | null;
  notificationsEnabled: boolean;
  isActive: boolean;
  platform: string;
  projectId: string | null;
  appVersion: string | null;
  appBuild: string | null;
  executionEnvironment: string;
  updatedAt: number;
  lastSeenAt: number;
  lastError?: string | null;
}

export interface AccountDevice extends RemotePushDeviceRecord {
  isCurrentDevice: boolean;
  smsParsingEnabled: boolean;
}

export interface RemotePushSyncResult {
  status: RemotePushStatus;
  installationId: string;
  projectId: string | null;
  expoPushToken?: string | null;
  lastError?: string | null;
}

export interface RemotePushStatusSnapshot {
  supported: boolean;
  installationId: string | null;
  projectId: string | null;
  documentExists: boolean;
  notificationsEnabled: boolean;
  isActive: boolean;
  expoPushToken: string | null;
  expoPushTokenPreview: string | null;
  lastError: string | null;
  updatedAt: number | null;
  lastSeenAt: number | null;
}

export class RemotePushService {
  private static async getFirestore() {
    return getFirestore(getFirebaseApp());
  }

  private static getProjectId() {
    return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId ?? null;
  }

  static async getInstallationId(): Promise<string> {
    const existing = await AsyncStorage.getItem(INSTALLATION_ID_KEY);
    if (existing) return existing;

    const installationId = generateUUID();
    await AsyncStorage.setItem(INSTALLATION_ID_KEY, installationId);
    return installationId;
  }

  private static async getDeviceRef(uid: string) {
    const firestore = await this.getFirestore();
    const installationId = await this.getInstallationId();
    return {
      firestore,
      installationId,
      ref: doc(firestore, `users/${uid}/${PUSH_DOC_COLLECTION}`, installationId),
    };
  }

  private static buildDeviceRecord(
    ownerUid: string,
    installationId: string,
    overrides: Partial<RemotePushDeviceRecord> = {}
  ): RemotePushDeviceRecord {
    const now = Date.now();

    return {
      ownerUid,
      installationId,
      deviceName: `${Platform.OS === 'ios' ? 'iOS' : Platform.OS === 'android' ? 'Android' : 'Web'} device`,
      modelName: Platform.OS === 'ios'
        ? Constants.platform?.ios?.model ?? Constants.deviceName ?? null
        : Constants.deviceName ?? null,
      expoPushToken: null,
      notificationsEnabled: false,
      isActive: true,
      platform: Platform.OS,
      projectId: this.getProjectId(),
      appVersion: Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null,
      appBuild: Application.nativeBuildVersion
        ?? (Platform.OS === 'android'
          ? String(Constants.expoConfig?.android?.versionCode ?? '')
          : Platform.OS === 'ios'
            ? String(Constants.expoConfig?.ios?.buildNumber ?? '')
            : null),
      executionEnvironment: String(Constants.executionEnvironment ?? 'unknown'),
      updatedAt: now,
      lastSeenAt: now,
      lastError: null,
      ...overrides,
    };
  }

  private static isPushSupported() {
    if (Platform.OS === 'web') return false;
    if (Platform.OS === 'android' && Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
      return false;
    }
    return true;
  }

  static async syncCurrentDevice(uid: string): Promise<RemotePushSyncResult> {
    const installationId = await this.getInstallationId();
    const projectId = this.getProjectId();

    if (!this.isPushSupported()) {
      return {
        status: 'unsupported',
        installationId,
        projectId,
        lastError: 'Remote push requires a physical device and a development or production build.',
      };
    }

    if (!projectId) {
      return {
        status: 'error',
        installationId,
        projectId: null,
        lastError: 'EAS projectId is missing from app config.',
      };
    }

    const { ref } = await this.getDeviceRef(uid);

    try {
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const requested = await Notifications.requestPermissionsAsync();
        finalStatus = requested.status;
      }

      if (finalStatus !== 'granted') {
        await setDoc(ref, this.buildDeviceRecord(uid, installationId, {
          notificationsEnabled: false,
          isActive: true,
          lastError: 'Notification permission not granted.',
        }), { merge: true });

        return {
          status: 'denied',
          installationId,
          projectId,
          lastError: 'Notification permission not granted.',
        };
      }

      const expoPushToken = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
      await AsyncStorage.setItem(LAST_TOKEN_KEY, expoPushToken);

      const now = Date.now();
      await setDoc(ref, this.buildDeviceRecord(uid, installationId, {
        expoPushToken,
        notificationsEnabled: true,
        isActive: true,
        updatedAt: now,
        lastSeenAt: now,
        lastError: null,
      }), { merge: true });

      return {
        status: 'registered',
        installationId,
        projectId,
        expoPushToken,
      };
    } catch (error: any) {
      const message = error?.message || 'Failed to register Expo push token.';
      await setDoc(ref, this.buildDeviceRecord(uid, installationId, {
        notificationsEnabled: false,
        isActive: true,
        lastError: message,
      }), { merge: true });

      return {
        status: 'error',
        installationId,
        projectId,
        lastError: message,
      };
    }
  }

  static async markCurrentDeviceSeen(uid: string): Promise<void> {
    if (Platform.OS === 'web') return;

    const { ref, installationId } = await this.getDeviceRef(uid);
    const snapshot = await getDoc(ref);
    const now = Date.now();
    await setDoc(ref, snapshot.exists() ? {
      ownerUid: uid,
      deviceName: `${Platform.OS === 'ios' ? 'iOS' : 'Android'} device`,
      modelName: Platform.OS === 'ios'
        ? Constants.platform?.ios?.model ?? Constants.deviceName ?? null
        : Constants.deviceName ?? null,
      isActive: true,
      lastSeenAt: now,
      updatedAt: now,
    } : this.buildDeviceRecord(uid, installationId, { lastSeenAt: now, updatedAt: now }), { merge: true });
  }

  static async unregisterCurrentDevice(uid: string): Promise<void> {
    if (Platform.OS === 'web') return;

    const { firestore, ref, installationId } = await this.getDeviceRef(uid);
    const snapshot = await getDoc(ref);
    const now = Date.now();
    await setDoc(ref, snapshot.exists() ? {
      ownerUid: uid,
      expoPushToken: null,
      notificationsEnabled: false,
      isActive: false,
      updatedAt: now,
    } : this.buildDeviceRecord(uid, installationId, {
      isActive: false,
      updatedAt: now,
    }), { merge: true });
    const preferencesRef = doc(firestore, `users/${uid}/meta/preferences`);
    await runTransaction(firestore, async transaction => {
      const preferences = await transaction.get(preferencesRef);
      if (preferences.data()?.smsParserInstallationId === installationId) {
        transaction.set(preferencesRef, { smsParserInstallationId: null, smsParserUpdatedAt: now }, { merge: true });
      }
    });
    await AsyncStorage.setItem(SMS_PARSER_SELECTED_KEY, 'false');
  }

  static async getStatusSnapshot(uid: string): Promise<RemotePushStatusSnapshot> {
    const installationId = await this.getInstallationId();
    const projectId = this.getProjectId();

    if (Platform.OS === 'web') {
      return {
        supported: false,
        installationId,
        projectId,
        documentExists: false,
        notificationsEnabled: false,
        isActive: false,
        expoPushToken: null,
        expoPushTokenPreview: null,
        lastError: 'Remote push is not supported on web.',
        updatedAt: null,
        lastSeenAt: null,
      };
    }

    const { ref } = await this.getDeviceRef(uid);
    const snap = await getDoc(ref);
    const data = snap.exists() ? (snap.data() as RemotePushDeviceRecord) : null;
    const localToken = await AsyncStorage.getItem(LAST_TOKEN_KEY);
    const token = data?.expoPushToken ?? localToken ?? null;

    return {
      supported: this.isPushSupported(),
      installationId,
      projectId,
      documentExists: snap.exists(),
      notificationsEnabled: !!data?.notificationsEnabled,
      isActive: !!data?.isActive,
      expoPushToken: token,
      expoPushTokenPreview: token ? `${token.slice(0, 18)}...${token.slice(-8)}` : null,
      lastError: data?.lastError ?? null,
      updatedAt: data?.updatedAt ?? null,
      lastSeenAt: data?.lastSeenAt ?? null,
    };
  }

  static async setCurrentDeviceSmsParsing(uid: string, enabled: boolean): Promise<void> {
    const installationId = await this.getInstallationId();
    const firestore = await this.getFirestore();
    const preferencesRef = doc(firestore, `users/${uid}/meta/preferences`);
    await runTransaction(firestore, async transaction => {
      const snapshot = await transaction.get(preferencesRef);
      const selected = snapshot.data()?.smsParserInstallationId;
      if (!enabled && selected !== installationId) return;
      transaction.set(preferencesRef, {
        smsParserInstallationId: enabled ? installationId : null,
        smsParserUpdatedAt: Date.now(),
      }, { merge: true });
    });
    await AsyncStorage.setItem(SMS_PARSER_SELECTED_KEY, enabled ? 'true' : 'false');
    await this.markCurrentDeviceSeen(uid).catch(() => undefined);
  }

  static async ensureSmsParserSelection(uid: string): Promise<string | null> {
    if (Platform.OS !== 'android') return CloudProfileService.getSmsParserInstallationId(uid);
    const installationId = await this.getInstallationId();
    const firestore = await this.getFirestore();
    const preferencesRef = doc(firestore, `users/${uid}/meta/preferences`);
    const selectedId = await runTransaction(firestore, async transaction => {
      const snapshot = await transaction.get(preferencesRef);
      const selected = snapshot.data()?.smsParserInstallationId;
      if (typeof selected === 'string' && selected.length > 0) return selected;
      transaction.set(preferencesRef, {
        smsParserInstallationId: installationId,
        smsParserUpdatedAt: Date.now(),
      }, { merge: true });
      return installationId;
    });
    await AsyncStorage.setItem(SMS_PARSER_SELECTED_KEY, selectedId === installationId ? 'true' : 'false');
    return selectedId;
  }

  static async isCurrentDeviceSmsParser(): Promise<boolean> {
    return (await AsyncStorage.getItem(SMS_PARSER_SELECTED_KEY)) === 'true';
  }

  static async refreshCurrentDeviceSmsParser(uid: string): Promise<boolean> {
    const [installationId, selectedId] = await Promise.all([
      this.getInstallationId(),
      CloudProfileService.getSmsParserInstallationId(uid),
    ]);
    const selected = installationId === selectedId;
    await AsyncStorage.setItem(SMS_PARSER_SELECTED_KEY, selected ? 'true' : 'false');
    return selected;
  }

  static subscribeSmsParserSelection(uid: string, listener: (selected: boolean, installationId: string | null) => void): () => void {
    let disposed = false;
    let unsubscribe: () => void = () => {};
    void this.getInstallationId().then(currentId => {
      if (disposed) return;
      unsubscribe = CloudProfileService.subscribeSmsParserInstallationId(uid, selectedId => {
        const selected = selectedId === currentId;
        void AsyncStorage.setItem(SMS_PARSER_SELECTED_KEY, selected ? 'true' : 'false');
        listener(selected, selectedId);
      });
    });
    return () => { disposed = true; unsubscribe(); };
  }

  static subscribeAccountDevices(uid: string, listener: (devices: AccountDevice[]) => void): () => void {
    let disposed = false;
    let unsubscribeDevices: () => void = () => {};
    let unsubscribeSelection: () => void = () => {};
    let records: RemotePushDeviceRecord[] = [];
    let selectedId: string | null = null;
    let currentId = '';
    const ownsActiveSession = () => getAuth(getFirebaseApp()).currentUser?.uid === uid;
    const emit = () => {
      if (disposed || !ownsActiveSession()) return;
      listener(records
      .map(record => ({
        ...record,
        isCurrentDevice: record.installationId === currentId,
        smsParsingEnabled: record.installationId === selectedId,
      }))
      .sort((a, b) => Number(b.isCurrentDevice) - Number(a.isCurrentDevice) || b.lastSeenAt - a.lastSeenAt));
    };

    void this.getInstallationId().then(async id => {
      if (disposed || !ownsActiveSession()) return;
      currentId = id;
      const firestore = await this.getFirestore();
      if (disposed || !ownsActiveSession()) return;
      unsubscribeDevices = onSnapshot(collection(firestore, `users/${uid}/devices`), snapshot => {
        if (disposed || !ownsActiveSession()) return;
        records = snapshot.docs.map(item => item.data() as RemotePushDeviceRecord)
          .filter(record => record.ownerUid === uid
            && typeof record.installationId === 'string'
            && typeof record.lastSeenAt === 'number');
        emit();
      });
      unsubscribeSelection = CloudProfileService.subscribeSmsParserInstallationId(uid, idValue => {
        if (disposed || !ownsActiveSession()) return;
        selectedId = idValue;
        emit();
      });
    });
    return () => { disposed = true; unsubscribeDevices(); unsubscribeSelection(); };
  }

  /**
   * The push job document is handed to Expo verbatim, so its title and body are
   * generated server-side by the `sendTestPush` callable. Firestore rules deny
   * client writes to `push_jobs`; a client-composed job plus a planted device
   * token would otherwise deliver arbitrary text to another person's device.
   */
  static async sendTestPush(_uid: string): Promise<string> {
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const result = await httpsCallable<unknown, { jobId: string }>(getFunctions(), 'sendTestPush')({});
    return result.data.jobId;
  }
}

export default RemotePushService;
