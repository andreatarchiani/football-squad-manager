import { PITCH_SLOTS } from '../../core/formations';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { ActiveEventService } from '../../core/active-event.service';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { PlayerService, type PlayerRecord } from '../players/player.service';
import { renderCallupImage, type CallupImageData, type CallupImagePlayer } from './callup-image';
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
  private readonly activeEvents = inject(ActiveEventService);
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
  /** The picture of the call-up (what the coach sends to the players). */
  protected readonly imageData = computed<CallupImageData | null>(() => this.buildImageData());
  protected readonly imageUrl = signal('');
  protected readonly imageBusy = signal(false);
  private imageBlob: Blob | null = null;
  private imageTimer: ReturnType<typeof setTimeout> | null = null;

  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    effect(() => { if (this.auth.workspaceId()) void this.load(); });
    effect(() => {
      const data = this.imageData();
      if (this.imageTimer) clearTimeout(this.imageTimer);
      if (!data) { this.imageUrl.set(''); this.imageBlob = null; return; }
      this.imageBusy.set(true);
      this.imageTimer = setTimeout(() => void this.refreshImage(data), 250);
    });
  }

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
  private async refreshImage(data: CallupImageData): Promise<void> {
    try {
      const blob = await renderCallupImage(data);
      if (this.imageUrl()) URL.revokeObjectURL(this.imageUrl());
      this.imageBlob = blob;
      this.imageUrl.set(URL.createObjectURL(blob));
    } catch (error) { console.error('Unable to draw the call-up picture.', error); this.imageUrl.set(''); }
    finally { this.imageBusy.set(false); }
  }

  private fileName(): string {
    const round = this.round();
    return `convocazione-${(this.team()?.name ?? 'squadra').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-g${round?.number ?? ''}.png`;
  }

  /** Opens the phone's share sheet with the picture (WhatsApp, Telegram…). The Maps link goes along as the caption. */
  protected async share(): Promise<void> {
    if (!this.imageBlob) return;
    const file = new File([this.imageBlob], this.fileName(), { type: 'image/png' });
    const url = this.venue().url;
    try {
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: `Convocazione ${this.team()?.name ?? ''}`.trim(), text: url ? `Campo: ${url}` : '' });
        return;
      }
      this.download();
      this.notifications.notify({ title: 'Immagine scaricata', message: 'Questo dispositivo non può condividere direttamente: allega l’immagine in WhatsApp.', type: 'info', durationMs: 7000 });
    } catch (error) {
      if ((error as Error).name !== 'AbortError') { this.download(); this.notifications.notify({ title: 'Condivisione non riuscita', message: 'Ho scaricato l’immagine: allegala tu in WhatsApp.', type: 'warning', durationMs: 7000 }); }
    }
  }

  protected download(): void {
    if (!this.imageBlob) return;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(this.imageBlob);
    link.download = this.fileName();
    document.body.appendChild(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  protected async copyMapsLink(): Promise<void> {
    const url = this.venue().url;
    if (!url) return;
    try { await navigator.clipboard.writeText(url); this.notifications.notify({ title: 'Link copiato', message: 'Link di Maps del campo copiato.', type: 'success' }); }
    catch { this.notifications.notify({ title: 'Copia non riuscita', message: 'Il browser non permette di copiare.', type: 'warning' }); }
  }

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
    const slot = PITCH_SLOTS[this.formation()]?.find(item => item.id === slotId);
    if (slot) return ({ Portiere: 'POR', Difensore: 'DIF', Centrocampista: 'CEN', Attaccante: 'ATT' } as Record<string, string>)[slot.role];
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

  private buildImageData(): CallupImageData | null {
    const team = this.team(); const round = this.round(); const info = this.info();
    if (!team || !round) return null;
    const calendar = this.calendar();
    const toImage = (item: CallupPlayer): CallupImagePlayer => ({ tag: item.tag, number: item.player.shirtNumber != null ? String(item.player.shirtNumber) : '', name: this.fullName(item.player), badge: this.badge(item.player) });
    return {
      teamName: team.name, category: team.category, icon: team.icon || '⚽', eventTitle: calendar ? eventTitle(calendar) : '',
      roundLabel: `Giornata ${round.number} · ${round.leg === 'A' ? 'Andata' : 'Ritorno'}`,
      home: this.homeName(), away: this.awayName(), teamIsHome: round.home,
      date: this.formatDate(round.date), time: round.time || '', meetingTime: info.meetingTime, meetingPlace: info.meetingPlace,
      venue: [round.home ? 'In casa' : 'In trasferta', this.venue().name].filter(Boolean).join(' · '), kit: info.kit, notes: info.notes,
      formation: this.formation(), starters: this.starters().map(toImage), bench: this.bench().map(toImage), calledCount: this.called().length
    };
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
        this.calendarService.nextMatchEvent(workspaceId, this.activeEvents.activeId()),
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
