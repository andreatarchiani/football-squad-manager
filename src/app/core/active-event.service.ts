import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { FIRESTORE_DB } from './firebase.tokens';
import { FirebaseAuthService } from './firebase-auth.service';
import { invalidateData } from './data-cache';
import { CalendarService, emptyEvent, eventTitle, type CalendarData } from '../features/calendar/calendar.service';

/**
 * The event (championship, season, tournament…) everything in the app belongs to.
 *
 * The user picks it at the top of every screen; teams, players, officials,
 * calendar and call-ups all show only what belongs to the selected event.
 * Data created before events existed is assigned automatically:
 * every team with its squad becomes the event of the same id, officials go to the first event.
 */
@Injectable({ providedIn: 'root' })
export class ActiveEventService {
  private readonly auth = inject(FirebaseAuthService);
  private readonly calendars = inject(CalendarService);
  private readonly db = inject(FIRESTORE_DB, { optional: true });

  readonly events = signal<CalendarData[]>([]);
  private readonly selected = signal('');
  /** The chosen event, or the first one when nothing was chosen (or it was deleted). */
  readonly activeId = computed(() => {
    const id = this.selected();
    return this.events().some(event => event.id === id) ? id : (this.events()[0]?.id ?? '');
  });
  readonly active = computed(() => this.events().find(event => event.id === this.activeId()) ?? null);
  activeTitleOf(event: CalendarData): string { return eventTitle(event); }
  readonly firstId = computed(() => this.events()[0]?.id ?? '');
  readonly activeTitle = computed(() => { const event = this.active(); return event ? eventTitle(event) : ''; });

  private resolveReady!: () => void;
  private readonly readyPromise = new Promise<void>(resolve => { this.resolveReady = resolve; });
  private loadedFor = '';

  constructor() {
    effect(() => {
      const workspaceId = this.auth.workspaceId();
      if (workspaceId && workspaceId !== this.loadedFor) { this.loadedFor = workspaceId; void this.refresh(); }
    });
  }

  /** Resolves when the list of events has been loaded (and old data migrated). */
  /** Never waits more than 10 seconds, so a screen can't stay blank because of a slow connection. */
  whenReady(): Promise<void> { return Promise.race([this.readyPromise, new Promise<void>(resolve => setTimeout(resolve, 10000))]); }

  /** Event that owns a team: new teams carry the id, old ones use their own id. */
  eventOfTeam(team: { id: string; eventId?: string }): string { return team.eventId || team.id; }

  /** Makes another event the current one. Everything on screen reloads. */
  select(id: string): void {
    if (id === this.activeId()) return;
    this.selected.set(id);
    try { localStorage.setItem(this.storageKey(), id); } catch { /* storage unavailable */ }
    invalidateData();
  }

  async refresh(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    // Events and teams are downloaded together; a failed attempt is retried instead of leaving the app empty.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const [loaded, teamDocs] = await Promise.all([
          this.calendars.loadAll(workspaceId),
          this.db ? getDocs(collection(this.db, 'workspaces', workspaceId, 'teams')) : Promise.resolve(null)
        ]);
        let events = loaded;
        if (teamDocs) events = await this.migrateTeams(workspaceId, events, teamDocs.docs);
        try { this.selected.set(localStorage.getItem(this.storageKey()) ?? ''); } catch { /* storage unavailable */ }
        this.events.set(events);
        break;
      } catch (error) {
        console.error('Unable to load the events.', error);
        await new Promise(resolve => setTimeout(resolve, 700 * (attempt + 1)));
      }
    }
    this.resolveReady();
  }

  /** Reloads only the list of events (after creating, editing or deleting one). */
  async reload(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.events.set(await this.calendars.loadAll(workspaceId));
    invalidateData();
  }

  /** Teams made before events existed get an event of their own (same id), once. */
  private async migrateTeams(workspaceId: string, events: CalendarData[], teamDocs: { id: string; data(): Record<string, unknown> }[]): Promise<CalendarData[]> {
    if (!this.db) return events;
    const known = new Set(events.map(event => event.id));
    const missing = teamDocs.filter(item => !item.data()['isArchived'] && !item.data()['eventId'] && !known.has(item.id));
    if (!missing.length) return events;
    await Promise.all(missing.map(item => {
      const data = item.data();
      const details = { ...emptyEvent(), name: `${data['category'] || 'Campionato'} · ${data['name'] ?? ''}`.trim(), category: String(data['category'] ?? '') };
      return setDoc(doc(this.db!, 'workspaces', workspaceId, 'calendars', item.id), { teamId: item.id, teamName: String(data['name'] ?? ''), groupName: '', event: details, rounds: [] }, { merge: true });
    }));
    return this.calendars.loadAll(workspaceId);
  }

  private storageKey(): string { return `fsm-active-event:${this.auth.workspaceId() ?? ''}`; }
}
