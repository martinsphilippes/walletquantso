// Authentication helpers wrapping the Firebase Auth SDK.

import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
  onAuthStateChanged,
  GoogleAuthProvider,
  signInWithPopup,
  type User,
  type Unsubscribe,
} from "firebase/auth";
import { auth } from "./firebase";

/** Sign in an existing user with email and password. */
export function signIn(email: string, password: string): Promise<User> {
  return signInWithEmailAndPassword(auth, email, password).then((cred) => cred.user);
}

/** Register a new user with email and password. */
export function signUp(email: string, password: string): Promise<User> {
  return createUserWithEmailAndPassword(auth, email, password).then((cred) => cred.user);
}

/** Sign in with a Google popup. */
export function signInWithGoogle(): Promise<User> {
  return signInWithPopup(auth, new GoogleAuthProvider()).then((cred) => cred.user);
}

/** Sign out the current user. */
export function signOut(): Promise<void> {
  return fbSignOut(auth);
}

/** The currently signed-in user, or null. */
export function getCurrentUser(): User | null {
  return auth.currentUser;
}

/** Subscribe to auth state changes. Returns an unsubscribe function. */
export function onAuthChanged(callback: (user: User | null) => void): Unsubscribe {
  return onAuthStateChanged(auth, callback);
}
