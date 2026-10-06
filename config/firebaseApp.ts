import { FirebaseApp, getApp, getApps, initializeApp } from 'firebase/app';
import { firebaseConfig } from './firebase';

/**
 * Single owner of the Firebase app instance.
 *
 * `initializeApp` previously ran in three places — unguarded at module load in
 * `AuthService`, guarded in `LinkedLoanService`, and `RemotePushService` called
 * `getApp()` outright and so depended on one of the others having been imported
 * first. Whichever module loaded first decided when the app existed, which also
 * left no single point at which App Check could attach before the first
 * Firestore or Auth call.
 */
export function getFirebaseApp(): FirebaseApp {
  const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
  attachAppCheck(app);
  return app;
}

let appCheckAttached = false;

/**
 * App Check attestation.
 *
 * The public web API key lets anyone call the project's APIs directly, so
 * Firestore rules and callable auth checks are the only thing standing between
 * a scripted client and the backend. App Check adds device attestation on top.
 *
 * Native attestation (Play Integrity / App Attest) needs
 * `@react-native-firebase/app-check`, a Firebase console registration and a
 * native rebuild, so it is not wired here. Web uses reCAPTCHA v3 when a site
 * key is configured; with no key this is a no-op rather than a hard failure, so
 * an unconfigured project keeps working exactly as before.
 *
 * Do NOT set `enforceAppCheck` on the callables until attestation is live on
 * every shipped platform — enforcing first would lock out all existing clients.
 */
function attachAppCheck(app: FirebaseApp) {
  if (appCheckAttached) return;
  appCheckAttached = true;

  const siteKey = process.env.EXPO_PUBLIC_RECAPTCHA_SITE_KEY;
  if (!siteKey || typeof document === 'undefined') return;

  try {
    const { initializeAppCheck, ReCaptchaV3Provider } = require('firebase/app-check');
    initializeAppCheck(app, {
      provider: new ReCaptchaV3Provider(siteKey),
      isTokenAutoRefreshEnabled: true,
    });
  } catch (error) {
    // Attestation is defence in depth; losing it must not break sign-in.
    console.warn('[firebase] App Check could not be initialized:', error);
  }
}
