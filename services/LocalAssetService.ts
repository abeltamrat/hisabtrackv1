import BUNDLED_ET from '@/assets/bankLogos/et';
import LocalChangeEmitter from './LocalChangeEmitter';
import { SecureStorageService } from './SecureStorageService';
import Storage from './SessionStorage';

const USER_ASSETS_KEY = 'local_bank_logos';
const BUNDLED_LOGO_MAP = Object.fromEntries(BUNDLED_ET.map((logo) => [logo.name, logo.url])) as Record<string, string>;

export default class LocalAssetService {
  static async getUserAssets(): Promise<Record<string, string>> {
    try {
      const stored = await Storage.getItem(USER_ASSETS_KEY);
      if (stored) return JSON.parse(stored) as Record<string, string>;

      // Older releases placed image data in the same SecureStore value as API
      // keys and settings. A single imported base64 logo can exceed the native
      // keystore's small-value limit, preventing every later settings write.
      const user = (await SecureStorageService.getUserData()) || {};
      const legacy = user[USER_ASSETS_KEY] as Record<string, string> | undefined;
      if (!legacy) return {};
      await Storage.setItem(USER_ASSETS_KEY, JSON.stringify(legacy));
      const safeUserData = { ...user };
      delete safeUserData[USER_ASSETS_KEY];
      await SecureStorageService.saveUserData(safeUserData);
      return legacy;
    } catch (e) {
      console.error('Failed to load user assets', e);
      return {};
    }
  }

  static async saveUserAssets(map: Record<string, string>) {
    try {
      await Storage.setItem(USER_ASSETS_KEY, JSON.stringify(map));
      try { LocalChangeEmitter.emit(); } catch (e) { /* ignore */ }
    } catch (e) {
      console.error('Failed to save user assets', e);
      throw e;
    }
  }

  static async getAllLogos(): Promise<Record<string, string>> {
    // Merge bundled ET logos with user assets (user overrides bundled if same name)
    const user = await this.getUserAssets();
    return { ...BUNDLED_LOGO_MAP, ...(user || {}) };
  }

  static async addAsset(name: string, uri: string) {
    const user = await this.getUserAssets();
    user[name] = uri;
    await this.saveUserAssets(user);
  }

  static async renameAsset(oldName: string, newName: string) {
    if (!oldName || !newName || oldName === newName) return;
    const user = await this.getUserAssets();
    const existing = user[oldName];
    if (!existing) return;
    // If newName exists, overwrite it
    user[newName] = existing;
    delete user[oldName];
    await this.saveUserAssets(user);
  }

  static async addAssetFromUrl(name: string, url: string) {
    // For now, store the URL directly. Consumers may fetch/convert if needed.
    return this.addAsset(name, url);
  }

  static async updateAsset(oldName: string, newName: string, newUri: string) {
    const user = await this.getUserAssets();
    if (!user[oldName]) return;
    
    // Remove old entry
    delete user[oldName];
    // Add new entry
    user[newName] = newUri;
    await this.saveUserAssets(user);
  }

  static async removeAsset(name: string) {
    const user = await this.getUserAssets();
    delete user[name];
    await this.saveUserAssets(user);
  }

}


