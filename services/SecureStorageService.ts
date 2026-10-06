import { getSessionScope, sessionLocalStorage } from '@/services/SessionStorage';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secure storage service for sensitive data
 * Uses expo-secure-store on native platforms
 * Falls back to AsyncStorage on web (with encryption recommended for production)
 */
export class SecureStorageService {
  static async migrateLegacy() {
    if (Platform.OS === 'web') return;
    for (const [oldKey, key] of [['user_data', this.USER_KEY], ['auth_token', this.TOKEN_KEY], ['refresh_token', this.REFRESH_TOKEN_KEY], ['app_lock_pin_hash', `app_lock_pin_${getSessionScope()}`]]) {
      const value = await SecureStore.getItemAsync(oldKey);
      if (value !== null && !(await SecureStore.getItemAsync(key))) await SecureStore.setItemAsync(key, value);
      if (value !== null) await SecureStore.deleteItemAsync(oldKey);
    }
  }

  private static get TOKEN_KEY() { return `auth_token_${getSessionScope()}`; }
  private static get USER_KEY() { return `user_data_${getSessionScope()}`; }
  private static get REFRESH_TOKEN_KEY() { return `refresh_token_${getSessionScope()}`; }

  /**
   * Save authentication token
   */
  static async saveToken(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        // For web, use localStorage (consider encryption for production)
        sessionLocalStorage.setItem(this.TOKEN_KEY, token);
      } else {
        await SecureStore.setItemAsync(this.TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('Error saving token:', error);
      throw error;
    }
  }

  /**
   * Get authentication token
   */
  static async getToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return sessionLocalStorage.getItem(this.TOKEN_KEY);
      } else {
        return await SecureStore.getItemAsync(this.TOKEN_KEY);
      }
    } catch (error) {
      console.error('Error getting token:', error);
      return null;
    }
  }

  /**
   * Delete authentication token
   */
  static async deleteToken(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        sessionLocalStorage.removeItem(this.TOKEN_KEY);
      } else {
        await SecureStore.deleteItemAsync(this.TOKEN_KEY);
      }
    } catch (error) {
      console.error('Error deleting token:', error);
    }
  }

  /**
   * Save user data
   */
  static async saveUserData(userData: any): Promise<void> {
    try {
      const userString = JSON.stringify(userData);
      if (Platform.OS === 'web') {
        sessionLocalStorage.setItem(this.USER_KEY, userString);
      } else {
        await SecureStore.setItemAsync(this.USER_KEY, userString);
      }
    } catch (error) {
      console.error('Error saving user data:', error);
      throw error;
    }
  }

  /**
   * Get user data
   */
  static async getUserData(): Promise<any | null> {
    try {
      let userString: string | null;
      if (Platform.OS === 'web') {
        userString = sessionLocalStorage.getItem(this.USER_KEY);
      } else {
        userString = await SecureStore.getItemAsync(this.USER_KEY);
      }

      return userString ? JSON.parse(userString) : null;
    } catch (error) {
      console.error('Error getting user data:', error);
      return null;
    }
  }

  /**
   * Delete user data
   */
  static async deleteUserData(): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        sessionLocalStorage.removeItem(this.USER_KEY);
      } else {
        await SecureStore.deleteItemAsync(this.USER_KEY);
      }
    } catch (error) {
      console.error('Error deleting user data:', error);
    }
  }

  /**
   * Save refresh token
   */
  static async saveRefreshToken(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        sessionLocalStorage.setItem(this.REFRESH_TOKEN_KEY, token);
      } else {
        await SecureStore.setItemAsync(this.REFRESH_TOKEN_KEY, token);
      }
    } catch (error) {
      console.error('Error saving refresh token:', error);
      throw error;
    }
  }

  /**
   * Get refresh token
   */
  static async getRefreshToken(): Promise<string | null> {
    try {
      if (Platform.OS === 'web') {
        return sessionLocalStorage.getItem(this.REFRESH_TOKEN_KEY);
      } else {
        return await SecureStore.getItemAsync(this.REFRESH_TOKEN_KEY);
      }
    } catch (error) {
      console.error('Error getting refresh token:', error);
      return null;
    }
  }

  /**
   * Clear all secure data
   */
  static async clearAll(): Promise<void> {
    try {
      await this.deleteToken();
      await this.deleteUserData();
      if (Platform.OS === 'web') {
        sessionLocalStorage.removeItem(this.REFRESH_TOKEN_KEY);
      } else {
        await SecureStore.deleteItemAsync(this.REFRESH_TOKEN_KEY);
      }
    } catch (error) {
      console.error('Error clearing secure storage:', error);
    }
  }

  /**
   * Check if user is authenticated
   */
  static async isAuthenticated(): Promise<boolean> {
    const token = await this.getToken();
    return token !== null;
  }
}
