import BUNDLED_ET from '@/assets/bankLogos/et';
import LocalChangeEmitter from './LocalChangeEmitter';
import { SecureStorageService } from './SecureStorageService';

const USER_ASSETS_KEY = 'local_bank_logos';
const BUNDLED_LOGO_MAP = Object.fromEntries(BUNDLED_ET.map((logo) => [logo.name, logo.url])) as Record<string, string>;

export default class LocalAssetService {
  static async getUserAssets(): Promise<Record<string, string>> {
    try {
      const raw = await SecureStorageService.getUserData();
      const user = raw || {};
      return (user[USER_ASSETS_KEY] as Record<string, string>) || {};
    } catch (e) {
      console.error('Failed to load user assets', e);
      return {};
    }
  }

  static async saveUserAssets(map: Record<string, string>) {
    try {
      const existing = (await SecureStorageService.getUserData()) || {};
      existing[USER_ASSETS_KEY] = map;
      await SecureStorageService.saveUserData(existing);
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


