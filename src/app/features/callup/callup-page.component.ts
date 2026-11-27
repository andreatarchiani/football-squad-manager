import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { PlayerService, type PlayerRecord } from '../players/player.service';
import { CalendarService, emptyCallup, eventTitle, mapsLink, type CalendarData, type CalendarRound, type CallupInfo } from '../calendar/calendar.service';

interface CallupPlayer { player: PlayerRecord; tag: string; }

const GROUPS: { key: string; label: string }[] = [
  { key: 'POR', label: 'Portieri' }, { key: 'DIF', label: 'Difensori' }, { key: 'CEN', label: 'Centrocampisti' }, { key: 'ATT', label: 'Attaccanti' }
];

@Component({
  selector: 'fsm-callup-page',
  standalone: true,
  templateUrl: './callup-page.component.html',
  styleUrl: './callup-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class CallupPageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamService = inject(TeamService);
  private readonly playerService = inject(PlayerService);
  private readonly calendarService = inject(CalendarService);
  private readonly notifications = inject(NotificationService);

  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly team = signal<TeamRecord | null>(null);
  protected readonly calendar = signal<CalendarData | null>(null);
  protected readonly round = signal<CalendarRound | null>(null);
  protected readonly players = signal<PlayerRecord[]>([]);
  protected readonly lineup = signal<Record<string, string>>({});
  protected readonly formation = signal('');
  protected readonly info = signal<CallupInfo>(emptyCallup());

  /** Players who can be called up (injured, suspended or left players cannot). */
  protected readonly available = computed(() => this.players().filter(player => player.status === 'active'));
  protected readonly unavailable = computed(() => this.players().filter(player => player.status === 'injured' || player.status === 'suspended'));
  protected readonly called = computed(() => this.available().filter(player => !this.info().excluded.includes(player.id)));
  protected readonly notCalled = computed(() => this.available().filter(player => this.info().excluded.includes(player.id)));

  /** Starters: players of the saved formation who are called up, goalkeeper first. */
  protected readonly starters = computed<CallupPlayer[]>(() => {
    const called = new Map(this.called().map(player => [player.id, player]));
    const order = ['POR', 'DIF', 'CEN', 'ATT'];
    return Object.entries(this.lineup())
      .map(([slotId, playerId]) => ({ player: called.get(playerId), tag: this.slotGroup(slotId) }))
      .filter((item): item is CallupPlayer => !!item.player)
      .sort((a, b) => order.indexOf(a.tag) - order.indexOf(b.tag));
  });
  /** Bench: everybody called up who is not a starter. */
  protected readonly bench = computed<CallupPlayer[]>(() => {
    const starters = new Set(this.starters().map(item => item.player.id));
    return this.called().filter(player => !starters.has(player.id)).map(player => ({ player, tag: this.roleTag(player) }))
      .sort((a, b) => ['POR', 'DIF', 'CEN', 'ATT'].indexOf(a.tag) - ['POR', 'DIF', 'CEN', 'ATT'].indexOf(b.tag) || (a.player.shirtNumber ?? 99) - (b.player.shirtNumber ?? 99));
  });
  protected readonly groups = GROUPS;
  protected readonly venue = computed(() => this.matchVenue());
  protected readonly shareText = computed(() => this.buildText());

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() { effect(() => { if (this.auth.workspaceId()) void this.load(); }); }

  /* ------------------------------------------------------------ edits */
  protected setField(key: 'meetingTime' | 'meetingPlace' | 'kit' | 'notes', value: string): void {
    this.info.update(info => ({ ...info, [key]: value }));
    this.scheduleSave();
  }

  protected toggle(player: PlayerRecord): void {
    this.info.update(info => ({ ...info, excluded: info.excluded.includes(player.id) ? info.excluded.filter(id => id !== player.id) : [...info.excluded, player.id] }));
    this.scheduleSave();
  }

  /* ------------------------------------------------------------- share */
  protected async share(): Promise<void> {
    const text = this.shareText();
    const title = `Convocazione ${this.team()?.name ?? ''}`.trim();
    try {
      if (navigator.share) { await navigator.share({ title, text }); return; }
      await navigator.clipboard.writeText(text);
      this.notifications.notify({ title: 'Convocazione copiata', message: 'Incollala in WhatsApp o in un messaggio.', type: 'success' });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') this.notifications.notify({ title: 'Condivisione non riuscita', message: 'Usa “Copia testo” e incolla il messaggio.', type: 'warning', durationMs: 7000 });
    }
  }

  protected async copy(): Promise<void> {
    try { await navigator.clipboard.writeText(this.shareText()); this.notifications.notify({ title: 'Testo copiato', message: 'Incollalo dove vuoi: contiene anche il link di Maps.', type: 'success' }); }
    catch { this.notifications.notify({ title: 'Copia non riuscita', message: 'Il browser non permette di copiare: usa “Condividi”.', type: 'warning' }); }
  }

  protected whatsappUrl(): string { return `https://wa.me/?text=${encodeURIComponent(this.shareText())}`; }

  /* ----------------------------------------------------------- helpers */
  protected homeName(): string { const round = this.round(); return round?.home ? (this.team()?.name ?? '') : (round?.opponent ?? ''); }
  protected awayName(): string { const round = this.round(); return round?.home ? (round?.opponent ?? '') : (this.team()?.name ?? ''); }
  protected fullName(player: PlayerRecord): string { return `${player.lastName} ${player.firstName}`.trim(); }
  protected badge(player: PlayerRecord): string { return player.isCaptain ? 'C' : player.isViceCaptain ? 'VC' : ''; }
  protected formatDate(value: string): string {
    const date = new Date(`${value}T12:00:00`);
    return !value || Number.isNaN(date.getTime()) ? 'Data da definire' : date.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  }
  protected groupOf(items: CallupPlayer[], key: string): CallupPlayer[] { return items.filter(item => item.tag === key); }

  private slotGroup(slotId: string): string {
    const id = slotId.toLowerCase();
    if (id.startsWith('por')) return 'POR';
    if (/^(ts|td|dc|dif|ter|lib|dd|ds)/.test(id)) return 'DIF';
    if (/^(att|punta|ala|ss|tq|seconda)/.test(id)) return 'ATT';
    return 'CEN';
  }
  private roleTag(player: PlayerRecord): string {
    return ({ Portiere: 'POR', Difensore: 'DIF', Centrocampista: 'CEN', Attaccante: 'ATT' } as Record<string, string>)[player.primaryRole] ?? 'CEN';
  }

  /** Where the match is played and the Maps link to get there. */
  private matchVenue(): { name: string; url: string } {
    const round = this.round(); const team = this.team(); const calendar = this.calendar();
    if (!round || !team) return { name: '', url: '' };
    if (round.home) {
      const name = [team.facilityName, team.facilityAddress].filter(Boolean).join(' · ');
      const url = team.facilityMapsUrl || (team.facilityAddress ? mapsLink([team.facilityName, team.facilityAddress].filter(Boolean).join(', ')) : '');
      return { name, url };
    }
    const known = calendar?.groupTeams.find(item => item.name.toLowerCase() === round.opponent.trim().toLowerCase());
    const name = round.venue || [known?.facilityName, known?.address, known?.city].filter(Boolean).join(' · ');
    const url = round.venueUrl || (round.venue ? mapsLink(round.venue, round.venueLat, round.venueLon) : known?.mapsUrl || (known?.address ? mapsLink([known.facilityName, known.address, known.city].filter(Boolean).join(', ')) : ''));
    return { name, url };
  }

  private line(item: CallupPlayer, withTag: boolean): string {
    const { player } = item;
    const number = player.shirtNumber != null ? `#${player.shirtNumber} ` : '';
    const badge = this.badge(player);
    return `${withTag ? item.tag + ' · ' : '• '}${number}${this.fullName(player)}${badge ? ` (${badge})` : ''}`;
  }

  private buildText(): string {
    const team = this.team(); const round = this.round(); const info = this.info();
    if (!team || !round) return '';
    const venue = this.venue();
    const out: string[] = [];
    out.push('📋 CONVOCAZIONE');
    out.push(`${team.name}${team.category ? ' · ' + team.category : ''}`);
    const calendar = this.calendar();
    const group = calendar ? eventTitle(calendar) : '';
    out.push(`${group ? group + ' · ' : ''}Giornata ${round.number} · ${round.leg === 'A' ? 'Andata' : 'Ritorno'}`);
    out.push('');
    out.push(`🆚 ${this.homeName()} – ${this.awayName()}`);
    out.push(`📅 ${this.formatDate(round.date)}${round.time ? ` · gara ore ${round.time}` : ''}`);
    if (info.meetingTime || info.meetingPlace) out.push(`🤝 Ritrovo${info.meetingTime ? ' ore ' + info.meetingTime : ''}${info.meetingPlace ? ' · ' + info.meetingPlace : ''}`);
    out.push(`🏟️ ${round.home ? 'In casa' : 'In trasferta'}${venue.name ? ' · ' + venue.name : ''}`);
    if (venue.url) out.push(`🗺️ Maps: ${venue.url}`);
    if (info.kit) out.push(`👕 ${info.kit}`);
    out.push('');
    out.push(`⭐ TITOLARI${this.formation() ? ' (' + this.formation() + ')' : ''}`);
    if (this.starters().length) this.starters().forEach(item => out.push(this.line(item, true))); else out.push('Formazione da definire');
    out.push('');
    out.push('🪑 PANCHINA');
    if (this.bench().length) this.bench().forEach(item => out.push(this.line(item, false))); else out.push('—');
    if (info.notes) { out.push(''); out.push(`📝 ${info.notes}`); }
    out.push('');
    out.push(`Convocati: ${this.called().length}`);
    return out.join('\n');
  }

  /* -------------------------------------------------- load and save */
  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => { this.saveTimer = null; void this.saveNow(); }, 700);
  }

  private async saveNow(): Promise<void> {
    const workspaceId = this.auth.workspaceId(); const calendar = this.calendar(); const round = this.round();
    if (!workspaceId || !calendar || !round) return;
    try { await this.calendarService.saveCallup(workspaceId, calendar.id, round.number, this.info()); }
    catch (error) {
      console.error('Unable to save the call-up.', error);
      this.notifications.notify({ title: 'Convocazione non salvata', message: 'Controlla la connessione e riprova a modificarla.', type: 'error', durationMs: 7000 });
    }
  }

  private async load(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.loading.set(true);
    try {
      const teams = (await this.teamService.list(workspaceId)).filter(item => !item.isArchived);
      let preferred: { id?: string; name?: string } = {};
      try { preferred = JSON.parse(localStorage.getItem('fsm-next-team') ?? '{}') ?? {}; } catch { preferred = {}; }
      const team = teams.find(item => item.id === preferred.id || item.name === preferred.name) ?? teams[0] ?? null;
      this.team.set(team);
      if (!team) { this.loading.set(false); return; }
      const uid = this.auth.user()?.uid;
      const slot = (uid && localStorage.getItem(`fsm-layout-slot-${uid}`)) === '2' ? 2 : 1;
      const [next, players, layout] = await Promise.all([
        this.calendarService.nextMatchEvent(workspaceId, team.id),
        this.playerService.list(workspaceId, teams),
        team.seasonId ? this.teamService.loadTacticalLayout(workspaceId, team.id, team.seasonId, slot) : Promise.resolve(null)
      ]);
      const calendar = next?.calendar ?? null;
      const round = next?.round ?? null;
      this.calendar.set(calendar);
      this.round.set(round);
      this.info.set(round && calendar ? { ...emptyCallup(), ...(calendar.callups[String(round.number)] ?? {}) } : emptyCallup());
      this.players.set(players.filter(player => player.teamId === team.id && !player.isArchived));
      this.lineup.set(layout?.lineup ?? {});
      this.formation.set(layout?.formation ?? '');
      this.error.set('');
    } catch (error) {
      console.error('Unable to load the call-up.', error);
      this.error.set('Non è stato possibile caricare la convocazione.');
    } finally { this.loading.set(false); }
  }
}
