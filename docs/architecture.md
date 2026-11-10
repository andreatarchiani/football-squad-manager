# Architecture and technical decisions

## 1. Product scope
Football Squad Manager is an installable, responsive PWA for managing football teams. The first release is designed for one primary user, but its data model and authorization boundaries support multiple users and workspaces later.

Core domains: workspaces and memberships; teams and seasons; players and player-team membership; shirt-number assignments; formations and lineup selections; matches and match squads; spreadsheet import/export; voice command interpretation; activity/audit events.

## 2. Technology baseline
| Area | Choice |
|---|---|
| Frontend | Angular 22, standalone APIs, TypeScript strict mode |
| UI | Angular Material, dark theme, responsive layouts |
| PWA | Angular Service Worker, web app manifest |
| Identity | Firebase Authentication: email/password and Google |
| Database | Cloud Firestore |
| Hosting | Firebase Hosting |
| CI | GitHub Actions |
| Spreadsheet | SheetJS in the browser, after package/license verification |
| Voice | Native Web Speech API only; browser capability detection and manual fallback |

Use a currently supported Node.js release compatible with the selected Angular CLI. Pin and verify exact package versions in the implementation phase rather than guessing. Firebase must remain on the Spark plan; no billing account, Blaze upgrade, paid API or paid speech service is allowed.

## 3. Application boundaries
Organize the frontend by feature and keep UI components separate from domain logic and infrastructure:
- core/: authentication, workspace context, route guards, global error handling
- shared/: reusable UI, pipes, directives and shared types
- features/teams/: team and season management
- features/players/: player records and team membership
- features/squads/: squad selection and shirt numbers
- features/formations/: formation templates and lineup editor
- features/matches/: fixtures, match details and match squads
- features/import-export/: spreadsheet parsing, mapping, validation and export
- features/voice/: speech recognition, intent parsing, validation and confirmation
- data-access/: typed Firestore repositories and transaction boundaries

Feature components must not call Firestore directly. Put database operations behind typed repositories/services so business rules can be tested independently.

## 4. Firestore data model
Proposed workspace-scoped collections:
- /workspaces/{workspaceId}
- /workspaces/{workspaceId}/members/{uid}
- /workspaces/{workspaceId}/teams/{teamId}
- /workspaces/{workspaceId}/players/{playerId}
- /workspaces/{workspaceId}/formations/{formationId}
- /workspaces/{workspaceId}/matches/{matchId}
- /workspaces/{workspaceId}/activity/{activityId}
- /workspaces/{workspaceId}/teams/{teamId}/jerseyReservations/{number}

A player is a person record in a workspace. Team membership and season-specific shirt number should be modeled explicitly rather than assuming one permanent shirt number per person.

Firestore has no native unique constraints. Reserve shirt numbers transactionally using reservation documents. The transaction must verify workspace membership, team/season scope and reservation availability before writing. Never rely on a client-side duplicate check alone.

Security Rules must deny access by default and verify the authenticated user's membership in the relevant workspace. Validate allowed fields, types and ownership on writes. Admin-only operations must be enforced in Rules or trusted server-side code; the frontend is not a security boundary. Avoid Cloud Functions if they require Blaze for the chosen deployment path.

## 5. Spreadsheet import/export
- Parse files locally in the browser; do not upload source spreadsheets to a server.
- Support .xlsx and .csv; add .xls only if the chosen parser version supports it reliably.
- Let the user map source columns to domain fields.
- Show a preview and row-level validation errors before applying changes.
- Detect likely duplicates and conflicting shirt numbers.
- Do not silently overwrite or delete existing records.
- Require a final explicit confirmation; report created, skipped and rejected rows.
- Export only fields the user is authorized to access.

## 6. Italian voice commands
Use a staged pipeline:
1. Capability detection and microphone permission
2. Speech recognition and transcript display
3. Italian intent parsing
4. Entity resolution (team/player/number)
5. Validation against current application state and permissions
6. Confirmation for ambiguous or destructive actions
7. Execution through the same domain services used by manual controls
8. Spoken/textual result feedback

The Web Speech API is browser-dependent and may rely on browser/vendor network services. It is not guaranteed to work offline or in every browser. Manual controls must always remain available. Do not send transcripts to a paid external AI service.

## 7. PWA and offline behavior
Cache the application shell and static assets. Treat Firestore data synchronization and offline writes as a separate, explicitly tested capability. Do not promise that voice recognition or all database operations work offline. Show clear connectivity and pending-sync states where applicable. Add an update prompt so users can deliberately reload when a new application version is ready.

## 8. Security, privacy and cost controls
- Firebase Spark only; never attach billing or upgrade to Blaze.
- No Firebase Storage is required for the initial release.
- No secrets or service-account JSON in the repository or frontend bundle.
- Restrict Firebase Authentication authorized domains to the required app domains.
- Use least-privilege Firestore Rules and test them with the Firestore emulator.
- Minimize personal data stored for players; define required fields before implementation.
- Monitor Spark quotas in the Firebase console. If a quota is exceeded, service availability may be limited; do not introduce billing as an automatic remedy.

## 9. Quality gates
For each implementation milestone:
- Format/lint and strict TypeScript checks
- Unit tests for domain rules and import validation
- Firestore Rules emulator tests for workspace isolation and permissions
- Production Angular build
- PWA manifest/service-worker verification
- GitHub Actions CI result inspection

A check is considered passed only after it has actually run and its result has been inspected.