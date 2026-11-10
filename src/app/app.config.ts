import { ApplicationConfig, isDevMode } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { provideServiceWorker } from '@angular/service-worker';
import { getApp, initializeApp } from 'firebase/app';
import { Auth, getAuth } from 'firebase/auth';
import { Firestore, getFirestore } from 'firebase/firestore';
import { environment, isFirebaseConfigured } from '../environments/environment';
import { routes } from './app.routes';

const firebaseProviders = isFirebaseConfigured
  ? [
      {
        provide: Auth,
        useFactory: () => getAuth(initializeApp(environment.firebase))
      },
      {
        provide: Firestore,
        useFactory: () => getFirestore(getApp())
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
