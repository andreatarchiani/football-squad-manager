import type { FirebaseOptions } from 'firebase/app';

// Paste the Firebase web app configuration from Firebase Console here.
// These values identify the Firebase project; they are not server credentials.
export const environment = {
  firebase: {
    apiKey: '',
    authDomain: '',
    projectId: '',
    storageBucket: '',
    messagingSenderId: '',
    appId: ''
  } satisfies FirebaseOptions
};

export const isFirebaseConfigured = Boolean(
  environment.firebase.apiKey &&
  environment.firebase.authDomain &&
  environment.firebase.projectId &&
  environment.firebase.appId
);
