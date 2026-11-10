# Implementation roadmap

This roadmap is intentionally incremental. Each phase should be reviewed before moving to the next.

## Phase 0 — repository foundation
- [x] Verify private GitHub repository access and main branch
- [x] Create an isolated foundation branch
- [x] Record product constraints and architecture
- [x] Record the initial architecture baseline

## Phase 1 — Angular application shell
- [x] Add Angular 22 application scaffold with strict TypeScript settings
- [x] Add Angular Material dependency and initial dark theme
- [x] Add responsive navigation shell and empty-state dashboard
- [x] Add PWA manifest, SVG icon and service worker configuration
- [ ] Add application update notification
- [ ] Add lint, unit-test and production-build scripts

## Phase 2 — Firebase foundation
- [ ] Configure Firebase project for Spark only
- [ ] Add email/password and Google authentication
- [ ] Add workspace context and route guards
- [ ] Define Firestore schema and indexes
- [ ] Implement deny-by-default Security Rules
- [ ] Add emulator-based Rules tests

## Phase 3 — core squad management
- [ ] Teams and seasons
- [ ] Player registry and player-team membership
- [ ] Shirt number reservation with transactions
- [ ] Squad selection and player roles
- [ ] Formation templates and lineup editor
- [ ] Match calendar and match details

## Phase 4 — Excel import/export
- [ ] Verify spreadsheet parser package, license and browser compatibility
- [ ] Implement .xlsx and .csv parsing
- [ ] Column mapping and preview
- [ ] Row validation and duplicate/conflict report
- [ ] Explicit import confirmation and result summary
- [ ] Export to Excel

## Phase 5 — Italian voice control
- [ ] Browser support and permission handling
- [ ] Transcript preview and correction
- [ ] Intent parser and entity resolution
- [ ] Confirmation workflow for ambiguous/destructive actions
- [ ] Execute via shared domain services
- [ ] Manual fallback and accessibility review

## Phase 6 — release hardening
- [ ] Offline shell and connectivity states
- [ ] Security and privacy review
- [ ] Responsive/accessibility testing
- [ ] GitHub Actions CI
- [ ] Firebase Hosting deployment workflow
- [ ] Production smoke test and release documentation

## Release constraints
- Firebase Spark only; no Blaze, billing account or credit card.
- No paid APIs or services.
- Never claim a build, test or deployment passed unless it was executed and verified.