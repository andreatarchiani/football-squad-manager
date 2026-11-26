import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { CalendarService, coordinatesFromLink, isMapsLink, mapsLink, buildReturnLeg, duplicateDates, emptyCalendar, findNextMatch, type CalendarData, type CalendarRound } from './calendar.service';

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
  /** Teams of the group: my team plus every opponent written in the first leg. */
  protected readonly groupTeams = computed(() => {
    const names = new Map<string, string>();
    const mine = this.team()?.name;
    if (mine) names.set(mine.toLowerCase(), mine);
    for (const round of this.calendar().andata) {
      const name = round.opponent.trim();
      if (name && !names.has(name.toLowerCase())) names.set(name.toLowerCase(), name);
    }
    return [...names.values()];
  });
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

  protected setOpponent(index: number, value: string): void {
    this.updateAndata(andata => andata.map((round, i) => i === index ? { ...round, opponent: value } : round));
  }

  /** ⇄ swaps the two teams: the team on the left plays at home. */
  protected swap(index: number): void {
    this.updateAndata(andata => andata.map((round, i) => i === index ? { ...round, home: !round.home, venue: '', venueLat: null, venueLon: null, venueUrl: '' } : round));
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

  /** Pitch of an away match: a name/address typed by hand, or a link pasted from Maps. */
  protected setVenue(leg: Leg, index: number, text: string): void {
    const value = text.trim();
    if (isMapsLink(value)) { this.setVenueLink(leg, index, value); return; }
    this.editRound(leg, index, round => ({ ...round, venue: text }));
  }

  protected setVenueLink(leg: Leg, index: number, link: string): void {
    const point = coordinatesFromLink(link);
    this.editRound(leg, index, round => ({ ...round, venueUrl: link, venueLat: point?.lat ?? null, venueLon: point?.lon ?? null }));
    this.notifications.notify({ title: 'Posizione di Maps salvata', message: 'Da qui si apre e si condivide direttamente in Maps.', type: 'success' });
  }

  protected clearVenueLink(leg: Leg, index: number): void {
    this.editRound(leg, index, round => ({ ...round, venueUrl: '', venueLat: null, venueLon: null }));
  }

  /** Opens Maps to look for the pitch (typed text, or the opponent's sports ground). */
  protected searchOnMaps(round: CalendarRound): string {
    const text = round.venue.trim() || `campo sportivo ${round.opponent}`.trim();
    return mapsLink(text);
  }

  /** "Incolla link": reads the link copied in Maps (Condividi › Copia link). */
  protected async pasteLink(leg: Leg, index: number): Promise<void> {
    try {
      const text = (await navigator.clipboard.readText()).trim();
      const link = /https?:\/\/\S+/.exec(text)?.[0] ?? '';
      if (isMapsLink(link)) { this.setVenueLink(leg, index, link); return; }
      this.notifications.notify({ title: 'Nessun link di Maps copiato', message: 'In Maps apri il campo, premi Condividi › Copia link e poi torna qui.', type: 'warning', durationMs: 7000 });
    } catch {
      this.notifications.notify({ title: 'Incolla il link nel campo', message: 'Tieni premuto nel campo indirizzo e scegli Incolla.', type: 'info', durationMs: 6000 });
    }
  }

  protected mapsUrl(round: CalendarRound): string | null {
    if (round.home) { const team = this.team(); const address = [team?.facilityName, team?.facilityAddress].filter(Boolean).join(', '); return team?.facilityAddress ? mapsLink(address) : null; }
    if (round.venueUrl) return round.venueUrl;
    return round.venue.trim() ? mapsLink(round.venue, round.venueLat, round.venueLon) : null;
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
  protected venueOf(round: CalendarRound): string { return round.home ? this.homeVenue() : (round.venue || (round.venueUrl ? 'Posizione salvata da Maps' : 'Campo da indicare')); }
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
      this.calendar.set({ ...data, ritorno: buildReturnLeg(data.andata, data.ritorno) });
      this.error.set('');
    } catch (error) {
      console.error('Unable to load calendar.', error);
      this.error.set('Non è stato possibile caricare il calendario.');
    } finally { this.loading.set(false); }
  }
}
