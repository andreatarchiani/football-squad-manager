# Firebase setup

This application is designed for the Firebase **Spark (free) plan**. Do not upgrade to Blaze, attach a billing account, or enable paid products.

## 1. Create the Firebase project

1. Open the Firebase Console.
2. Create a project named Football Squad Manager (or another name you prefer).
3. Keep Google Analytics disabled unless you have a specific need for it.
4. Confirm that the project remains on the Spark plan.
5. In Project settings, add an application of type **Web**.
6. Copy the Firebase web app configuration.

The web configuration contains public client identifiers. Never use a service-account JSON file or Admin SDK credentials in this Angular application.

## 2. Configure Authentication

In **Build → Authentication → Get started**:

1. Open **Sign-in method**.
2. Enable **Email/Password**.
3. Enable **Google** and select a support email.
4. Under **Settings → Authorized domains**, verify that localhost is present for local development. Add the eventual Hosting domain when it is created.

## 3. Create Cloud Firestore

1. Open **Build → Firestore Database → Create database**.
2. Choose a region close to your users. The region cannot be changed after creation.
3. Start in production mode.
4. Publish the rules from this repository using the Firebase CLI:

```bash
npm install -g firebase-tools
firebase login
firebase use --add
firebase deploy --only firestore:rules
```

When prompted by firebase use --add, select the project created in step 1. This creates a local .firebaserc file; it is intentionally not committed because the project ID is specific to your Firebase account.

## 4. Add the web configuration to Angular

Open src/environments/environment.ts and fill in the values from the Firebase web app configuration:

- apiKey
- authDomain
- projectId
- storageBucket
- messagingSenderId
- appId

These are browser-side Firebase configuration values, not server secrets. Do not add service-account keys, private keys, or Admin SDK credentials.

Until the required values are present, the app displays a setup screen and does not initialize Firebase.

## 5. Run locally

```bash
npm install
npm start
```

Open the local URL printed by Angular CLI. Register with email/password or Google. After the first successful authentication, the app creates:

- workspaces/{workspaceId} with the authenticated user as owner;
- workspaces/{workspaceId}/members/{uid} with the owner role;
- userProfiles/{uid} with the default workspace reference.

The three documents are written in one Firestore batch. Security Rules use getAfter() so the initial workspace and membership are validated as one atomic operation.

## Current implementation boundary

This phase provides Firebase initialization, email/password registration and login, Google popup login, password-reset email, sign-out, personal workspace bootstrap, and baseline workspace Security Rules.

Team/player CRUD, invitation flows, role administration, shirt-number transaction logic, emulator-based rules tests, and production deployment are subsequent milestones. Do not treat the current dashboard placeholders as implemented features.
