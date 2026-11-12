import { Injectable, inject, signal } from '@angular/core';
import { FIREBASE_AUTH, FIRESTORE_DB } from './firebase.tokens';
import type { Auth, User } from 'firebase/auth';
import {
  GoogleAuthProvider,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile
} from 'firebase/auth';
import {
  collection,
  doc,
  getDoc,
  serverTimestamp,
  writeBatch
} from 'firebase/firestore';

@Injectable({ providedIn: 'root' })
export class FirebaseAuthService {
  private readonly auth = inject(FIREBASE_AUTH, { optional: true });
  private readonly firestore = inject(FIRESTORE_DB, { optional: true });

  readonly configured = this.auth !== null && this.firestore !== null;
  readonly user = signal<User | null>(null);
  readonly loading = signal(this.configured);
  readonly workspaceId = signal<string | null>(null);
  readonly workspaceError = signal<string | null>(null);

  constructor() {
    if (!this.auth || !this.firestore) {
      this.loading.set(false);
      return;
    }

    onAuthStateChanged(this.auth, async (user) => {
      this.user.set(user);
      this.workspaceId.set(null);
      this.workspaceError.set(null);

      if (!user) {
        this.loading.set(false);
        return;
      }

      try {
        const workspaceId = await this.ensurePersonalWorkspace(user);
        this.workspaceId.set(workspaceId);
      } catch (error) {
        console.error('Unable to initialize the personal workspace.', error);
        this.workspaceError.set(
          'Accesso riuscito, ma non è stato possibile inizializzare lo spazio personale. Controlla la configurazione Firestore e le Security Rules.'
        );
      } finally {
        this.loading.set(false);
      }
    });
  }

  async register(email: string, password: string, displayName: string): Promise<void> {
    const auth = this.requireAuth();
    const credential = await createUserWithEmailAndPassword(auth, email.trim(), password);
    const name = displayName.trim();
    if (name) {
      await updateProfile(credential.user, { displayName: name });
      this.user.set(credential.user);
    }
  }

  async updateDisplayName(displayName: string): Promise<void> {
    const user = this.user();
    if (!user) throw new Error('Devi effettuare l’accesso per modificare il nome.');
    const name = displayName.trim();
    if (!name) throw new Error('Il nome non può essere vuoto.');
    await updateProfile(user, { displayName: name });
    this.user.set(user);
  }

  async signIn(email: string, password: string): Promise<void> {
    await signInWithEmailAndPassword(this.requireAuth(), email.trim(), password);
  }

  async signInWithGoogle(): Promise<void> {
    await signInWithPopup(this.requireAuth(), new GoogleAuthProvider());
  }

  async sendPasswordReset(email: string): Promise<void> {
    await sendPasswordResetEmail(this.requireAuth(), email.trim());
  }

  async signOut(): Promise<void> {
    await signOut(this.requireAuth());
    this.workspaceId.set(null);
  }

  private requireAuth(): Auth {
    if (!this.auth) {
      throw new Error('Firebase non è configurato. Completa prima la configurazione del progetto.');
    }
    return this.auth;
  }

  private async ensurePersonalWorkspace(user: User): Promise<string> {
    if (!this.firestore) {
      throw new Error('Firestore non è disponibile.');
    }

    const profileRef = doc(this.firestore, 'userProfiles', user.uid);
    const profileSnapshot = await getDoc(profileRef);
    if (profileSnapshot.exists()) {
      const workspaceId = profileSnapshot.data()['defaultWorkspaceId'];
      if (typeof workspaceId === 'string' && workspaceId.length > 0) {
        return workspaceId;
      }
      throw new Error('Il profilo utente non contiene un workspace predefinito valido.');
    }

    const workspaceRef = doc(collection(this.firestore, 'workspaces'));
    const memberRef = doc(this.firestore, 'workspaces', workspaceRef.id, 'members', user.uid);
    const batch = writeBatch(this.firestore);
    const now = serverTimestamp();

    batch.set(workspaceRef, {
      name: user.displayName?.trim() || 'La mia società',
      ownerId: user.uid,
      createdAt: now,
      updatedAt: now
    });
    batch.set(memberRef, {
      role: 'owner',
      status: 'active',
      displayName: user.displayName || null,
      createdAt: now,
      updatedAt: now
    });
    batch.set(profileRef, {
      defaultWorkspaceId: workspaceRef.id,
      displayName: user.displayName || null,
      email: user.email || null,
      createdAt: now,
      updatedAt: now
    });

    await batch.commit();
    return workspaceRef.id;
  }
}
