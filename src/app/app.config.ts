import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import type { FirebaseApp } from 'firebase/app';
import { environment, isFirebaseConfigured } from '../environments/environment';
import { FIREBASE_APP, FIREBASE_AUTH, FIRESTORE_DB } from './core/firebase.tokens';
import { routes } from './app.routes';

const firebaseProviders = isFirebaseConfigured
  ? [
      {
        provide: FIREBASE_APP,
        useFactory: () => initializeApp(environment.firebase)
      },
      {
        provide: FIREBASE_AUTH,
        useFactory: (app: FirebaseApp) => getAuth(app),
        deps: [FIREBASE_APP]
      },
      {
        provide: FIRESTORE_DB,
        useFactory: (app: FirebaseApp) => getFirestore(app),
        deps: [FIREBASE_APP]
      }
    ]
  : [];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideAnimationsAsync(),
    provideServiceWorker('ngsw-worker.js', {
      enabled: !isDevMode(),
      registrationStrategy: 'registerWhenStable:30000'
    }),
    ...firebaseProviders
  ]
};
