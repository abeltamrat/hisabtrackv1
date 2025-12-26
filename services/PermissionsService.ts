import { PermissionsAndroid, Platform } from 'react-native';

export type PermissionId =
  | 'READ_SMS'
  | 'SEND_SMS'
  | 'NOTIFICATIONS'
  | 'FILES'
  | 'CALENDAR'
  | 'CAMERA'
  | 'CONTACTS'
  | 'LOCATION';

export type PermissionStatus = 'granted' | 'denied' | 'prompt' | 'unavailable' | 'unknown';

const isWeb = Platform.OS === 'web';

export async function checkPermission(id: PermissionId): Promise<PermissionStatus> {
  try {
    if (isWeb) {
      if (id === 'NOTIFICATIONS') {
        // @ts-ignore
        const p = typeof Notification !== 'undefined' ? Notification.permission : 'default';
        return p === 'granted' ? 'granted' : p === 'denied' ? 'denied' : 'prompt';
      }

      if (id === 'CAMERA') {
        // @ts-ignore
        if (navigator?.permissions?.query) {
          try {
            // @ts-ignore
            const res = await navigator.permissions.query({ name: 'camera' as any });
            return res.state === 'granted' ? 'granted' : res.state === 'denied' ? 'denied' : 'prompt';
          } catch (e) {
            return 'unknown';
          }
        }
        return 'unknown';
      }

      // Not supported on web
      return 'unavailable';
    }

    if (id === 'LOCATION') {
      // @ts-ignore
      if (navigator?.permissions?.query) {
        try {
          // @ts-ignore
          const res = await navigator.permissions.query({ name: 'geolocation' as any });
          return res.state === 'granted' ? 'granted' : res.state === 'denied' ? 'denied' : 'prompt';
        } catch (e) {
          return 'unknown';
        }
      }
      return 'unknown';
    }

    // Native platforms (best-effort using PermissionsAndroid on Android)
    if (Platform.OS === 'android') {
      let perm: string | null = null;
      switch (id) {
        case 'READ_SMS':
          perm = PermissionsAndroid.PERMISSIONS.READ_SMS;
          break;
        case 'SEND_SMS':
          perm = PermissionsAndroid.PERMISSIONS.SEND_SMS;
          break;
        case 'CAMERA':
          perm = PermissionsAndroid.PERMISSIONS.CAMERA;
          break;
        case 'FILES':
          perm = PermissionsAndroid.PERMISSIONS.READ_EXTERNAL_STORAGE;
          break;
        case 'CALENDAR':
          perm = PermissionsAndroid.PERMISSIONS.READ_CALENDAR;
          break;
        case 'CONTACTS':
          perm = PermissionsAndroid.PERMISSIONS.READ_CONTACTS;
          break;
        case 'LOCATION':
          perm = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
          break;
        case 'NOTIFICATIONS':
          // Notifications are handled differently on Android; assume prompt
          return 'prompt';
      }

      if (!perm) return 'unknown';
      const result = await PermissionsAndroid.check(perm);
      return result ? 'granted' : 'denied';
    }

    // iOS: we can't reliably check without native modules here
    return 'prompt';
  } catch (e) {
    console.warn('checkPermission error', e);
    return 'unknown';
  }
}

export async function requestPermission(id: PermissionId): Promise<PermissionStatus> {
  try {
    if (isWeb) {
      if (id === 'NOTIFICATIONS') {
        // @ts-ignore
        const res = typeof Notification !== 'undefined' ? await Notification.requestPermission() : 'denied';
        return res === 'granted' ? 'granted' : res === 'denied' ? 'denied' : 'prompt';
      }

      if (id === 'CAMERA') {
        try {
          // @ts-ignore
          await navigator.mediaDevices.getUserMedia({ video: true });
          return 'granted';
        } catch (e) {
          return 'denied';
        }
      }

      if (id === 'LOCATION') {
        try {
          // @ts-ignore
          await navigator.geolocation.getCurrentPosition(() => {});
          return 'granted';
        } catch (e) {
          return 'denied';
        }
      }

      return 'unavailable';
    }

    if (Platform.OS === 'android') {
      let perm: string | null = null;
      switch (id) {
        case 'READ_SMS':
          perm = PermissionsAndroid.PERMISSIONS.READ_SMS;
          break;
        case 'SEND_SMS':
          perm = PermissionsAndroid.PERMISSIONS.SEND_SMS;
          break;
        case 'CAMERA':
          perm = PermissionsAndroid.PERMISSIONS.CAMERA;
          break;
        case 'FILES':
          perm = PermissionsAndroid.PERMISSIONS.WRITE_EXTERNAL_STORAGE;
          break;
        case 'CALENDAR':
          perm = PermissionsAndroid.PERMISSIONS.WRITE_CALENDAR;
          break;
        case 'CONTACTS':
          perm = PermissionsAndroid.PERMISSIONS.WRITE_CONTACTS;
          break;
        case 'LOCATION':
          perm = PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION;
          break;
        case 'NOTIFICATIONS':
          // Recommend opening settings for notifications
          return 'prompt';
      }

      if (!perm) return 'unknown';
      const res = await PermissionsAndroid.request(perm);
      return res === PermissionsAndroid.RESULTS.GRANTED ? 'granted' : 'denied';
    }

    // iOS: fall back to prompt (native modules required for real requests)
    return 'prompt';
  } catch (e) {
    console.warn('requestPermission error', e);
    return 'unknown';
  }
}
