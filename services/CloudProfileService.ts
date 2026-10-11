import { doc, getDoc, getFirestore, serverTimestamp, setDoc } from 'firebase/firestore';

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
}
