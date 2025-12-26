import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Secure storage service for sensitive data
 * Uses expo-secure-store on native platforms
 * Falls back to AsyncStorage on web (with encryption recommended for production)
 */
export class SecureStorageService {
  private static readonly TOKEN_KEY = 'auth_token';
  private static readonly USER_KEY = 'user_data';
  private static readonly REFRESH_TOKEN_KEY = 'refresh_token';

  /**
   * Save authentication token
   */
  static async saveToken(token: string): Promise<void> {
    try {
      if (Platform.OS === 'web') {
        // For web, use localStorage (consider encryption for production)
        localStorage.setItem(this.TOKEN_KEY, token);
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
        return localStorage.getItem(this.TOKEN_KEY);
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
        localStorage.removeItem(this.TOKEN_KEY);
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
        localStorage.setItem(this.USER_KEY, userString);
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
        userString = localStorage.getItem(this.USER_KEY);
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
        localStorage.removeItem(this.USER_KEY);
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
        localStorage.setItem(this.REFRESH_TOKEN_KEY, token);
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
        return localStorage.getItem(this.REFRESH_TOKEN_KEY);
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
        localStorage.removeItem(this.REFRESH_TOKEN_KEY);
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
