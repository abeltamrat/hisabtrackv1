import { Platform } from 'react-native';
import { getSessionScope } from './SessionStorage';
import * as Crypto from 'expo-crypto';
import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@/services/SessionStorage';

const pinKey = () => `app_lock_pin_${getSessionScope()}`;
const readPin = () => Platform.OS === 'web' ? AsyncStorage.getItem('app_lock_pin') : SecureStore.getItemAsync(pinKey());
const writePin = (value: string) => Platform.OS === 'web' ? AsyncStorage.setItem('app_lock_pin', value) : SecureStore.setItemAsync(pinKey(), value);
const APP_LOCK_ENABLED_KEY = '@hisabtrack_app_lock_enabled';
const BIOMETRIC_ENABLED_KEY = '@hisabtrack_biometric_enabled';

export class AppLockService {
  static async hashPin(pin: string): Promise<string> {
    return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `hisabtrack_pin_${pin}`);
  }

  static async setPin(pin: string): Promise<void> {
    if (!/^\d{4,8}$/.test(pin)) throw new Error('PIN must contain 4 to 8 digits');
    const salt = Crypto.randomUUID();
    const hash = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
    await writePin(JSON.stringify({ salt, hash }));
    await AsyncStorage.removeItem('pin_attempts');
  }
  static async verifyPin(pin: string): Promise<boolean> {
    const attempts = JSON.parse(await AsyncStorage.getItem('pin_attempts') || '{"count":0,"until":0}');
    if (attempts.until > Date.now()) throw new Error('Too many attempts. Wait before trying again.');
    const stored = await readPin(); if (!stored) return false;
    if (!stored.startsWith('{')) {
      const matches = await this.hashPin(pin) === stored;
      if (matches) { await this.setPin(pin); return true; }
    }
    const { salt, hash } = stored.startsWith('{') ? JSON.parse(stored) : { salt: '', hash: '' };
    const actual = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${pin}`);
    if (actual === hash) { await AsyncStorage.removeItem('pin_attempts'); return true; }
    const count = attempts.count + 1;
    await AsyncStorage.setItem('pin_attempts', JSON.stringify({ count, until: count >= 5 ? Date.now() + Math.min(3600000, 30000 * Math.pow(2, count - 5)) : 0 }));
    return false;
  }
  static async hasPin() { return !!(await readPin()); }
  static async clearPin() {
    if (Platform.OS === 'web') await AsyncStorage.removeItem('app_lock_pin');
    else await SecureStore.deleteItemAsync(pinKey());
    await AsyncStorage.removeItem('pin_attempts');
  }

  static async isBiometricAvailable(): Promise<boolean> {
    try {
      const hardware = await LocalAuthentication.hasHardwareAsync();
      if (!hardware) return false;
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      return enrolled;
    } catch {
      return false;
    }
  }

  static async authenticateWithBiometric(): Promise<boolean> {
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Unlock HisabTrack',
        fallbackLabel: 'Use PIN instead',
        disableDeviceFallback: true,
        cancelLabel: 'Cancel',
      });
      return result.success;
    } catch {
      return false;
    }
  }

  static async isAppLockEnabled(): Promise<boolean> {
    const val = await AsyncStorage.getItem(APP_LOCK_ENABLED_KEY);
    return val === 'true';
  }

  static async setAppLockEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(APP_LOCK_ENABLED_KEY, enabled ? 'true' : 'false');
  }

  static async isBiometricEnabled(): Promise<boolean> {
    const val = await AsyncStorage.getItem(BIOMETRIC_ENABLED_KEY);
    return val === 'true';
  }

  static async setBiometricEnabled(enabled: boolean): Promise<void> {
    await AsyncStorage.setItem(BIOMETRIC_ENABLED_KEY, enabled ? 'true' : 'false');
  }
}
