import { PermissionsAndroid, Platform } from 'react-native';

/**
 * Attempt to request READ_SMS permission on Android.
 * Returns true if permission granted or not required (non-Android).
 */
export async function requestSmsPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  try {
    const granted = await PermissionsAndroid.request(
      PermissionsAndroid.PERMISSIONS.READ_SMS,
      {
        title: 'SMS Access',
        message: 'This app needs access to SMS messages to detect bank numbers for auto-parsing.',
        buttonPositive: 'Allow',
        buttonNegative: 'Deny',
      }
    );

    return granted === PermissionsAndroid.RESULTS.GRANTED;
  } catch (e) {
    console.warn('SMS permission request error', e);
    return false;
  }
}

/**
 * Read SMS messages on Android and return a unique list of sender phone numbers.
 * This uses a native module `react-native-get-sms-android` when available.
 * Falls back to an empty list when unavailable or on non-Android platforms.
 */
export async function getSmsNumbers(): Promise<string[]> {
  if (Platform.OS !== 'android') return [];

  try {
    // Dynamically require to avoid bundler issues on non-native platforms
    // and to allow graceful failure when the native module is not installed.
    // The popular native package is `react-native-get-sms-android`.
    // Example usage: SmsAndroid.list(filter, failCallback, successCallback)
    // where success returns (count, smsListString).
    // We parse the returned JSON and extract unique `address` values.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const SmsAndroid = require('react-native-get-sms-android');

    return await new Promise<string[]>((resolve, reject) => {
      try {
        const filter = JSON.stringify({ box: 'inbox' });
        SmsAndroid.list(
          filter,
          (fail: any) => {
            console.warn('Failed to list SMS:', fail);
            resolve([]);
          },
          (count: number, smsList: string) => {
            try {
              const arr = JSON.parse(smsList) as Array<any>;
              const numbers = Array.from(new Set(arr.map(s => s.address).filter(Boolean)));
              resolve(numbers);
            } catch (err) {
              console.warn('Failed to parse SMS list', err);
              resolve([]);
            }
          }
        );
      } catch (err) {
        console.warn('SMS list error', err);
        resolve([]);
      }
    });
  } catch (err) {
    console.warn('SMS native module not available', err);
    return [];
  }
}

export default { requestSmsPermission, getSmsNumbers };
