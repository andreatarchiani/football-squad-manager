import { Injectable, inject } from '@angular/core';
import {
  collection,
  doc,
  deleteDoc,
  getDoc,
  getDocs,
  serverTimestamp,
  setDoc,
  updateDoc,
  writeBatch,
  type Firestore
} from 'firebase/firestore';
import { FIRESTORE_DB } from '../../core/firebase.tokens';

export interface TeamRecord {
  id: string;
  name: string;
  category: string;
  clubName: string;
  isArchived: boolean;
  seasonId: string | null;
  seasonLabel: string;
  seasonStatus: string;
}

export interface TacticalLayout {
  formation: string;
  lineup: Record<string, string>;
  shirtPositions: Record<string, { x: number; y: number }>;
}

export interface LiveMatchState {
  elapsedSeconds: number;
  running: boolean;
  finished: boolean;
  events: { type: 'goal' | 'yellow-card' | 'red-card' | 'substitution' | 'formation'; minute: number; description: string; playerId?: string; outgoingId?: string; incomingId?: string }[];
  goals: Record<string, number>;
  assists: Record<string, number>;
  yellowCards: Record<string, number>;
  redCards: string[];
  lineup: Record<string, string>;
  formation: string;
  positions: Record<string, { x: number; y: number }>;
  changesUsed: number;
}

export interface TeamInput {
  name: string;
  category: string;
  clubName: string;
  seasonLabel: string;
}

@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly firestore = inject(FIRESTORE_DB, { optional: true });

  async list(workspaceId: string): Promise<TeamRecord[]> {
    const db = this.requireFirestore();
    const teamsSnapshot = await getDocs(collection(db, 'workspaces', workspaceId, 'teams'));
    const teams = await Promise.all(teamsSnapshot.docs.map(async (teamSnapshot) => {
      const data = teamSnapshot.data();
      const seasonsSnapshot = await getDocs(collection(
        db, 'workspaces', workspaceId, 'teams', teamSnapshot.id, 'seasons'
      ));
      const season = seasonsSnapshot.docs.find((item) => item.data()['status'] === 'active')
        ?? seasonsSnapshot.docs[0];
      const seasonData = season?.data();

      return {
        id: teamSnapshot.id,
        name: String(data['name'] ?? ''),
        category: String(data['category'] ?? ''),
        clubName: String(data['clubName'] ?? ''),
        isArchived: data['isArchived'] === true,
        seasonId: season?.id ?? null,
        seasonLabel: String(seasonData?.['label'] ?? ''),
        seasonStatus: String(seasonData?.['status'] ?? '')
      } satisfies TeamRecord;
    }));

    return teams.sort((a, b) => Number(a.isArchived) - Number(b.isArchived)
      || a.name.localeCompare(b.name, 'it'));
  }

  async loadTacticalLayout(workspaceId: string, teamId: string, seasonId: string): Promise<TacticalLayout | null> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId,
      'seasons', seasonId, 'settings', 'tactical-layout');
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
      formation: String(data['formation'] ?? '4-3-3'),
      lineup: (data['lineup'] ?? {}) as Record<string, string>,
      shirtPositions: (data['shirtPositions'] ?? {}) as Record<string, { x: number; y: number }>
    };
  }

  async saveTacticalLayout(workspaceId: string, teamId: string, seasonId: string, layout: TacticalLayout): Promise<void> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId,
      'seasons', seasonId, 'settings', 'tactical-layout');
    await setDoc(ref, { ...layout, updatedAt: serverTimestamp() });
  }

  async loadLiveMatch(workspaceId: string, teamId: string, seasonId: string): Promise<LiveMatchState | null> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId, 'seasons', seasonId, 'settings', 'live-match');
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
      elapsedSeconds: Number(data['elapsedSeconds'] ?? 0), running: data['running'] === true,
      finished: data['finished'] === true, events: (data['events'] ?? []) as LiveMatchState['events'],
      goals: (data['goals'] ?? {}) as Record<string, number>, assists: (data['assists'] ?? {}) as Record<string, number>,
      yellowCards: (data['yellowCards'] ?? {}) as Record<string, number>, redCards: (data['redCards'] ?? []) as string[],
      lineup: (data['lineup'] ?? {}) as Record<string, string>, formation: String(data['formation'] ?? '4-3-3'),
      positions: (data['positions'] ?? {}) as Record<string, { x: number; y: number }>, changesUsed: Number(data['changesUsed'] ?? 0)
    };
  }

  async clearLiveMatch(workspaceId: string, teamId: string, seasonId: string): Promise<void> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId, 'seasons', seasonId, 'settings', 'live-match');
    await deleteDoc(ref);
  }

  async saveLiveMatch(workspaceId: string, teamId: string, seasonId: string, state: LiveMatchState): Promise<void> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId, 'seasons', seasonId, 'settings', 'live-match');
    await setDoc(ref, { ...state, updatedAt: serverTimestamp() });
  }

  async create(workspaceId: string, input: TeamInput): Promise<void> {
    const db = this.requireFirestore();
    const teamRef = doc(collection(db, 'workspaces', workspaceId, 'teams'));
    const seasonRef = doc(collection(db, 'workspaces', workspaceId, 'teams', teamRef.id, 'seasons'));
    const now = serverTimestamp();
    const batch = writeBatch(db);

    batch.set(teamRef, {
      name: input.name.trim(),
      category: input.category.trim(),
      clubName: input.clubName.trim(),
      isArchived: false,
      createdAt: now,
      updatedAt: now
    });
    batch.set(seasonRef, {
      label: input.seasonLabel.trim(),
      ...this.seasonDates(input.seasonLabel),
      status: 'active',
      createdAt: now,
      updatedAt: now
    });

    await batch.commit();
  }

  async update(workspaceId: string, team: TeamRecord, input: TeamInput): Promise<void> {
    const db = this.requireFirestore();
    const teamRef = doc(db, 'workspaces', workspaceId, 'teams', team.id);
    const batch = writeBatch(db);
    batch.update(teamRef, {
      name: input.name.trim(),
      category: input.category.trim(),
      clubName: input.clubName.trim(),
      updatedAt: serverTimestamp()
    });

    if (team.seasonId) {
      batch.update(doc(teamRef, 'seasons', team.seasonId), {
        label: input.seasonLabel.trim(),
        ...this.seasonDates(input.seasonLabel),
        updatedAt: serverTimestamp()
      });
    }
    await batch.commit();
  }

  async setArchived(workspaceId: string, team: TeamRecord, archived: boolean): Promise<void> {
    await updateDoc(doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', team.id), {
      isArchived: archived,
      updatedAt: serverTimestamp()
    });
  }

  private seasonDates(label: string): { startsOn: string; endsOn: string } {
    const match = /^(\d{4})\s*[/\-]\s*(\d{4})$/.exec(label.trim());
    if (!match) {
      return { startsOn: '', endsOn: '' };
    }
    return { startsOn: `${match[1]}-07-01`, endsOn: `${match[2]}-06-30` };
  }

  private requireFirestore(): Firestore {
    if (!this.firestore) {
      throw new Error('Firestore non è configurato.');
    }
    return this.firestore;
  }
}
