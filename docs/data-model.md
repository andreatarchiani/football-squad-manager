# Firestore data model

This document defines the first implementation contract for Firestore. All application data is scoped to a workspace. The initial UI may create one personal workspace, but no collection should assume that a user can belong to only one workspace.

## Conventions

- Use Firestore document IDs for stable identifiers; never use player names as IDs.
- Store timestamps as Firestore Timestamps and write them with server timestamps.
- Store `createdAt` and `updatedAt` on mutable domain records.
- Keep personal data to the minimum required by the team manager.
- Do not duplicate derived counts or labels unless a measured query requirement justifies it.
- All reads and writes must be checked against workspace membership in Security Rules.

## Collections

```text
workspaces/{workspaceId}
  members/{uid}
  teams/{teamId}
    seasons/{seasonId}
      squadMembers/{playerId}
      jerseyReservations/{shirtNumber}
  players/{playerId}
  formations/{formationId}
  matches/{matchId}
    selections/{playerId}
  activity/{activityId}
```

### Workspace

`workspaces/{workspaceId}`

| Field | Type | Notes |
|---|---|---|
| name | string | Required, trimmed |
| ownerId | string | UID of creator |
| createdAt | timestamp | Server timestamp |
| updatedAt | timestamp | Server timestamp |

Membership document ID is the Firebase Auth UID.

`members/{uid}`: `role` (owner/admin/editor/viewer), `status` (active/invited/disabled), `displayName` (optional), `createdAt`, `updatedAt`. Membership status and role are security-sensitive and cannot be changed by an ordinary member.

### Teams and seasons

`teams/{teamId}`: `name`, `category` (optional), `clubName` (optional), `color` (optional), `isArchived`, timestamps.

`teams/{teamId}/seasons/{seasonId}`: `label` (for example 2026/2027), `startsOn` and `endsOn` (date strings), `status` (planned/active/closed), timestamps.

A season is the boundary for squad membership and shirt-number allocation. This allows a player to use a different number in a later season without corrupting historical records.

### Players and squad membership

`players/{playerId}` is the workspace-level person record: `firstName`, `lastName`, optional `dateOfBirth`, optional `preferredFoot`, optional `primaryRole`, optional `notes`, `isArchived`, timestamps. Avoid collecting sensitive or unnecessary personal data.

`seasons/{seasonId}/squadMembers/{playerId}`: `playerId`, `shirtNumber` (integer within the configured range), `roles` (array of allowed football roles), `status` (active/injured/suspended/left), optional `joinedAt`, timestamps.

The squad membership document ID is the player ID, preventing duplicate membership for the same player in a team season.

### Unique shirt numbers

Firestore does not provide unique constraints. Enforce uniqueness for a team season with a reservation document:

`seasons/{seasonId}/jerseyReservations/{shirtNumber}`

The document ID is the canonical decimal shirt number (for example `7`); its fields are `playerId`, `createdAt`, and `updatedAt`.

Every assignment/change must run in one Firestore transaction:
1. Read the target reservation and current squad membership.
2. Reject if the target number is reserved by another player.
3. Write/update the reservation and squad membership atomically.
4. If changing number, delete the previous reservation only when it belongs to the same player.
5. On removal/transfer, release the reservation in the same transaction.

Client-side duplicate detection is only a convenience. The transaction and Security Rules are the enforcement boundary. Rules must prevent clients from claiming a reservation for a different player or mutating another player's membership. If Rules cannot safely validate a multi-document invariant, move that operation behind a trusted backend only if it can be deployed without violating the Spark-only constraint; otherwise redesign the write protocol before release.

### Formations

`formations/{formationId}`: `name`, `shape` (for example 4-3-3), `positions` (bounded array of position definitions with stable keys and normalized coordinates), optional `description`, timestamps.

A saved formation is a reusable template. Player selections belong to a match, not to the template.

### Matches and selections

`matches/{matchId}`: `seasonId`, `opponentName`, `homeAway`, `kickoffAt` (timestamp), `venue` (optional), `competition` (optional), `status` (planned/played/postponed/cancelled), optional `scoreFor` and `scoreAgainst`, optional `formationId`, timestamps.

`matches/{matchId}/selections/{playerId}`: `playerId`, optional `shirtNumberSnapshot`, optional `positionKey`, `selectionType` (starter/substitute), `sortOrder`, timestamps.

Store a shirt-number snapshot on match selection so historical match sheets remain accurate if a player changes number in a future season.

### Activity log

`activity/{activityId}`: `actorUid`, `action`, `entityType`, `entityId`, `summary`, `createdAt`. Treat this as append-only from the client. Do not store secrets or full spreadsheet contents in activity entries.

## Authorization matrix

| Role | Read workspace data | Manage teams/players/matches | Manage members/roles | Delete workspace |
|---|---:|---:|---:|---:|
| owner | Yes | Yes | Yes | Yes, with explicit flow |
| admin | Yes | Yes | Invite/remove non-owners | No |
| editor | Yes | Yes | No | No |
| viewer | Yes | No | No | No |

Security Rules must default-deny, verify active membership, validate allowed fields and types, and prevent users from self-assigning privileged roles. UI route guards are not authorization.

## Query and index notes

Create composite indexes only when an implemented query requires them. Likely candidates include matches by `seasonId + kickoffAt`, and squad members by `status + shirtNumber`. Avoid speculative indexes.

## Open decisions before implementation

- Confirm the shirt-number range (recommended default 1–99, configurable only if a real use case requires it).
- Confirm the list of player roles and whether a player may have multiple roles.
- Confirm whether the same player can belong to multiple teams in one workspace during the same season.
- Decide which player fields are mandatory for the Excel import template.
