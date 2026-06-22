import { firebaseConfig } from '@/config/firebase';
import ReactNativeAsyncStorage from '@react-native-async-storage/async-storage';
import { initializeApp } from 'firebase/app';
import {
  createUserWithEmailAndPassword,
  getAuth,
  // @ts-ignore
  getReactNativePersistence,
  initializeAuth,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  updateProfile,
  User
} from 'firebase/auth';
import { doc, getDoc, getFirestore, setDoc } from 'firebase/firestore';

// Initialize Firebase
const app = initializeApp(firebaseConfig);

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

/** Strip all non-digit chars; preserve a leading '+' for E.164 numbers. */
export function normalizePhone(phone: string): string {
  const s = phone.trim();
  if (s.startsWith('+')) {
    return '+' + s.slice(1).replace(/\D/g, '');
  }
  return s.replace(/\D/g, '');
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
   * Look up a user's email by their phone number.
   * Returns null if no account is associated with that phone number.
   */
  static async lookupEmailByPhone(phone: string): Promise<string | null> {
    try {
      const normalized = normalizePhone(phone);
      if (!normalized) return null;
      const firestore = getFirestoreInstance();
      const snap = await getDoc(doc(firestore, 'phoneIndex', normalized));
      if (snap.exists()) {
        return (snap.data() as { email: string }).email ?? null;
      }
      return null;
    } catch (err) {
      console.warn('[AuthService] lookupEmailByPhone failed:', err);
      return null;
    }
  }

  /**
   * Write (or update) the phoneIndex entry so the phone number can be used to sign in.
   * Also stores the phone number on the user's profile document.
   */
  static async savePhoneIndex(uid: string, email: string, phone: string): Promise<void> {
    try {
      const normalized = normalizePhone(phone);
      if (!normalized) return;
      const firestore = getFirestoreInstance();
      await setDoc(doc(firestore, 'phoneIndex', normalized), { uid, email }, { merge: true });
      await setDoc(doc(firestore, 'users', uid, 'meta', 'profile'), { phoneNumber: normalized }, { merge: true });
    } catch (err) {
      console.warn('[AuthService] savePhoneIndex failed:', err);
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
