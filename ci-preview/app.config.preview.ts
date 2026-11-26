// CI-only replacement for src/app/app.config.ts: the UI preview workflow copies
// this file over the real config so the built app talks to local emulators.
import { ApplicationConfig } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import type { FirebaseApp } from 'firebase/app';
import { FIREBASE_APP, FIREBASE_AUTH, FIRESTORE_DB } from './core/firebase.tokens';
import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    provideServiceWorker('ngsw-worker.js', { enabled: false }),
    { provide: FIREBASE_APP, useFactory: () => initializeApp({ apiKey: 'demo-key', authDomain: 'demo-fsm.firebaseapp.com', projectId: 'demo-fsm', appId: '1:1:web:1' }) },
    {
      provide: FIREBASE_AUTH,
      useFactory: (app: FirebaseApp) => { const auth = getAuth(app); connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true }); return auth; },
      deps: [FIREBASE_APP]
    },
    {
      provide: FIRESTORE_DB,
      useFactory: (app: FirebaseApp) => { const db = getFirestore(app); connectFirestoreEmulator(db, '127.0.0.1', 8080); return db; },
      deps: [FIREBASE_APP]
    }
  ]
};
