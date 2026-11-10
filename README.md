# Football Squad Manager

A private, dark-themed Angular Progressive Web App for managing football squads.

## Project status
**Phase 2 — Firebase foundation in progress.** The Angular PWA shell is merged to `main`; Firebase Authentication, personal workspace bootstrap, and baseline Firestore rules are being implemented on `feat/firebase-auth-workspace`.

## Product goals
- Manage workspaces, teams, players, shirt numbers, roles, squads, formations and matches.
- Support manual interaction and Italian voice commands.
- Import Excel/CSV files with column mapping, preview, validation and explicit confirmation.
- Export squad and match data.
- Work as an installable PWA with an offline application shell.
- Keep the initial deployment within Firebase Spark (no-cost) plan.

## Technology
- Angular 22 + TypeScript
- Angular Material
- Firebase Authentication (email/password and Google)
- Cloud Firestore
- Firebase Hosting
- Angular Service Worker
- GitHub Actions
- SheetJS for browser-side spreadsheet processing (license and package version to be verified before adoption)
- Native browser Web Speech API; no paid speech or AI API

## Non-negotiable constraints
- Do not enable Firebase Blaze or attach a billing account.
- Do not add paid services or dependencies that require a paid account.
- Do not silently overwrite or delete imported records.
- Require confirmation for destructive voice commands and ambiguous operations.
- Enforce workspace membership in Firestore Security Rules; never rely on UI-only authorization.
- Never commit secrets, service-account keys, API credentials or local environment files.

## Documentation
- [Architecture and technical decisions](docs/architecture.md)
- [Firestore data model](docs/data-model.md)
- [Firebase Spark setup](docs/firebase-setup.md)
- [Implementation roadmap](docs/roadmap.md)

## Development status
The Angular scaffold has passed GitHub Actions CI on `main`. Firebase integration is under review on its own feature branch. A Firebase project has not yet been connected, and no production deployment has been performed.
