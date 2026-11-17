# Centro Assistenza — ticket senza email o Firestore

L'interfaccia Angular crea segnalazioni tramite API, il backend Node.js memorizza i ticket e gli allegati in SQLite. Non utilizza Firestore, Firebase Storage, Cloud Functions o invio email. Firebase Authentication rimane la modalità di accesso già presente nell'app: il backend verifica **solo l'identità** attraverso la firma del token Firebase; non scrive né legge dati di ticket da Firebase.

## Requisiti

- Node.js 22.13+ su un server che possa eseguire un processo HTTP.
- Una **directory persistente** scrivibile per `SUPPORT_DB_PATH`. Hosting senza disco persistente comporta perdita dei ticket.
- HTTPS per il backend e CORS consentito solo all'origine dell'app.
- Nessuna password o token GitHub dentro Angular.

## Configurazione backend

```sh
cd support-api
npm install
FIREBASE_PROJECT_ID=football-squad-manager-6fdaa \
SUPPORT_ADMIN_UID=UID_REALE_ACCOUNT_SUPPORT \
APP_ORIGINS=https://football-squad-manager-5673e.web.app \
SUPPORT_DB_PATH=/percorso/persistente/support.sqlite \
PORT=8787 npm start
```

`SUPPORT_ADMIN_UID` è l'UID Firebase dell'account `squadmanagersupport@gmail.com` (Firebase Console > Authentication > Users). **Non** è la sua password. Solo quell'UID con l'email indicata nel token può leggere tutti i ticket, scaricare allegati e modificare lo stato. Gli altri utenti autenticati possono solo inviare segnalazioni. Configurare anche backup regolari del database SQLite.

In `src/environments/environment.ts`, impostare:

```ts
supportApiUrl: 'https://il-tuo-backend-https.example'
```

L'URL deve essere un endpoint HTTPS reale e raggiungibile dai browser degli utenti. Poi pubblicare l'app attraverso il workflow di deploy esistente.

## Endpoint

- `POST /api/support/tickets` — invia descrizione e allegati (max 8 allegati, 15 MB complessivi) da utente autenticato.
- `GET /api/support/tickets` — elenco ticket, solo supporto.
- `PATCH /api/support/tickets/:id/status` — aggiorna stato tra `new`, `progress`, `resolved`, solo supporto.
- `GET /api/support/tickets/:id/attachments/:attachmentId` — download autorizzato allegati.
- `GET /health` — verifica processo.

**Stato della consegna:** fino a quando non si configura e pubblica il backend e non si imposta l'URL API nell'app, l'invio non può funzionare. Il frontend non scarica più file `.eml` e mostra un errore chiaro invece di simulare l'invio.
