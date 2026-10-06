import { Platform } from 'react-native';
import { firebaseConfig } from '@/config/firebase';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { GoogleSignin } from '@react-native-google-signin/google-signin';
import { initializeApp } from 'firebase/app';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  getAuth,
  // @ts-ignore
  getReactNativePersistence,
  initializeAuth,
  sendPasswordResetEmail,
  signInWithCredential,
  signInWithPopup,
  signInWithEmailAndPassword,
  updateProfile,
  User
} from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';

const GOOGLE_WEB_CLIENT_ID = '891851135453-injmmpfl3qncm01q9c6c78t3a2mjmjq8.apps.googleusercontent.com';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Configure Google Sign-In once at module load
if (Platform.OS !== 'web') GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

let auth: any;
try {
  auth = initializeAuth(app, {
    // @ts-ignore
    persistence: getReactNativePersistence(ReactNativeAsyncStorage)
  });
} catch (e) {
  // logic to handle if auth is already initialized or other errors
  auth = getAuth(app);
}

function getFirestoreInstance() {
  return getFirestore(app);
}

/**
 * Normalize an Ethiopian phone number to E.164 (+2519XXXXXXXX / +2517XXXXXXXX).
 * Accepts: +251XXXXXXXXX, 251XXXXXXXXX, 09XXXXXXXX, 07XXXXXXXX, 9XXXXXXXX, 7XXXXXXXX
 */
export function normalizePhone(phone: string): string {
  // Strip whitespace, dashes, parentheses, dots
  const s = phone.trim().replace(/[\s\-().]/g, '');
  if (s.startsWith('+251')) return s;
  if (s.startsWith('251')) return '+' + s;
  if (s.startsWith('0')) return '+251' + s.slice(1); // 09... → +2519...
  return '+251' + s; // 9... → +2519...
}

/**
 * Returns an error string if invalid, or null if the phone is valid (or empty).
 * Ethiopian mobile numbers are +251 followed by 9 digits starting with 9 or 7.
 */
export function validatePhone(phone: string): string | null {
  if (!phone.trim()) return null; // optional — empty is fine
  const normalized = normalizePhone(phone);
  if (/^\+251[79]\d{8}$/.test(normalized)) return null;
  return 'Enter a valid phone number (e.g. 0912345678 or +251912345678)';
}

export class AuthService {
  /**
   * Sign in with email and password
   */
  static async signIn(email: string, password: string): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      return { success: true, user: userCredential.user };
    } catch (error: any) {
      console.error('Error signing in:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      let errorMessage = 'Failed to sign in';
      if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/user-disabled') {
        errorMessage = 'This account has been disabled';
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email';
      } else if (error.code === 'auth/wrong-password') {
        errorMessage = 'Incorrect password';
      } else if (error.code === 'auth/invalid-credential') {
        errorMessage = 'Invalid email or password. If you just enabled Email/Password auth in Firebase, try creating a new account first.';
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMessage = 'Email/Password authentication is not enabled. Please enable it in Firebase Console → Authentication → Sign-in method → Email/Password';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Write (or update) the phoneIndex entry so the phone number can be used to sign in.
   * Also stores the phone number on the user's profile document.
   */
  static async savePhoneIndex(uid: string, email: string, phone: string): Promise<void> {
    const normalized = normalizePhone(phone);
    if (!normalized) return;
    const firestore = getFirestoreInstance();

    // Profile write is the authoritative store — must succeed.
    await setDoc(doc(firestore, 'users', uid, 'meta', 'profile'), { phoneNumber: normalized }, { merge: true });

    // phoneIndex lets other users find this account by phone — best-effort.
    try {
      if (auth.currentUser?.phoneNumber === normalized) await setDoc(doc(firestore, 'phoneIndex', normalized), { uid, email }, { merge: true });
    } catch (err) {
      console.warn('[AuthService] savePhoneIndex: phoneIndex write failed (check Firestore rules):', err);
    }
  }

  /**
   * Returns the phone number stored on the user's profile, or null if none set.
   */
  static async getUserPhone(uid: string): Promise<string | null> {
    try {
      const firestore = getFirestoreInstance();
      const snap = await getDoc(doc(firestore, 'users', uid, 'meta', 'profile'));
      if (snap.exists()) {
        return (snap.data() as { phoneNumber?: string }).phoneNumber ?? null;
      }
      return null;
    } catch (err) {
      console.warn('[AuthService] getUserPhone failed:', err);
      return null;
    }
  }

  /**
   * Create new account with email and password
   */
  static async signUp(
    email: string,
    password: string,
    displayName?: string,
    phoneNumber?: string,
  ): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      const userCredential = await createUserWithEmailAndPassword(auth, email, password);

      if (displayName && userCredential.user) {
        await updateProfile(userCredential.user, { displayName });
      }

      if (phoneNumber && userCredential.user) {
        await AuthService.savePhoneIndex(userCredential.user.uid, email, phoneNumber);
      }

      return { success: true, user: userCredential.user };
    } catch (error: any) {
      console.error('Error signing up:', error);
      console.error('Error code:', error.code);
      console.error('Error message:', error.message);

      let errorMessage = 'Failed to create account';
      if (error.code === 'auth/email-already-in-use') {
        errorMessage = 'An account with this email already exists';
      } else if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/weak-password') {
        errorMessage = 'Password should be at least 6 characters';
      } else if (error.code === 'auth/operation-not-allowed') {
        errorMessage = 'Email/Password authentication is not enabled. Please enable it in Firebase Console → Authentication → Sign-in method → Email/Password';
      } else if (error.message) {
        errorMessage = error.message;
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Send password reset email
   */
  static async resetPassword(email: string): Promise<{ success: boolean; error?: string }> {
    try {
      await sendPasswordResetEmail(auth, email);
      return { success: true };
    } catch (error: any) {
      console.error('Error sending reset email:', error);

      let errorMessage = 'Failed to send reset email';
      if (error.code === 'auth/invalid-email') {
        errorMessage = 'Invalid email address';
      } else if (error.code === 'auth/user-not-found') {
        errorMessage = 'No account found with this email';
      }

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Sign in with Google using native Google Sign-In + Firebase credential
   */
  static async signInWithGoogle(): Promise<{ success: boolean; user?: User; error?: string }> {
    try {
      if (Platform.OS === 'web') {
        const result = await signInWithPopup(auth, new GoogleAuthProvider());
        return { success: true, user: result.user };
      }
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      const response = await GoogleSignin.signIn();
      const idToken = (response as any)?.data?.idToken ?? (response as any)?.idToken;
      if (!idToken) throw new Error('No ID token returned from Google');
      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, credential);
      return { success: true, user: userCredential.user };
    } catch (error: any) {
      console.error('Google sign-in error:', error);
      if (error.code === 'SIGN_IN_CANCELLED') {
        return { success: false, error: 'Sign-in cancelled' };
      }
      return { success: false, error: error.message || 'Google sign-in failed' };
    }
  }

  /**
   * Get current user
   */
  static getCurrentUser() {
    return auth.currentUser;
  }

  /**
   * Sign out
   */
  static async signOut(): Promise<void> {
    await auth.signOut();
  }

  /**
   * Listen to auth state changes
   */
  static onAuthStateChanged(callback: (user: User | null) => void) {
    return auth.onAuthStateChanged(callback);
  }

  /**
   * Get user token
   */
  static async getUserToken(): Promise<string | null> {
    const user = this.getCurrentUser();
    if (user) {
      return await user.getIdToken();
    }
    return null;
  }

  /**
   * Update user profile
   */
  static async updateUserProfile(displayName?: string, photoURL?: string): Promise<{ success: boolean; error?: string }> {
    try {
      const user = this.getCurrentUser();
      if (!user) {
        return { success: false, error: 'No user logged in' };
      }

      await updateProfile(user, { displayName, photoURL });
      return { success: true };
    } catch (error: any) {
      console.error('Error updating profile:', error);
      return { success: false, error: 'Failed to update profile' };
    }
  }
}

export { auth };
