# Football Squad Manager

A private, dark-themed Angular Progressive Web App for managing football squads.

## Project status
**Phase 0 — foundation and architecture.** The repository is being prepared before application implementation.

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
- [Implementation roadmap](docs/roadmap.md)

## Development status
No application build, automated tests or deployment have been run yet. Those checks will be reported only after they are actually executed.