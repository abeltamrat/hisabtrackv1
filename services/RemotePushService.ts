import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

import { auth } from '@/services/AuthService';
import { generateUUID } from '@/utils/uuid';
import { getApp } from 'firebase/app';
import { addDoc, collection, doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';

const INSTALLATION_ID_KEY = '@hisabtrack_push_installation_id';
const LAST_TOKEN_KEY = '@hisabtrack_expo_push_token';
const PUSH_DOC_COLLECTION = 'devices';
const PUSH_JOB_COLLECTION = 'push_jobs';

type RemotePushStatus = 'unsupported' | 'denied' | 'registered' | 'error';

export interface RemotePushDeviceRecord {
  installationId: string;
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
  registeredAt?: number;
  signedOutAt?: number;
  lastError?: string | null;
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

interface RemotePushPayload {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  actionType?: string;
  sound?: string | null;
  channelId?: string;
  priority?: 'default' | 'normal' | 'high';
  ttl?: number;
  subtitle?: string;
}

export class RemotePushService {
  private static async getFirestore() {
    const app = getApp();
    return getFirestore(app);
  }

  private static getProjectId() {
    return Constants.easConfig?.projectId ?? Constants.expoConfig?.extra?.eas?.projectId ?? null;
  }

  private static async getInstallationId(): Promise<string> {
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
    installationId: string,
    overrides: Partial<RemotePushDeviceRecord> = {}
  ): RemotePushDeviceRecord {
    const now = Date.now();

    return {
      installationId,
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
        await setDoc(ref, this.buildDeviceRecord(installationId, {
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
      await setDoc(ref, this.buildDeviceRecord(installationId, {
        expoPushToken,
        notificationsEnabled: true,
        isActive: true,
        registeredAt: now,
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
      await setDoc(ref, this.buildDeviceRecord(installationId, {
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
    await setDoc(ref, this.buildDeviceRecord(installationId, {
      isActive: true,
      lastSeenAt: Date.now(),
      updatedAt: Date.now(),
    }), { merge: true });
  }

  static async unregisterCurrentDevice(uid: string): Promise<void> {
    if (Platform.OS === 'web') return;

    const { ref, installationId } = await this.getDeviceRef(uid);
    await setDoc(ref, this.buildDeviceRecord(installationId, {
      expoPushToken: null,
      notificationsEnabled: false,
      isActive: false,
      signedOutAt: Date.now(),
      updatedAt: Date.now(),
    }), { merge: true });
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

  static async enqueuePushForUser(uid: string, payload: RemotePushPayload): Promise<string> {
    const firestore = await this.getFirestore();
    const currentUser = auth.currentUser;
    const job = {
      ...payload,
      data: {
        ...(payload.data || {}),
        actionType: payload.actionType ?? payload.data?.actionType ?? 'view_reports',
      },
      requestedAt: Date.now(),
      requestedBy: currentUser?.uid ?? uid,
      source: 'client',
      status: 'queued',
    };

    const ref = await addDoc(collection(firestore, `users/${uid}/${PUSH_JOB_COLLECTION}`), job);
    return ref.id;
  }

  static async sendTestPush(uid: string): Promise<string> {
    return await this.enqueuePushForUser(uid, {
      title: 'HisabTrack test push',
      body: 'Remote push is configured. This notification was sent by your backend pipeline.',
      actionType: 'view_reports',
      channelId: 'finance_alerts',
      priority: 'high',
      sound: 'default',
      data: {
        route: '/reports',
        source: 'remote_test',
      },
    });
  }
}

export default RemotePushService;
