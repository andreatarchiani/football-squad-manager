import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  serverTimestamp,
  setDoc,
  writeBatch
} from 'firebase/firestore';

const projectId = 'demo-football-squad-manager';
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
const testEnv = await initializeTestEnvironment({
  projectId,
  firestore: { rules }
});

const timestamp = () => serverTimestamp();

try {
  // A new user must create the workspace, owner membership and profile atomically.
  const ownerDb = testEnv.authenticatedContext('owner-1').firestore();
  const bootstrap = writeBatch(ownerDb);
  bootstrap.set(doc(ownerDb, 'workspaces', 'workspace-1'), {
    name: 'Club test',
    ownerId: 'owner-1',
    createdAt: timestamp(),
    updatedAt: timestamp()
  });
  bootstrap.set(doc(ownerDb, 'workspaces', 'workspace-1', 'members', 'owner-1'), {
    role: 'owner',
    status: 'active',
    displayName: 'Owner',
    createdAt: timestamp(),
    updatedAt: timestamp()
  });
  bootstrap.set(doc(ownerDb, 'userProfiles', 'owner-1'), {
    defaultWorkspaceId: 'workspace-1',
    displayName: 'Owner',
    email: 'owner@example.test',
    createdAt: timestamp(),
    updatedAt: timestamp()
  });
  await assertSucceeds(bootstrap.commit());
  await assertSucceeds(getDoc(doc(ownerDb, 'workspaces', 'workspace-1')));
  await assertSucceeds(setDoc(doc(ownerDb, 'userProfiles', 'owner-1'), {\n    accountRole: 'Allenatore', defaultTeamId: 'team-1', updatedAt: timestamp()
  }, { merge: true }));
  await assertSucceeds(setDoc(doc(ownerDb, 'workspaces', 'workspace-1', 'teams', 'team-1'), {
    name: 'Prima squadra', category: 'Senior', clubName: 'Club test', isArchived: false,
    createdAt: timestamp(), updatedAt: timestamp()
  }));
  await assertSucceeds(setDoc(doc(ownerDb, 'workspaces', 'workspace-1', 'teams', 'team-1', 'seasons', 'season-1'), {
    label: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', status: 'active',
    createdAt: timestamp(), updatedAt: timestamp()
  }));

  // Users without an active membership cannot read workspace data.
  const outsiderDb = testEnv.authenticatedContext('outsider').firestore();
  await assertFails(getDoc(doc(outsiderDb, 'workspaces', 'workspace-1')));

  // Seed a viewer membership as trusted test setup, not through client rules.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'workspaces', 'workspace-viewer'), {
      name: 'Viewer club',
      ownerId: 'owner-seed',
      createdAt: timestamp(),
      updatedAt: timestamp()
    });
    await setDoc(doc(adminDb, 'workspaces', 'workspace-viewer', 'members', 'owner-seed'), {
      role: 'owner',
      status: 'active',
      createdAt: timestamp(),
      updatedAt: timestamp()
    });
    await setDoc(doc(adminDb, 'workspaces', 'workspace-viewer', 'members', 'viewer-1'), {
      role: 'viewer',
      status: 'active',
      createdAt: timestamp(),
      updatedAt: timestamp()
    });
  });

  const viewerDb = testEnv.authenticatedContext('viewer-1').firestore();
  await assertSucceeds(getDoc(doc(viewerDb, 'workspaces', 'workspace-viewer')));
  await assertFails(setDoc(doc(viewerDb, 'workspaces', 'workspace-viewer', 'teams', 'blocked-team'), {
    name: 'Should not be writable'
  }));
  await assertFails(setDoc(doc(viewerDb, 'workspaces', 'workspace-viewer', 'teams', 'team-1', 'seasons', 'season-1'), {
    label: '2026/2027', status: 'active'
  }));

  // A member cannot create another owner's membership or grant themselves ownership.
  await assertFails(setDoc(doc(viewerDb, 'workspaces', 'workspace-viewer', 'members', 'attacker'), {
    role: 'owner',
    status: 'active',
    createdAt: timestamp(),
    updatedAt: timestamp()
  }));

  // Activity records are append-only.
  await testEnv.withSecurityRulesDisabled(async (context) => {
    await setDoc(doc(context.firestore(), 'workspaces', 'workspace-viewer', 'activity', 'event-1'), {
      actorUid: 'owner-seed',
      action: 'created',
      entityType: 'team',
      entityId: 'team-1',
      summary: 'Created team',
      createdAt: timestamp()
    });
  });
  await assertFails(setDoc(doc(viewerDb, 'workspaces', 'workspace-viewer', 'activity', 'event-1'), {
    actorUid: 'viewer-1',
    action: 'changed',
    entityType: 'team',
    entityId: 'team-1',
    summary: 'Attempted edit',
    createdAt: timestamp()
  }));

  process.stdout.write('Firestore Security Rules tests passed.\n');
} finally {
  await testEnv.cleanup();
}
