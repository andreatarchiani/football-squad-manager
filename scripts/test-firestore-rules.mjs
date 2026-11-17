import { readFile } from 'node:fs/promises';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment
} from '@firebase/rules-unit-testing';
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  orderBy,
  updateDoc,
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
  await assertSucceeds(setDoc(doc(ownerDb, 'userProfiles', 'owner-1'), {
    accountRole: 'Allenatore', defaultTeamId: 'team-1', updatedAt: timestamp()
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


  // A coach can create a ticket, but cannot list others' tickets or change statuses.
  const reporterDb = testEnv.authenticatedContext('reporter-1', { email: 'coach@example.test' }).firestore();
  const supportDb = testEnv.authenticatedContext('support-1', { email: 'squadmanagersupport@gmail.com' }).firestore();
  const impostorDb = testEnv.authenticatedContext('impostor-1', { email: 'impostor@example.test' }).firestore();
  const ticketRef = doc(reporterDb, 'supportTickets', 'ticket-1');
  const ticket = {
    authorUid: 'reporter-1',
    authorEmail: 'coach@example.test',
    authorName: 'Coach',
    description: 'Il timer non avanza',
    page: 'match',
    browser: 'Firefox',
    status: 'new',
    createdAt: timestamp(),
    updatedAt: timestamp()
  };
  await assertSucceeds(setDoc(ticketRef, ticket));
  await assertFails(setDoc(doc(impostorDb, 'supportTickets', 'spoofed'), {
    ...ticket, authorUid: 'support-1'
  }));
  await assertFails(setDoc(doc(impostorDb, 'supportTickets', 'oversized'), {
    ...ticket, authorUid: 'impostor-1', authorEmail: 'impostor@example.test',
    description: 'x'.repeat(2001)
  }));
  await assertFails(getDocs(query(collection(reporterDb, 'supportTickets'), orderBy('createdAt', 'desc'))));
  await assertFails(getDocs(query(collection(impostorDb, 'supportTickets'), orderBy('createdAt', 'desc'))));
  await assertFails(getDoc(doc(impostorDb, 'supportTickets', 'ticket-1')));
  await assertSucceeds(getDoc(ticketRef));
  await assertSucceeds(getDocs(query(collection(supportDb, 'supportTickets'), orderBy('createdAt', 'desc'))));
  await assertFails(updateDoc(ticketRef, { status: 'resolved', updatedAt: timestamp() }));
  await assertSucceeds(updateDoc(doc(supportDb, 'supportTickets', 'ticket-1'), { status: 'progress', updatedAt: timestamp() }));
  await assertFails(updateDoc(doc(supportDb, 'supportTickets', 'ticket-1'), { description: 'tampered', updatedAt: timestamp() }));
  await assertFails(updateDoc(doc(supportDb, 'supportTickets', 'ticket-1'), { status: 'invalid', updatedAt: timestamp() }));

  process.stdout.write('Firestore Security Rules tests passed.\n');
} finally {
  await testEnv.cleanup();
}
