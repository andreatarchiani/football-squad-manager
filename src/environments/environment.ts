import type { FirebaseOptions } from 'firebase/app';

// Firebase web app configuration. These values identify the Firebase project;
// they are public client configuration, not server credentials.
export const environment = {
  firebase: {
    apiKey: 'AIzaSyAbPI3Wx6ITIK3mxJs9krOx12oPEkJD1Do',
    authDomain: 'football-squad-manager-6fdaa.firebaseapp.com',
    projectId: 'football-squad-manager-6fdaa',
    storageBucket: 'football-squad-manager-6fdaa.firebasestorage.app',
    messagingSenderId: '1062518492921',
    appId: '1:1062518492921:web:273928214d0a0ac865dc28'
  } satisfies FirebaseOptions
};

export const isFirebaseConfigured = Boolean(
  environment.firebase.apiKey &&
  environment.firebase.authDomain &&
  environment.firebase.projectId &&
  environment.firebase.appId
);
