import { doc, getDoc, getFirestore, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';

export interface CloudAppLockPolicy {
  enabled: boolean;
  verifier: string | null;
}

const isValidAppLockVerifier = (value: string): boolean => {
  try {
    const parsed = JSON.parse(value) as { salt?: unknown; hash?: unknown };
    return typeof parsed.salt === 'string'
      && parsed.salt.length >= 8
      && typeof parsed.hash === 'string'
      && /^[a-f0-9]{64}$/i.test(parsed.hash);
  } catch {
    return false;
  }
};

const readAppLockPolicy = (data: Record<string, unknown> | undefined): CloudAppLockPolicy | null => {
  if (typeof data?.appLockEnabled !== 'boolean') return null;
  const verifier = data.appLockVerifier;
  if (verifier !== null && (typeof verifier !== 'string' || !isValidAppLockVerifier(verifier))) return null;
  return { enabled: data.appLockEnabled, verifier: verifier ?? null };
};

/** Small, non-financial preferences that must follow the authenticated account. */
export default class CloudProfileService {
  static async getCloudSyncEnabled(uid: string): Promise<boolean | null> {
    const snapshot = await getDoc(doc(getFirestore(), `users/${uid}/meta/preferences`));
    if (!snapshot.exists()) return null;
    // A choice saved before cloud sync became the default doesn't override it;
    // only choices made since (marked sharingDefaultsApplied) follow the account.
    if (snapshot.data()?.sharingDefaultsApplied !== true) return null;
    const value = snapshot.data()?.cloudSyncEnabled;
    return typeof value === 'boolean' ? value : null;
  }

  static async setCloudSyncEnabled(uid: string, enabled: boolean): Promise<void> {
    await setDoc(doc(getFirestore(), `users/${uid}/meta/preferences`), {
      cloudSyncEnabled: enabled,
      sharingDefaultsApplied: true,
      updatedAt: serverTimestamp(),
    }, { merge: true });
  }

  static async getAppLockPolicy(uid: string): Promise<CloudAppLockPolicy | null> {
    const snapshot = await getDoc(doc(getFirestore(), `users/${uid}/meta/preferences`));
    return snapshot.exists() ? readAppLockPolicy(snapshot.data()) : null;
  }

  static async setAppLockPolicy(uid: string, policy: CloudAppLockPolicy): Promise<void> {
    if (policy.verifier !== null && !isValidAppLockVerifier(policy.verifier)) throw new Error('Invalid app lock verifier');
    if (policy.enabled && !policy.verifier) throw new Error('App lock cannot be enabled without a verifier');
    await setDoc(doc(getFirestore(), `users/${uid}/meta/preferences`), {
      appLockEnabled: policy.enabled,
      // This is a salted one-way verifier. The PIN itself never leaves the device.
      appLockVerifier: policy.verifier,
      appLockPolicyVersion: 1,
      appLockUpdatedAt: serverTimestamp(),
    }, { merge: true });
  }

  static subscribeAppLockPolicy(
    uid: string,
    listener: (policy: CloudAppLockPolicy | null) => void,
    onError?: (error: Error) => void,
  ): () => void {
    return onSnapshot(
      doc(getFirestore(), `users/${uid}/meta/preferences`),
      snapshot => listener(snapshot.exists() ? readAppLockPolicy(snapshot.data()) : null),
      error => onError?.(error),
    );
  }
}
