import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { clearFieldProblems, showFieldProblems, type FieldProblem } from '../../core/form-feedback';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { CalendarService, buildReturnLeg, emptyCalendar, type CalendarData, type CalendarRound } from './calendar.service';

@Component({
  selector: 'fsm-calendar-page',
  standalone: true,
  templateUrl: './calendar-page.component.html',
  styleUrl: './calendar-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CalendarPageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamService = inject(TeamService);
  private readonly service = inject(CalendarService);
  private readonly notifications = inject(NotificationService);

  protected readonly teams = signal<TeamRecord[]>([]);
  protected readonly teamId = signal('');
  protected readonly teamMenuOpen = signal(false);
  protected readonly calendar = signal<CalendarData>(emptyCalendar());
  protected readonly leg = signal<'A' | 'R'>('A');
  protected readonly selected = signal<{ leg: 'A' | 'R'; index: number } | null>(null);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly dirty = signal(false);
  protected readonly error = signal('');

  protected readonly team = computed(() => this.teams().find(team => team.id === this.teamId()));
  protected readonly rows = computed(() => this.leg() === 'A' ? this.calendar().andata : this.calendar().ritorno);
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
  protected readonly selectedRound = computed<CalendarRound | null>(() => {
    const pick = this.selected();
    if (!pick) return null;
    const list = pick.leg === 'A' ? this.calendar().andata : this.calendar().ritorno;
    return list[pick.index] ?? null;
  });
  protected readonly missingReturnDates = computed(() => this.calendar().ritorno.filter(round => !round.date).length);

  constructor() { effect(() => { if (this.auth.workspaceId()) void this.loadTeams(); }); }

  /* ------------------------------------------------------------ team */
  protected async selectTeam(id: string): Promise<void> {
    this.teamMenuOpen.set(false);
    if (id === this.teamId()) return;
    if (this.dirty() && !(await this.notifications.confirm({ title: 'Cambiare squadra?', message: 'Le modifiche al calendario non salvate andranno perse.', confirmText: 'Cambia squadra', cancelText: 'Annulla' }))) return;
    this.teamId.set(id);
    await this.loadCalendar();
  }

  /* ------------------------------------------------------- andata edits */
  protected addRound(): void {
    this.updateAndata(andata => [...andata, { number: andata.length + 1, leg: 'A', opponent: '', home: andata.length % 2 === 0, date: '', time: andata.at(-1)?.time ?? '' }]);
    this.leg.set('A');
    this.selected.set({ leg: 'A', index: this.calendar().andata.length - 1 });
  }

  protected removeRound(index: number): void {
    this.updateAndata(andata => andata.filter((_, i) => i !== index).map((round, i) => ({ ...round, number: i + 1 })));
    this.selected.set(null);
  }

  protected setOpponent(index: number, value: string): void { this.updateAndata(andata => andata.map((round, i) => i === index ? { ...round, opponent: value } : round)); }
  protected setHome(index: number, home: boolean): void { this.updateAndata(andata => andata.map((round, i) => i === index ? { ...round, home } : round)); }
  protected setGroupName(value: string): void { this.calendar.update(data => ({ ...data, groupName: value })); this.dirty.set(true); }

  /** Dates and times can be edited in both legs. */
  protected setWhen(leg: 'A' | 'R', index: number, key: 'date' | 'time', value: string): void {
    const edit = (round: CalendarRound): CalendarRound => key === 'date' ? { ...round, date: value } : { ...round, time: value };
    if (leg === 'A') { this.updateAndata(andata => andata.map((round, i) => i === index ? edit(round) : round)); return; }
    this.calendar.update(data => ({ ...data, ritorno: data.ritorno.map((round, i) => i === index ? edit(round) : round) }));
    this.dirty.set(true);
  }

  protected select(index: number): void { this.selected.set({ leg: this.leg(), index }); }

  /* ------------------------------------------------------------ helpers */
  protected homeName(round: CalendarRound): string { return round.home ? (this.team()?.name ?? 'La mia squadra') : (round.opponent || 'Avversario'); }
  protected awayName(round: CalendarRound): string { return round.home ? (round.opponent || 'Avversario') : (this.team()?.name ?? 'La mia squadra'); }
  protected isMine(name: string): boolean { return name === this.team()?.name; }
  protected formatDate(value: string): string {
    if (!value) return 'Data da inserire';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  protected shortDate(value: string): string {
    if (!value) return '—';
    const date = new Date(`${value}T12:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('it-IT', { day: '2-digit', month: 'short', year: '2-digit' });
  }

  /** Sends the opponent of a round to "Formazione" as the next match. */
  protected useAsNextMatch(round: CalendarRound): void {
    try { localStorage.setItem('fsm-next-opponent', round.opponent.trim()); } catch { /* storage unavailable */ }
    window.dispatchEvent(new CustomEvent('fsm-match-context'));
    this.notifications.notify({ title: 'Prossima partita impostata', message: `${this.homeName(round)} – ${this.awayName(round)}`, type: 'success' });
  }

  /* -------------------------------------------------------------- save */
  protected async save(host?: HTMLElement): Promise<void> {
    clearFieldProblems(host);
    const team = this.team();
    const workspaceId = this.auth.workspaceId();
    if (!team || !workspaceId) return;
    const andata = this.calendar().andata;
    if (!andata.length) {
      this.notifications.notify({ title: 'Calendario vuoto', message: 'Aggiungi almeno una giornata di andata.', type: 'warning' });
      return;
    }
    const problems: FieldProblem[] = andata
      .map((round, index) => ({ round, index }))
      .filter(item => !item.round.opponent.trim())
      .map(item => ({ field: `opponent-${item.index}`, label: `Giornata ${item.round.number}`, message: 'Compila questo campo' }));
    if (problems.length) {
      this.leg.set('A');
      // Wait for the andata table to be on screen before highlighting.
      window.setTimeout(() => showFieldProblems(host, problems), 0);
      this.notifications.notify({ title: 'Manca l’avversario', message: problems.map(problem => problem.label).join(', '), type: 'warning', durationMs: 6000 });
      return;
    }
    this.saving.set(true);
    try {
      await this.service.save(workspaceId, team.id, team.name, this.calendar());
      this.dirty.set(false);
      const missing = this.missingReturnDates();
      this.notifications.notify({ title: 'Calendario salvato', message: missing ? `Ritorno creato in automatico: mancano ${missing} date da inserire.` : 'Andata e ritorno sono completi.', type: 'success' });
    } catch (error) {
      console.error('Unable to save calendar.', error);
      this.notifications.notify({ title: 'Calendario non salvato', message: 'Controlla la connessione a internet e riprova.', type: 'error', durationMs: 7000 });
    } finally { this.saving.set(false); }
  }

  private updateAndata(change: (andata: CalendarRound[]) => CalendarRound[]): void {
    this.calendar.update(data => {
      const andata = change(data.andata);
      return { ...data, andata, ritorno: buildReturnLeg(andata, data.ritorno) };
    });
    this.dirty.set(true);
  }

  private async loadTeams(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.loading.set(true);
    try {
      const teams = (await this.teamService.list(workspaceId)).filter(team => !team.isArchived);
      this.teams.set(teams);
      let preferred = '';
      try { preferred = JSON.parse(localStorage.getItem('fsm-next-team') ?? 'null')?.name ?? ''; } catch { preferred = ''; }
      this.teamId.set(teams.find(team => team.name === preferred)?.id ?? teams[0]?.id ?? '');
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
    this.selected.set(null);
    this.leg.set('A');
    if (!workspaceId || !teamId) { this.calendar.set(emptyCalendar()); this.loading.set(false); return; }
    this.loading.set(true);
    try {
      const data = await this.service.load(workspaceId, teamId);
      this.calendar.set({ ...data, ritorno: buildReturnLeg(data.andata, data.ritorno) });
      this.dirty.set(false);
      this.error.set('');
      if (data.andata.length) this.selected.set({ leg: 'A', index: 0 });
    } catch (error) {
      console.error('Unable to load calendar.', error);
      this.error.set('Non è stato possibile caricare il calendario.');
    } finally { this.loading.set(false); }
  }
}
