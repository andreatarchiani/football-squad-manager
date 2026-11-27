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
import { isMapsLink } from '../calendar/calendar.service';
import { cached, invalidateOnWrite } from '../../core/data-cache';
import { ActiveEventService } from '../../core/active-event.service';

export interface TeamRecord {
  id: string;
  eventId: string;
  name: string;
  category: string;
  facilityName: string;
  facilityAddress: string;
  facilityMapsUrl: string;
  headquartersAddress: string;
  federationNumber: string;
  outfieldPlayersCount: number | null;
  goalkeeperCount: number | null;
  periodCount: number | null;
  periodMinutes: number | null;
  playersOnField: number | null;
  playersOnRoster: number | null;
  maxSubstitutions: number | null;
  reentryAllowed: boolean;
  federationReportRequired: boolean;
  fixedPlayerCount: number | null;
  allPlayersMustPlay: boolean;
  icon: string;
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
  savedAtMs: number;
  running: boolean;
  finished: boolean;
  events: { type: 'goal' | 'opponent-goal' | 'key-pass' | 'yellow-card' | 'red-card' | 'substitution' | 'formation'; minute: number; description: string; playerId?: string; assistPlayerId?: string; outgoingId?: string; incomingId?: string }[];
  goals: Record<string, number>;
  opponentGoals?: number;
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
  facilityName: string;
  facilityAddress: string;
  facilityMapsUrl: string;
  headquartersAddress: string;
  federationNumber: string;
  outfieldPlayersCount: number | null;
  goalkeeperCount: number | null;
  periodCount: number | null;
  periodMinutes: number | null;
  playersOnField: number | null;
  playersOnRoster: number | null;
  maxSubstitutions: number | null;
  reentryAllowed: boolean;
  federationReportRequired: boolean;
  fixedPlayerCount: number | null;
  allPlayersMustPlay: boolean;
  icon: string;
  seasonLabel: string;
}

@Injectable({ providedIn: 'root' })
export class TeamService {
  private readonly firestore = inject(FIRESTORE_DB, { optional: true });

  private readonly events = inject(ActiveEventService);

  constructor() {
    invalidateOnWrite(this, ['saveTacticalLayout', 'saveCaptaincy', 'clearLiveMatch', 'create', 'update', 'deleteTeam', 'setArchived']);
  }

  /** Teams with their active season (cached for a short time, see data-cache). */
  async list(workspaceId: string): Promise<TeamRecord[]> {
    await this.events.whenReady();
    const eventId = this.events.activeId();
    const teams = await cached(`teams:${workspaceId}`, () => this.fetchList(workspaceId));
    return teams.filter(team => !eventId || this.events.eventOfTeam(team) === eventId).map(team => ({ ...team }));
  }

  /** Teams of every event (used to copy a squad from one event to another). */
  async listAll(workspaceId: string): Promise<TeamRecord[]> {
    const teams = await cached(`teams:${workspaceId}`, () => this.fetchList(workspaceId));
    return teams.map(team => ({ ...team }));
  }

  private async fetchList(workspaceId: string): Promise<TeamRecord[]> {
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
        eventId: String(data['eventId'] ?? ''),
        name: String(data['name'] ?? ''),
        category: String(data['category'] ?? ''),
        facilityName: String(data['facilityName'] ?? ''),
        facilityAddress: String(data['facilityAddress'] ?? ''),
        facilityMapsUrl: String(data['facilityMapsUrl'] ?? ''),
        headquartersAddress: String(data['headquartersAddress'] ?? ''),
        federationNumber: String(data['federationNumber'] ?? ''),
        outfieldPlayersCount: data['outfieldPlayersCount'] == null ? null : Number(data['outfieldPlayersCount']),
        goalkeeperCount: data['goalkeeperCount'] == null ? null : Number(data['goalkeeperCount']),
        periodCount: data['periodCount'] == null ? null : Number(data['periodCount']),
        periodMinutes: data['periodMinutes'] == null ? null : Number(data['periodMinutes']),
        playersOnField: data['playersOnField'] == null ? null : Number(data['playersOnField']),
        playersOnRoster: data['playersOnRoster'] == null ? null : Number(data['playersOnRoster']),
        maxSubstitutions: data['maxSubstitutions'] == null ? null : Number(data['maxSubstitutions']),
        reentryAllowed: data['reentryAllowed'] === true,
        federationReportRequired: data['federationReportRequired'] === true,
        fixedPlayerCount: data['fixedPlayerCount'] == null ? null : Number(data['fixedPlayerCount']),
        allPlayersMustPlay: data['allPlayersMustPlay'] === true,
        icon: String(data['icon'] ?? '⚽'),
        isArchived: data['isArchived'] === true,
        seasonId: season?.id ?? null,
        seasonLabel: String(seasonData?.['label'] ?? ''),
        seasonStatus: String(seasonData?.['status'] ?? '')
      } satisfies TeamRecord;
    }));

    return teams.sort((a, b) => Number(a.isArchived) - Number(b.isArchived)
      || a.name.localeCompare(b.name, 'it'));
  }

  async loadTacticalLayout(workspaceId: string, teamId: string, seasonId: string, layoutSlot: 1 | 2 = 1): Promise<TacticalLayout | null> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId,
      'seasons', seasonId, 'settings', layoutSlot === 1 ? 'tactical-layout' : 'tactical-layout-2');
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
      formation: String(data['formation'] ?? '4-3-3'),
      lineup: (data['lineup'] ?? {}) as Record<string, string>,
      shirtPositions: (data['shirtPositions'] ?? {}) as Record<string, { x: number; y: number }>
    };
  }

  async saveTacticalLayout(workspaceId: string, teamId: string, seasonId: string, layout: TacticalLayout, layoutSlot: 1 | 2 = 1): Promise<void> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId,
      'seasons', seasonId, 'settings', layoutSlot === 1 ? 'tactical-layout' : 'tactical-layout-2');
    await setDoc(ref, { ...layout, updatedAt: serverTimestamp() });
  }

  async loadCaptaincy(workspaceId: string, teamId: string, seasonId: string): Promise<{ captainId: string; viceCaptainId: string; updatedAtMs: number }> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId, 'seasons', seasonId, 'settings', 'captaincy');
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return { captainId: '', viceCaptainId: '', updatedAtMs: 0 };
    const data = snapshot.data();
    const updatedAt = data['updatedAt'];
    const updatedAtMs = updatedAt && typeof updatedAt.toMillis === 'function' ? updatedAt.toMillis() : 0;
    return { captainId: String(data['captainId'] ?? ''), viceCaptainId: String(data['viceCaptainId'] ?? ''), updatedAtMs };
  }

  async saveCaptaincy(workspaceId: string, teamId: string, seasonId: string, captainId: string, viceCaptainId: string): Promise<void> {
    const db = this.requireFirestore();
    const members = await getDocs(collection(db, 'workspaces', workspaceId, 'teams', teamId, 'seasons', seasonId, 'squadMembers'));
    const batch = writeBatch(db);
    members.docs.forEach(member => batch.update(member.ref, {
      isCaptain: member.id === captainId,
      isViceCaptain: member.id === viceCaptainId,
      updatedAt: serverTimestamp()
    }));
    await batch.commit();
  }
  async loadLiveMatch(workspaceId: string, teamId: string, seasonId: string): Promise<LiveMatchState | null> {
    const ref = doc(this.requireFirestore(), 'workspaces', workspaceId, 'teams', teamId, 'seasons', seasonId, 'settings', 'live-match');
    const snapshot = await getDoc(ref);
    if (!snapshot.exists()) return null;
    const data = snapshot.data();
    return {
      elapsedSeconds: Number(data['elapsedSeconds'] ?? 0), savedAtMs: Number(data['savedAtMs'] ?? Date.now()), running: data['running'] === true,
      finished: data['finished'] === true, events: (data['events'] ?? []) as LiveMatchState['events'],
      goals: (data['goals'] ?? {}) as Record<string, number>, opponentGoals: Number(data['opponentGoals'] ?? 0), assists: (data['assists'] ?? {}) as Record<string, number>,
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

  async create(workspaceId: string, input: TeamInput): Promise<string> {
    const db = this.requireFirestore();
    const teamRef = doc(collection(db, 'workspaces', workspaceId, 'teams'));
    const seasonRef = doc(collection(db, 'workspaces', workspaceId, 'teams', teamRef.id, 'seasons'));
    const now = serverTimestamp();
    const batch = writeBatch(db);

    batch.set(teamRef, {
      eventId: this.events.activeId(),
      name: input.name.trim(),
      category: input.category.trim(),
      facilityName: input.facilityName.trim(),
      facilityAddress: input.facilityAddress.trim(),
      facilityMapsUrl: isMapsLink(input.facilityMapsUrl ?? '') ? input.facilityMapsUrl.trim().slice(0, 400) : '',
      headquartersAddress: input.headquartersAddress.trim(),
      federationNumber: input.federationNumber.trim(),
      outfieldPlayersCount: input.outfieldPlayersCount,
      goalkeeperCount: input.goalkeeperCount,
      periodCount: input.periodCount,
      periodMinutes: input.periodMinutes,
      playersOnField: input.playersOnField,
      playersOnRoster: input.playersOnRoster,
      maxSubstitutions: input.maxSubstitutions,
      reentryAllowed: input.reentryAllowed,
      federationReportRequired: input.federationReportRequired,
      fixedPlayerCount: input.fixedPlayerCount,
      allPlayersMustPlay: input.allPlayersMustPlay,
      icon: input.icon,
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
    return teamRef.id;
  }

  async update(workspaceId: string, team: TeamRecord, input: TeamInput): Promise<void> {
    const db = this.requireFirestore();
    const teamRef = doc(db, 'workspaces', workspaceId, 'teams', team.id);
    const batch = writeBatch(db);
    batch.update(teamRef, {
      name: input.name.trim(),
      category: input.category.trim(),
      facilityName: input.facilityName.trim(),
      facilityAddress: input.facilityAddress.trim(),
      facilityMapsUrl: isMapsLink(input.facilityMapsUrl ?? '') ? input.facilityMapsUrl.trim().slice(0, 400) : '',
      headquartersAddress: input.headquartersAddress.trim(),
      federationNumber: input.federationNumber.trim(),
      outfieldPlayersCount: input.outfieldPlayersCount,
      goalkeeperCount: input.goalkeeperCount,
      periodCount: input.periodCount,
      periodMinutes: input.periodMinutes,
      playersOnField: input.playersOnField,
      playersOnRoster: input.playersOnRoster,
      maxSubstitutions: input.maxSubstitutions,
      reentryAllowed: input.reentryAllowed,
      federationReportRequired: input.federationReportRequired,
      fixedPlayerCount: input.fixedPlayerCount,
      allPlayersMustPlay: input.allPlayersMustPlay,
      icon: input.icon,
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

  async deleteTeam(workspaceId: string, team: TeamRecord): Promise<void> {
    const db = this.requireFirestore();
    const teamRef = doc(db, 'workspaces', workspaceId, 'teams', team.id);
    const seasons = await getDocs(collection(teamRef, 'seasons'));
    const refs: ReturnType<typeof doc>[] = [];
    const playerIds = new Set<string>();

    for (const season of seasons.docs) {
      const seasonRef = doc(teamRef, 'seasons', season.id);
      const [members, reservations, settings] = await Promise.all([
        getDocs(collection(seasonRef, 'squadMembers')),
        getDocs(collection(seasonRef, 'jerseyReservations')),
        getDocs(collection(seasonRef, 'settings'))
      ]);
      members.docs.forEach(member => {
        playerIds.add(member.id);
        refs.push(member.ref);
      });
      reservations.docs.forEach(item => refs.push(item.ref));
      settings.docs.forEach(item => refs.push(item.ref));
      refs.push(seasonRef);
    }

    // Players belong to one team/season; remove their profile documents as part of
    // the team deletion so no orphaned players remain in the workspace.
    playerIds.forEach(playerId => refs.push(doc(db, 'workspaces', workspaceId, 'players', playerId)));
    refs.push(teamRef);

    for (let offset = 0; offset < refs.length; offset += 450) {
      const batch = writeBatch(db);
      refs.slice(offset, offset + 450).forEach(ref => batch.delete(ref));
      await batch.commit();
    }
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
