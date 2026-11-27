import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { prepareIconImage } from '../../core/icon-image';
import { NotificationService } from '../../core/notifications/notification.service';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { CalendarService, coordinatesFromLink, isMapsLink, mapsLink, buildReturnLeg, duplicateDates, emptyCalendar, findNextMatch, emptyGroupTeam, type CalendarData, type CalendarRound, type GroupTeam } from './calendar.service';

type Leg = 'A' | 'R';

@Component({
  selector: 'fsm-calendar-page',
  standalone: true,
  imports: [NgTemplateOutlet],
  templateUrl: './calendar-page.component.html',
  styleUrl: './calendar-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CalendarPageComponent implements OnDestroy {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamService = inject(TeamService);
  private readonly service = inject(CalendarService);
  private readonly notifications = inject(NotificationService);

  protected readonly teams = signal<TeamRecord[]>([]);
  protected readonly teamId = signal('');
  protected readonly teamMenuOpen = signal(false);
  protected readonly calendar = signal<CalendarData>(emptyCalendar());
  protected readonly loading = signal(true);
  protected readonly saveState = signal<'idle' | 'pending' | 'saving' | 'saved' | 'error'>('idle');
  protected readonly error = signal('');

  protected readonly team = computed(() => this.teams().find(team => team.id === this.teamId()));
  /** Teams of the group: my team plus the teams created in the group list. */
  protected readonly groupTeams = computed(() => {
    const names = [...this.calendar().groupTeams.map(team => team.name)];
    const mine = this.team()?.name;
    return mine ? [mine, ...names.filter(name => name.toLowerCase() !== mine.toLowerCase())] : names;
  });
  /** Opponents already used in the first leg (each team is met once). */
  private readonly usedOpponents = computed(() => this.calendar().andata.map(round => round.opponent.trim().toLowerCase()));
  /** Next match: the closest date from today (no need to choose it). */
  protected readonly nextMatch = computed(() => findNextMatch(this.calendar()));
  protected readonly conflicts = computed(() => duplicateDates(this.calendar()));
  protected readonly conflictRounds = computed(() => {
    const dates = this.conflicts();
    return [...this.calendar().andata, ...this.calendar().ritorno].filter(round => round.date && dates.has(round.date)).map(round => round.number);
  });
  protected readonly missingReturnDates = computed(() => this.calendar().ritorno.filter(round => !round.date).length);

  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private saveChain: Promise<void> = Promise.resolve();

  constructor() { effect(() => { if (this.auth.workspaceId()) void this.loadTeams(); }); }

  ngOnDestroy(): void { if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; void this.saveNow(); } }

  /* ------------------------------------------------------------ team */
  protected async selectTeam(id: string): Promise<void> {
    this.teamMenuOpen.set(false);
    if (id === this.teamId()) return;
    await this.flush();
    this.teamId.set(id);
    await this.loadCalendar();
  }

  /* ------------------------------------------------------- andata edits */
  protected addRound(): void {
    this.updateAndata(andata => [...andata, { number: andata.length + 1, leg: 'A', opponent: '', home: andata.length % 2 === 0, date: '', time: andata.at(-1)?.time ?? '', venue: '' }]);
  }

  protected removeRound(index: number): void {
    this.updateAndata(andata => andata.filter((_, i) => i !== index).map((round, i) => ({ ...round, number: i + 1 })));
  }

  protected readonly opponentMenu = signal(-1);
  protected toggleOpponentMenu(index: number): void { this.opponentMenu.update(open => open === index ? -1 : index); }
  protected pickOpponent(index: number, name: string): void { this.opponentMenu.set(-1); this.setOpponent(index, name); }

  protected swap(index: number): void {
    this.updateAndata(andata => andata.map((round, i) => i === index ? { ...round, home: !round.home } : round));
  }

  /** Teams that can still be chosen in this round: not mine, not already picked in another round. */
  protected availableTeams(index: number): GroupTeam[] {
    const used = this.usedOpponents();
    const mine = this.team()?.name.toLowerCase();
    return this.calendar().groupTeams.filter(team => {
      const name = team.name.toLowerCase();
      return name !== mine && (!used.includes(name) || used[index] === name);
    });
  }

  /* ------------------------------------------- squadre del girone */
  protected readonly teamEditor = signal<GroupTeam | null>(null);
  private readonly originalName = signal('');
  protected readonly teamEditorOriginal = this.originalName.asReadonly();
  protected readonly teamEditorValid = computed(() => {
    const draft = this.teamEditor();
    if (!draft || !draft.name.trim()) return false;
    const name = draft.name.trim().toLowerCase();
    return name !== this.team()?.name.toLowerCase() && !this.calendar().groupTeams.some(team => team.id !== draft.id && team.name.toLowerCase() === name);
  });
  protected readonly teamEditorError = computed(() => {
    const draft = this.teamEditor();
    if (!draft?.name.trim()) return '';
    return this.teamEditorValid() ? '' : 'Esiste già una squadra con questo nome nel girone.';
  });

  protected readonly teamIcons = ['⚽', '🛡️', '🏆', '⭐', '👑', '🦅', '🦁', '🐺', '🐉', '🔥', '⚡', '💎', '🏟️', '🎯', '🔱', '🌟'];
  protected isImage(value: string | null | undefined): boolean { return typeof value === 'string' && value.startsWith('data:image/'); }
  protected async uploadTeamIcon(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) { if (file) this.notifications.notify({ title: 'Immagine non valida', message: 'Scegli un’immagine PNG, JPG o WebP sotto gli 8 MB.', type: 'warning' }); return; }
    try { this.setTeamField('icon', await prepareIconImage(file)); }
    catch { this.notifications.notify({ title: 'Logo non caricato', message: 'Prova con un file PNG, JPG o WebP.', type: 'warning' }); }
  }
  /** Logo of a team of the group (mine included): emoji, image or empty. */
  protected iconOf(name: string): string {
    return this.isMine(name) ? (this.team()?.icon ?? '') : (this.groupTeamByName(name)?.icon ?? '');
  }

  protected newGroupTeam(): void { this.originalName.set(''); this.teamEditor.set({ ...emptyGroupTeam(), id: `t-${Date.now().toString(36)}` }); }
  protected editGroupTeam(id: string): void {
    const team = this.calendar().groupTeams.find(item => item.id === id);
    if (team) { this.originalName.set(team.name); this.teamEditor.set({ ...team }); }
  }
  protected setTeamField(key: keyof GroupTeam, value: string): void { this.teamEditor.update(draft => draft ? { ...draft, [key]: value } : draft); }
  protected closeTeamEditor(): void { this.teamEditor.set(null); }

  protected saveGroupTeam(): void {
    const draft = this.teamEditor();
    if (!draft || !this.teamEditorValid()) return;
    const team = { ...draft, name: draft.name.trim(), mapsUrl: isMapsLink(draft.mapsUrl) ? draft.mapsUrl.trim() : '' };
    const old = this.originalName();
    this.calendar.update(data => {
      const exists = data.groupTeams.some(item => item.id === team.id);
      const groupTeams = exists ? data.groupTeams.map(item => item.id === team.id ? team : item) : [...data.groupTeams, team];
      // A renamed team keeps its rounds.
      const rename = (round: CalendarRound) => old && round.opponent === old ? { ...round, opponent: team.name } : round;
      const andata = data.andata.map(rename);
      return { ...data, groupTeams, andata, ritorno: buildReturnLeg(andata, data.ritorno.map(rename)) };
    });
    this.teamEditor.set(null);
    this.scheduleSave();
  }

  protected removeGroupTeam(): void {
    const draft = this.teamEditor();
    if (!draft || this.isTeamUsed(draft.name)) return;
    this.calendar.update(data => ({ ...data, groupTeams: data.groupTeams.filter(team => team.id !== draft.id) }));
    this.teamEditor.set(null);
    this.scheduleSave();
  }

  protected isTeamUsed(name: string): boolean { return this.usedOpponents().includes(name.trim().toLowerCase()); }
  protected groupTeamByName(name: string): GroupTeam | undefined { return this.calendar().groupTeams.find(team => team.name.toLowerCase() === name.trim().toLowerCase()); }
  protected groupTeamOf(id: string): GroupTeam | undefined { return this.calendar().groupTeams.find(team => team.id === id); }

  protected setOpponent(index: number, value: string): void {
    this.updateAndata(andata => andata.map((round, i) => i === index ? { ...round, opponent: value } : round));
  }

  protected setGroupName(value: string): void { this.calendar.update(data => ({ ...data, groupName: value })); this.scheduleSave(); }

  protected setWhen(leg: Leg, index: number, key: 'date' | 'time', value: string): void {
    // Called on change and on blur: ignore repeats so nothing is saved or announced twice.
    const current = this.rows(leg)[index];
    if (!current || current[key] === value) return;
    this.editRound(leg, index, round => key === 'date' ? { ...round, date: value } : { ...round, time: value });
    if (key === 'date' && value && this.conflicts().has(value)) {
      const mine = this.rows(leg)[index]?.number;
      const others = this.conflictRounds().filter(number => number !== mine);
      this.notifications.notify({ title: 'Due partite nello stesso giorno', message: `Il ${this.shortDate(value)} c’è già la giornata ${others.join(', ')}. La squadra non può giocare due volte lo stesso giorno: controlla le date.`, type: 'warning', durationMs: 8000 });
    }
  }

  /* ------------------------------------------- campo della trasferta */
  protected readonly venueEditor = signal<{ leg: Leg; index: number; round: CalendarRound } | null>(null);
  protected readonly draftLink = signal('');
  protected readonly draftName = signal('');
  protected readonly draftLinkValid = computed(() => isMapsLink(this.draftLink()));

  protected openVenueEditor(leg: Leg, index: number): void {
    const round = this.rows(leg)[index];
    if (!round) return;
    this.draftLink.set(round.venueUrl ?? '');
    this.draftName.set(round.venue ?? '');
    this.venueEditor.set({ leg, index, round });
  }

  protected closeVenueEditor(): void { this.venueEditor.set(null); }

  /** "Incolla": reads the link copied in Maps. */
  protected async pasteDraftLink(): Promise<void> {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      this.draftLink.set(/https?:\/\/\S+/.exec(text)?.[0] ?? text);
    } catch {
      this.notifications.notify({ title: 'Incolla a mano', message: 'Tieni premuto nella casella del link e scegli Incolla.', type: 'info', durationMs: 6000 });
    }
  }

  protected saveVenue(): void {
    const editor = this.venueEditor();
    if (!editor) return;
    const link = this.draftLinkValid() ? this.draftLink() : '';
    const point = link ? coordinatesFromLink(link) : null;
    const name = this.draftName().trim();
    this.editRound(editor.leg, editor.index, round => ({ ...round, venue: name, venueUrl: link, venueLat: point?.lat ?? null, venueLon: point?.lon ?? null }));
    this.venueEditor.set(null);
  }

  protected removeVenue(): void {
    const editor = this.venueEditor();
    if (!editor) return;
    this.editRound(editor.leg, editor.index, round => ({ ...round, venue: '', venueUrl: '', venueLat: null, venueLon: null }));
    this.venueEditor.set(null);
  }

  /** Opens Maps to look for the pitch (typed text, or the opponent's sports ground). */
  protected searchOnMaps(round: CalendarRound): string {
    const text = round.venue.trim() || `campo sportivo ${round.opponent}`.trim();
    return mapsLink(text);
  }

  protected mapsUrl(round: CalendarRound): string | null {
    if (round.home) { const team = this.team(); if (team?.facilityMapsUrl) return team.facilityMapsUrl; const address = [team?.facilityName, team?.facilityAddress].filter(Boolean).join(', '); return team?.facilityAddress ? mapsLink(address) : null; }
    if (round.venueUrl) return round.venueUrl;
    if (round.venue.trim()) return mapsLink(round.venue, round.venueLat, round.venueLon);
    const known = this.groupTeamByName(round.opponent);
    if (known?.mapsUrl) return known.mapsUrl;
    return known?.address || known?.facilityName ? mapsLink([known.facilityName, known.address, known.city].filter(Boolean).join(', ')) : null;
  }

  protected async shareVenue(round: CalendarRound): Promise<void> {
    const url = this.mapsUrl(round);
    if (!url) return;
    const title = `${this.homeName(round)} – ${this.awayName(round)}`;
    const text = `${title} · ${this.formatDate(round.date)}${round.time ? ' ore ' + round.time : ''}\n${this.venueOf(round)}`;
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
      await navigator.clipboard.writeText(`${text}\n${url}`);
      this.notifications.notify({ title: 'Posizione copiata', message: 'Incollala in un messaggio: si apre direttamente in Maps.', type: 'success' });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') this.notifications.notify({ title: 'Condivisione non riuscita', message: url, type: 'warning', durationMs: 8000 });
    }
  }

  protected rows(leg: Leg): CalendarRound[] { return leg === 'A' ? this.calendar().andata : this.calendar().ritorno; }

  /* ------------------------------------------------------------ helpers */
  protected homeName(round: CalendarRound): string { return round.home ? (this.team()?.name ?? 'La mia squadra') : (round.opponent || 'Avversario'); }
  protected awayName(round: CalendarRound): string { return round.home ? (round.opponent || 'Avversario') : (this.team()?.name ?? 'La mia squadra'); }
  protected isMine(name: string): boolean { return name === this.team()?.name; }
  protected homeVenue(): string {
    const team = this.team();
    return [team?.facilityName, team?.facilityAddress].filter(Boolean).join(' · ') || 'Indirizzo della tua squadra (inseriscilo in Anagrafe Squadra)';
  }
  /** Pitch address saved with the opponent in the group list. */
  protected knownVenue(round: CalendarRound): string {
    const known = this.groupTeamByName(round.opponent);
    return known ? [known.facilityName, known.address, known.city].filter(Boolean).join(' · ') : '';
  }
  protected venueOf(round: CalendarRound): string { return round.home ? this.homeVenue() : (round.venue || this.knownVenue(round) || (round.venueUrl ? 'Posizione salvata da Maps' : 'Campo da indicare')); }
  protected formatDate(value: string): string {
    if (!value) return 'Data da inserire';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  protected shortDate(value: string): string {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('it-IT', { day: 'numeric', month: 'long' });
  }

  /* -------------------------------------------------------- auto save */
  private editRound(leg: Leg, index: number, change: (round: CalendarRound) => CalendarRound): void {
    if (leg === 'A') { this.updateAndata(andata => andata.map((round, i) => i === index ? change(round) : round)); return; }
    this.calendar.update(data => ({ ...data, ritorno: data.ritorno.map((round, i) => i === index ? change(round) : round) }));
    this.scheduleSave();
  }

  private updateAndata(change: (andata: CalendarRound[]) => CalendarRound[]): void {
    this.calendar.update(data => {
      const andata = change(data.andata);
      return { ...data, andata, ritorno: buildReturnLeg(andata, data.ritorno) };
    });
    this.scheduleSave();
  }

  private scheduleSave(): void {
    this.saveState.set('pending');
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.saveNow(); }, 900);
  }

  private async flush(): Promise<void> {
    if (this.saveTimer) { clearTimeout(this.saveTimer); this.saveTimer = null; await this.saveNow(); }
    await this.saveChain;
  }

  private saveNow(): Promise<void> {
    const team = this.team();
    const workspaceId = this.auth.workspaceId();
    if (!team || !workspaceId) return Promise.resolve();
    const data = this.calendar();
    this.saveChain = this.saveChain.then(async () => {
      this.saveState.set('saving');
      try {
        await this.service.save(workspaceId, team.id, team.name, data);
        if (!this.saveTimer) this.saveState.set('saved');
        window.dispatchEvent(new CustomEvent('fsm-match-context'));
      } catch (error) {
        console.error('Unable to save calendar.', error);
        this.saveState.set('error');
        this.notifications.notify({ title: 'Calendario non salvato', message: 'Controlla la connessione: riproverò alla prossima modifica.', type: 'error', durationMs: 7000 });
      }
    });
    return this.saveChain;
  }

  private async loadTeams(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.loading.set(true);
    try {
      const teams = (await this.teamService.list(workspaceId)).filter(team => !team.isArchived);
      this.teams.set(teams);
      let preferred: { id?: string; name?: string } = {};
      try { preferred = JSON.parse(localStorage.getItem('fsm-next-team') ?? '{}') ?? {}; } catch { preferred = {}; }
      this.teamId.set(teams.find(team => team.id === preferred.id || team.name === preferred.name)?.id ?? teams[0]?.id ?? '');
      await this.loadCalendar();
    } catch (error) {
      console.error('Unable to load teams for the calendar.', error);
      this.error.set('Non è stato possibile caricare le squadre.');
      this.loading.set(false);
    }
  }

  private async loadCalendar(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const teamId = this.teamId();
    this.saveState.set('idle');
    if (!workspaceId || !teamId) { this.calendar.set(emptyCalendar()); this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const data = await this.service.load(workspaceId, teamId);
      // Calendars made before the group list: turn the typed opponents into teams of the group.
      const known = new Set(data.groupTeams.map(team => team.name.toLowerCase()));
      const groupTeams = [...data.groupTeams];
      for (const round of data.andata) {
        const name = round.opponent.trim();
        if (name && !known.has(name.toLowerCase())) { known.add(name.toLowerCase()); groupTeams.push({ ...emptyGroupTeam(), id: `t-${groupTeams.length}-${Date.now().toString(36)}`, name }); }
      }
      this.calendar.set({ ...data, groupTeams, ritorno: buildReturnLeg(data.andata, data.ritorno) });
      this.error.set('');
    } catch (error) {
      console.error('Unable to load calendar.', error);
      this.error.set('Non è stato possibile caricare il calendario.');
    } finally { this.loading.set(false); }
  }
}
