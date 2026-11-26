import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { TeamService, type TeamInput, type TeamRecord } from './team.service';
import { PlayerService, type PlayerRecord } from '../players/player.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { clearFieldProblems, showFieldProblems, type FieldProblem } from '../../core/form-feedback';
import { LiveMatchComponent } from './live-match.component';

@Component({
  selector: 'fsm-teams-page',
  standalone: true,
  imports: [FormsModule, LiveMatchComponent],
  templateUrl: './teams-page.component.html',
  styleUrl: './teams-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TeamsPageComponent implements OnChanges {
  @Input() launchRequest: { team: TeamRecord; players: PlayerRecord[]; lineup: Record<string, string>; formation: string; positions: Record<string, { x: number; y: number }>; layoutSlot: 1 | 2; opponentName: string; token: number } | null = null;
  @Input() rosterRequest: { teamId: string; layoutSlot: 1 | 2; token: number; scroll?: boolean } | null = null;
  @Input() resumeMatch = false;
  @Output() readonly matchClosed = new EventEmitter<void>();
  private handledLaunchToken = 0;
  private handledRosterToken = 0;
  private teamsLoadPromise: Promise<void> = Promise.resolve();
  protected readonly layoutSlot = signal<1 | 2>(1);
  protected readonly categoryDropdownOpen = signal(false);
  protected readonly teamCategories = ['Juniores Under 19','Under 18','Allievi Under 17','Allievi B Under 16','Giovanissimi Under 15','Giovanissimi B Under 14','Esordienti II anno Under 13','Esordienti I anno Under 12','Pulcini II anno Under 11','Pulcini I anno Under 10','Primi Calci II anno Under 9','Primi Calci I anno Under 8','Piccoli Amici II anno Under 7','Piccoli Amici I anno Under 6'];
  protected selectTeamCategory(category: string): void {
    this.onCategoryChange(category);
    this.categoryDropdownOpen.set(false);
  }
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamsService = inject(TeamService);
  private readonly playerService = inject(PlayerService);
  private readonly notifications = inject(NotificationService);

  protected readonly teams = signal<TeamRecord[]>([]);
  protected readonly players = signal<PlayerRecord[]>([]);
  protected readonly expandedRosterId = signal<string | null>(null);
  protected readonly rosterLoading = signal(false);
  protected readonly layoutSaving = signal(false);
  private layoutSaveQueue: Promise<void> = Promise.resolve();
  protected readonly formation = signal('4-3-3');
  protected readonly formationDropdownOpen = signal(false);
  protected readonly lineup = signal<Record<string, string>>({});
  protected readonly captainId = signal('');
  protected readonly captainDropdownOpen = signal(false);
  protected readonly viceCaptainDropdownOpen = signal(false);
  protected readonly viceCaptainId = signal('');
  protected readonly captaincySaving = signal(false);
  protected readonly captaincySaveStatus = signal('Ruoli salvati automaticamente');
  private captaincySaveQueue: Promise<void> = Promise.resolve();
  private layoutSlotStorageKey(): string { return `fsm-layout-slot-${this.auth.user()?.uid ?? 'anonymous'}`; }
  private persistSelectedLayoutSlot(slot: 1 | 2): void { if (typeof localStorage !== 'undefined') localStorage.setItem(this.layoutSlotStorageKey(), String(slot)); }

  protected readonly activeSlotId = signal<string | null>(null);
  protected readonly liveMatch = signal(false);
  protected readonly autoStartMatch = signal(false);
  protected readonly matchOpponentName = signal('');
  protected readonly shirtPositions = signal<Record<string, { x: number; y: number }>>({});
  private dragSlotId: string | null = null;
  protected readonly formations = ['4-3-3', '4-4-2', '3-5-2'];
  protected readonly pitchSlots: Record<string, { id: string; label: string; role: string; x: number; y: number }[]> = {
    '4-3-3': [
      { id: 'por', label: 'POR', role: 'Portiere', x: 50, y: 91 },
      { id: 'ts', label: 'TS', role: 'Difensore', x: 13, y: 72 }, { id: 'dc1', label: 'DC', role: 'Difensore', x: 38, y: 75 }, { id: 'dc2', label: 'DC', role: 'Difensore', x: 62, y: 75 }, { id: 'td', label: 'TD', role: 'Difensore', x: 87, y: 72 },
      { id: 'mezz1', label: 'CC', role: 'Centrocampista', x: 28, y: 49 }, { id: 'med', label: 'MED', role: 'Centrocampista', x: 50, y: 56 }, { id: 'mezz2', label: 'CC', role: 'Centrocampista', x: 72, y: 49 },
      { id: 'ala1', label: 'AS', role: 'Attaccante', x: 17, y: 27 }, { id: 'punta', label: 'ATT', role: 'Attaccante', x: 50, y: 19 }, { id: 'ala2', label: 'AD', role: 'Attaccante', x: 83, y: 27 }
    ],
    '4-4-2': [
      { id: 'por', label: 'POR', role: 'Portiere', x: 50, y: 91 },
      { id: 'ts', label: 'TS', role: 'Difensore', x: 13, y: 72 }, { id: 'dc1', label: 'DC', role: 'Difensore', x: 38, y: 75 }, { id: 'dc2', label: 'DC', role: 'Difensore', x: 62, y: 75 }, { id: 'td', label: 'TD', role: 'Difensore', x: 87, y: 72 },
      { id: 'est1', label: 'ES', role: 'Centrocampista', x: 13, y: 49 }, { id: 'cc1', label: 'CC', role: 'Centrocampista', x: 38, y: 53 }, { id: 'cc2', label: 'CC', role: 'Centrocampista', x: 62, y: 53 }, { id: 'est2', label: 'ED', role: 'Centrocampista', x: 87, y: 49 },
      { id: 'att1', label: 'ATT', role: 'Attaccante', x: 37, y: 24 }, { id: 'att2', label: 'ATT', role: 'Attaccante', x: 63, y: 24 }
    ],
    '3-5-2': [
      { id: 'por', label: 'POR', role: 'Portiere', x: 50, y: 91 },
      { id: 'dc1', label: 'DC', role: 'Difensore', x: 25, y: 75 }, { id: 'dc2', label: 'DC', role: 'Difensore', x: 50, y: 78 }, { id: 'dc3', label: 'DC', role: 'Difensore', x: 75, y: 75 },
      { id: 'est1', label: 'EST', role: 'Centrocampista', x: 10, y: 49 }, { id: 'cc1', label: 'CC', role: 'Centrocampista', x: 30, y: 53 }, { id: 'reg', label: 'REG', role: 'Centrocampista', x: 50, y: 47 }, { id: 'cc2', label: 'CC', role: 'Centrocampista', x: 70, y: 53 }, { id: 'est2', label: 'EST', role: 'Centrocampista', x: 90, y: 49 },
      { id: 'att1', label: 'ATT', role: 'Attaccante', x: 36, y: 24 }, { id: 'att2', label: 'ATT', role: 'Attaccante', x: 64, y: 24 }
    ]
  };
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly showArchived = signal(false);
  protected readonly teamSort = signal<'name-asc' | 'name-desc'>('name-asc');
  protected readonly teamSortDropdownOpen = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  protected readonly notice = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  protected form: TeamInput = this.emptyForm();
  protected readonly teamIcons = ['⚽', '🛡️', '🏆', '⭐', '👑', '🦅', '🦁', '🐺', '🐉', '🔥', '⚡', '💎', '🏟️', '🎯', '🔱', '🌟'];
  protected readonly teamIconUploadStatus = signal('');
  protected readonly teamIconPreview = signal('');

  protected isImageIcon(value: string | null | undefined): boolean {
    return typeof value === 'string' && value.startsWith('data:image/');
  }

  protected async onTeamIconUpload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      this.error.set('Seleziona un file immagine valido.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      this.error.set('L\'immagine è troppo grande. Scegli un file inferiore a 8 MB.');
      return;
    }

    try {
      const preparedIcon = await this.prepareTeamIcon(file);
      this.teamIconPreview.set(preparedIcon);
      this.form.icon = preparedIcon;
      this.teamIconUploadStatus.set('Immagine caricata correttamente');
      this.error.set('');
    } catch (error) {
      console.error('Unable to prepare team icon.', error);
      this.error.set('Non è stato possibile caricare l\'immagine. Prova con PNG, JPG o WebP.');
    }
  }

  private prepareTeamIcon(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(reader.error);
      reader.onload = () => {
        const image = new Image();
        image.onerror = () => reject(new Error('Invalid image'));
        image.onload = () => {
          const size = 256;
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const context = canvas.getContext('2d');
          if (!context) { reject(new Error('Canvas unavailable')); return; }

          context.clearRect(0, 0, size, size);
          const scale = Math.max(size / image.width, size / image.height);
          const width = image.width * scale;
          const height = image.height * scale;
          context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);

          const dataUrl = canvas.toDataURL('image/webp', 0.82);
          resolve(dataUrl.length < 700000 ? dataUrl : canvas.toDataURL('image/jpeg', 0.72));
        };
        image.src = String(reader.result ?? '');
      };
      reader.readAsDataURL(file);
    });
  }

  constructor() {
    this.teamsLoadPromise = this.loadTeams();
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['launchRequest'] && this.launchRequest && this.launchRequest.token !== this.handledLaunchToken) {
      this.handledLaunchToken = this.launchRequest.token;
      void this.launchFromHome(this.launchRequest);
    }
    if (changes['rosterRequest'] && this.rosterRequest && this.rosterRequest.token !== this.handledRosterToken) {
      this.handledRosterToken = this.rosterRequest.token;
      void this.openRequestedRoster(this.rosterRequest);
    }
  }

  protected get visibleTeams(): TeamRecord[] {
    const list = this.teams().filter((team) => this.showArchived() || !team.isArchived);
    return [...list].sort((a, b) => { const order = a.name.localeCompare(b.name, 'it', { sensitivity: 'base' }); return this.teamSort() === 'name-desc' ? -order : order; });
  }

  protected slots() { return this.pitchSlots[this.formation()]; }
  protected startersCount(): number { return this.slots().filter(slot => !!this.playerForSlot(slot.id)).length; }
  /** Short role badge used in the Titolari / Panchina lists (POR, DIF, CEN, ATT). */
  protected roleCode(role: string | null | undefined): string {
    const value = (role ?? '').toLowerCase();
    if (value.startsWith('port')) return 'POR';
    if (value.startsWith('dif')) return 'DIF';
    if (value.startsWith('centro') || value.startsWith('cen')) return 'CEN';
    if (value.startsWith('att')) return 'ATT';
    return '—';
  }

  protected captainLabel(team: TeamRecord): string { const player = this.rosterFor(team).find(item => item.id === this.captainId()); return player ? `${player.shirtNumber ?? '—'} · ${player.firstName} ${player.lastName}` : 'Seleziona giocatore'; }
  protected viceCaptainLabel(team: TeamRecord): string { const player = this.rosterFor(team).find(item => item.id === this.viceCaptainId()); return player ? `${player.shirtNumber ?? '—'} · ${player.firstName} ${player.lastName}` : 'Seleziona giocatore'; }

  protected expandedTeamName(): string { return this.teams().find(team => team.id === this.expandedRosterId())?.name || 'Partita'; }
  private async openRequestedRoster(request: NonNullable<TeamsPageComponent['rosterRequest']>): Promise<void> {
    await this.teamsLoadPromise;
    const team = this.teams().find(item => item.id === request.teamId && !item.isArchived);
    if (!team) { this.error.set('La squadra selezionata non è disponibile.'); return; }
    this.liveMatch.set(false);
    this.autoStartMatch.set(false);
    if (this.expandedRosterId() !== team.id) await this.toggleRoster(team);
    if (request.layoutSlot !== this.layoutSlot()) await this.selectLayoutSlot(request.layoutSlot);
    if (request.scroll === false) return;
    await new Promise<void>(resolve => setTimeout(resolve, 120));
    const rosterPanel = Array.from(document.querySelectorAll<HTMLElement>('[data-roster-team]'))
      .find(element => element.dataset['rosterTeam'] === team.id);
    rosterPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  private async launchFromHome(request: NonNullable<TeamsPageComponent['launchRequest']>): Promise<void> {
    await this.teamsLoadPromise;
    const team = request.team;
    if (team.isArchived || !team.seasonId) { this.error.set('La squadra selezionata non è disponibile.'); return; }
    if (!this.teams().some(item => item.id === team.id)) this.teams.update(items => [...items, team]);
    const workspaceId = this.auth.workspaceId();
    if (workspaceId) {
      try {
        // Home sends only active starters/players. Reload the complete team roster
        // so the live match can also display injured, suspended and other members.
        this.players.set(await this.playerService.list(workspaceId, this.teams()));
      } catch (error) {
        console.error('Unable to reload the full squad before starting the match.', error);
        this.players.set([...request.players]);
        this.error.set('Non è stato possibile caricare tutta la rosa. Alcuni giocatori potrebbero non comparire.');
      }
    } else {
      this.players.set([...request.players]);
    }
    this.matchOpponentName.set(request.opponentName || '');
    this.expandedRosterId.set(team.id);
    this.layoutSlot.set(request.layoutSlot);
    this.activeSlotId.set(null);
    this.rosterLoading.set(false);
    if (!this.error()) this.error.set('');
    this.formation.set(this.formations.includes(request.formation) ? request.formation : '4-3-3');
    this.lineup.set({ ...request.lineup });
    this.shirtPositions.set({ ...request.positions });
    this.autoStartMatch.set(true);
    localStorage.setItem('fsm-active-match-team', team.id);
    this.liveMatch.set(true);
  }
  protected closeMatch(): void { this.liveMatch.set(false); this.autoStartMatch.set(false); localStorage.removeItem('fsm-active-match-team'); this.matchClosed.emit(); }
  protected returnToRoster(): void { this.liveMatch.set(false); this.autoStartMatch.set(false); this.activeSlotId.set(null); }

  protected playerForSlot(slotId: string): PlayerRecord | undefined {
    return this.rosterForExpanded().find(player => player.id === this.lineup()[slotId]);
  }

  protected rosterForExpanded(): PlayerRecord[] {
    const team = this.teams().find(item => item.id === this.expandedRosterId());
    return team ? this.rosterFor(team) : [];
  }

  private eligibleRosterForExpanded(): PlayerRecord[] {
    return this.rosterForExpanded().filter(player => player.status === 'active');
  }

  protected async setCaptaincy(role: 'captain' | 'viceCaptain', playerId: string): Promise<void> {
    let nextCaptain = role === 'captain' ? playerId : this.captainId();
    let nextVice = role === 'viceCaptain' ? playerId : this.viceCaptainId();
    if (nextCaptain && nextCaptain === nextVice) {
      if (role === 'captain') nextVice = '';
      else nextCaptain = '';
    }
    const team = this.teams().find(item => item.id === this.expandedRosterId());
    const workspaceId = this.auth.workspaceId();
    if (!team?.seasonId || !workspaceId) return;

    const previousCaptain = this.captainId();
    const previousVice = this.viceCaptainId();
    this.captainId.set(nextCaptain);
    this.viceCaptainId.set(nextVice);
    this.captaincySaveStatus.set('Salvataggio nella rosa…');

    const captainId = nextCaptain;
    const viceCaptainId = nextVice;
    this.captaincySaveQueue = this.captaincySaveQueue.catch(() => undefined).then(async () => {
      this.captaincySaving.set(true);
      try {
        await this.teamsService.saveCaptaincy(workspaceId, team.id, team.seasonId!, captainId, viceCaptainId);
        this.players.update(players => players.map(player =>
          player.teamId === team.id && player.seasonId === team.seasonId
            ? { ...player, isCaptain: player.id === captainId, isViceCaptain: player.id === viceCaptainId }
            : player));
        this.captaincySaveStatus.set('Ruoli salvati nella rosa');
        this.error.set('');
      } catch (error) {
        console.error('Unable to save captaincy on squad members.', error);
        this.captainId.set(previousCaptain);
        this.viceCaptainId.set(previousVice);
        this.captaincySaveStatus.set('Salvataggio non riuscito');
        this.error.set('Non è stato possibile aggiornare i ruoli nella rosa. Riprova.');
      } finally {
        this.captaincySaving.set(false);
      }
    });
    await this.captaincySaveQueue;
  }

  protected benchPlayers(): PlayerRecord[] {
    const starters = new Set(Object.values(this.lineup()).filter(Boolean));
    return this.rosterForExpanded().filter(player => !starters.has(player.id));
  }

  protected async selectLayoutSlot(slot: 1 | 2): Promise<void> {
    const team = this.teams().find(item => item.id === this.expandedRosterId());
    const workspaceId = this.auth.workspaceId();
    if (!team?.seasonId || !workspaceId || slot === this.layoutSlot()) return;
    await this.persistTacticalLayout();
    this.layoutSlot.set(slot);
    this.persistSelectedLayoutSlot(slot);
    const saved = await this.teamsService.loadTacticalLayout(workspaceId, team.id, team.seasonId, slot);
    const validIds = new Set(this.eligibleRosterForExpanded().map(player => player.id));
    const formation = saved && this.formations.includes(saved.formation) ? saved.formation : '4-3-3';
    this.formation.set(formation);
    if (saved) {
      const validSlots = new Set(this.pitchSlots[formation].map(item => item.id));
      this.lineup.set(Object.fromEntries(Object.entries(saved.lineup).filter(([id, playerId]) => validSlots.has(id) && validIds.has(playerId))));
      this.shirtPositions.set(saved.shirtPositions || {});
    } else { this.shirtPositions.set({}); this.autoArrange(); await this.persistTacticalLayout(); }
  }

  protected changeFormation(value: string): void {
    if (!this.pitchSlots[value] || value === this.formation()) return;
    const previousSlots = this.slots();
    const orderedPlayers = previousSlots.map(slot => this.lineup()[slot.id]).filter((id): id is string => !!id);
    const nextLineup: Record<string, string> = {};
    const nextPositions = { ...this.shirtPositions() };
    this.pitchSlots[value].forEach((slot, index) => {
      const playerId = orderedPlayers[index];
      if (!playerId) return;
      nextLineup[slot.id] = playerId;
      nextPositions[playerId] = { x: slot.x, y: slot.y };
    });
    this.formation.set(value);
    this.lineup.set(nextLineup);
    this.shirtPositions.set(nextPositions);
    this.activeSlotId.set(null);
    void this.persistTacticalLayout();
  }

  protected assignPlayer(slotId: string, playerId: string): void {
    const targetSlot = this.slots().find(slot => slot.id === slotId);
    const targetPosition = targetSlot ? this.positionForSlot(targetSlot) : null;
    this.lineup.update(current => {
      const next = { ...current };
      for (const [key, value] of Object.entries(next)) if (value === playerId) delete next[key];
      if (playerId) next[slotId] = playerId;
      else delete next[slotId];
      return next;
    });
    if (playerId && targetPosition) this.shirtPositions.update(current => ({ ...current, [playerId]: targetPosition }));
    this.activeSlotId.set(null);
    void this.persistTacticalLayout();
  }

  protected togglePlayerPicker(slotId: string): void {
    this.activeSlotId.update(current => current === slotId ? null : slotId);
  }

  protected activeSlot() {
    return this.slots().find(slot => slot.id === this.activeSlotId());
  }

  protected closePlayerPicker(): void {
    this.activeSlotId.set(null);
  }

  protected positionForSlot(slot: { id: string; x: number; y: number }): { x: number; y: number } {
    const playerId = this.lineup()[slot.id];
    const candidate = playerId ? this.shirtPositions()[playerId] : undefined;
    const position = candidate && Number.isFinite(candidate.x) && Number.isFinite(candidate.y)
      && candidate.x >= 0 && candidate.x <= 100 && candidate.y >= 0 && candidate.y <= 100
      ? candidate : { x: slot.x, y: slot.y };
    // Ignore malformed or obsolete saved coordinates instead of rendering shirts at invalid positions.
    return { x: Math.max(9, Math.min(91, position.x)), y: Math.max(9, Math.min(91, position.y)) };
  }

  protected startDrag(event: PointerEvent, slotId: string): void {
    if (event.button !== 0) return;
    if (!this.lineup()[slotId]) return;
    this.dragSlotId = slotId;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  protected moveDrag(event: PointerEvent): void {
    if (!this.dragSlotId) return;
    const target = (event.currentTarget as HTMLElement).closest('.football-pitch') as HTMLElement | null;
    if (!target) return;
    const rect = target.getBoundingClientRect();
    const matrix = new DOMMatrix(getComputedStyle(target).transform);
    const local = new DOMPoint(
      event.clientX - (rect.left + rect.width / 2),
      event.clientY - (rect.top + rect.height / 2)
    ).matrixTransform(matrix.inverse());
    const x = Math.max(9, Math.min(91, ((local.x + target.offsetWidth / 2) / target.offsetWidth) * 100));
    const y = Math.max(9, Math.min(91, ((local.y + target.offsetHeight / 2) / target.offsetHeight) * 100));
    const playerId = this.lineup()[this.dragSlotId];
    if (!playerId) return;
    this.shirtPositions.update(current => ({ ...current, [playerId]: { x, y } }));
  }

  protected endDrag(): void {
    if (!this.dragSlotId) return;
    this.dragSlotId = null;
    void this.persistTacticalLayout();
  }

  protected optionsForSlot(slot: { id: string; role: string }): PlayerRecord[] {
    const selectedId = this.lineup()[slot.id] || '';
    const usedElsewhere = new Set(
      Object.entries(this.lineup())
        .filter(([key, id]) => key !== slot.id && id)
        .map(([, id]) => id)
    );

    // Show only players eligible for this role. Keep the current selection
    // visible in its own dropdown, but never offer a player used in another slot.
    return this.eligibleRosterForExpanded()
      .filter(player => this.playerHasRole(player, slot.role)
        && (!usedElsewhere.has(player.id) || player.id === selectedId))
      .sort((a, b) => (a.shirtNumber ?? 100) - (b.shirtNumber ?? 100)
        || a.lastName.localeCompare(b.lastName, 'it'));
  }

  private playerHasRole(player: PlayerRecord, role: string): boolean {
    return player.primaryRole === role || player.roles.includes(role as PlayerRecord['primaryRole']);
  }

  private autoArrange(): void {
    const remaining = [...this.eligibleRosterForExpanded()];
    const next: Record<string, string> = {};
    // Preserve every still-valid assignment first: adding a player must never
    // reshuffle shirts already positioned on the pitch.
    const validSlots = new Set(this.slots().map(slot => slot.id));
    const validPlayers = new Set(remaining.map(player => player.id));
    for (const [slotId, playerId] of Object.entries(this.lineup())) {
      if (validSlots.has(slotId) && validPlayers.has(playerId)) {
        next[slotId] = playerId;
        const index = remaining.findIndex(player => player.id === playerId);
        if (index >= 0) remaining.splice(index, 1);
      }
    }
    for (const slot of this.slots()) {
      const index = remaining.findIndex(player => this.playerHasRole(player, slot.role));
      // Never fill a position with an unrelated player: keep role-incompatible
      // players available for their correct position and manual selection.
      if (index >= 0) {
        const [player] = remaining.splice(index, 1);
        next[slot.id] = player.id;
      }
    }
    this.lineup.set(next);
  }

  protected rosterFor(team: TeamRecord): PlayerRecord[] {
    return this.players().filter((player) => !player.isArchived
      && player.teamId === team.id && player.seasonId === team.seasonId)
      .sort((a, b) => (a.shirtNumber ?? 100) - (b.shirtNumber ?? 100)
        || a.lastName.localeCompare(b.lastName, 'it'));
  }

  protected async toggleRoster(team: TeamRecord): Promise<void> {
    if (this.expandedRosterId() === team.id) {
      this.expandedRosterId.set(null);
      return;
    }
    this.expandedRosterId.set(team.id);
    this.lineup.set({});
    this.shirtPositions.set({});
    this.activeSlotId.set(null);
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.rosterLoading.set(true);
    try {
      const seasonId = team.seasonId;
      const preferredSlot = typeof localStorage !== 'undefined' && localStorage.getItem(this.layoutSlotStorageKey()) === '2' ? 2 : 1;
      this.layoutSlot.set(preferredSlot);
      const [loadedPlayers, saved, legacyCaptaincy] = await Promise.all([
        this.playerService.list(workspaceId, this.teams()),
        seasonId ? this.teamsService.loadTacticalLayout(workspaceId, team.id, seasonId, 1) : Promise.resolve(null),
        seasonId ? this.teamsService.loadCaptaincy(workspaceId, team.id, seasonId) : Promise.resolve({ captainId: '', viceCaptainId: '', updatedAtMs: 0 })
      ]);
      let players = loadedPlayers;
      // One-time migration: if squad members have no leadership flags yet,
      // copy the previous settings into the roster records.
      const teamPlayers = players.filter(player => !player.isArchived
        && player.teamId === team.id && player.seasonId === seasonId);
      const hasRosterLeadership = teamPlayers.some(player => player.isCaptain || player.isViceCaptain);
      if (!hasRosterLeadership) {
        let legacyCaptainId = legacyCaptaincy.captainId;
        let legacyViceCaptainId = legacyCaptaincy.viceCaptainId;
        // Recover selections made by the previous version even if their cloud
        // write did not complete: the old implementation kept a local backup.
        try {
          const cachedRaw = localStorage.getItem(`fsm-captaincy:${workspaceId}:${team.id}:${seasonId}`);
          if (cachedRaw) {
            const cached = JSON.parse(cachedRaw) as { captainId?: unknown; viceCaptainId?: unknown; savedAtMs?: unknown };
            if (typeof cached.captainId === 'string' && typeof cached.viceCaptainId === 'string'
              && typeof cached.savedAtMs === 'number' && cached.savedAtMs > legacyCaptaincy.updatedAtMs) {
              legacyCaptainId = cached.captainId;
              legacyViceCaptainId = cached.viceCaptainId;
            }
          }
        } catch (error) {
          console.warn('Unable to read previous local captaincy backup.', error);
        }
        if (legacyCaptainId || legacyViceCaptainId) {
          await this.teamsService.saveCaptaincy(workspaceId, team.id, seasonId!, legacyCaptainId, legacyViceCaptainId);
          players = await this.playerService.list(workspaceId, this.teams());
        }
      }
      this.players.set(players);
      const validPlayerIds = new Set(players.filter(player => !player.isArchived
        && player.teamId === team.id && player.seasonId === seasonId).map(player => player.id));
      const captain = players.find(player => player.teamId === team.id && player.seasonId === seasonId && player.isCaptain)?.id ?? '';
      const vice = players.find(player => player.teamId === team.id && player.seasonId === seasonId && player.isViceCaptain)?.id ?? '';
      this.captainId.set(validPlayerIds.has(captain) ? captain : '');
      this.viceCaptainId.set(validPlayerIds.has(vice) && vice !== captain ? vice : '');
      this.captaincySaveStatus.set('Ruoli letti dalla rosa');
      const formation = saved && this.formations.includes(saved.formation) ? saved.formation : '4-3-3';
      this.formation.set(formation);
      if (saved) {
        const validSlots = new Set(this.pitchSlots[formation].map(slot => slot.id));
        this.lineup.set(Object.fromEntries(Object.entries(saved.lineup)
          .filter(([slotId, playerId]) => validSlots.has(slotId) && validPlayerIds.has(playerId))));
        this.shirtPositions.set(saved.shirtPositions || {});
      } else {
        this.autoArrange();
        await this.persistTacticalLayout();
      }
    } catch (error) {
      console.error('Unable to load team roster.', error);
      this.error.set('Non è stato possibile caricare la rosa. Verifica la connessione e i permessi Firestore.');
    } finally {
      this.rosterLoading.set(false);
    }
  }

  private persistTacticalLayout(): Promise<void> {
    const team = this.teams().find(item => item.id === this.expandedRosterId());
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId || !team?.seasonId) return Promise.resolve();
    const snapshot = {
      formation: this.formation(),
      lineup: { ...this.lineup() },
      shirtPositions: { ...this.shirtPositions() }
    };
    this.layoutSaveQueue = this.layoutSaveQueue.then(async () => {
      this.layoutSaving.set(true);
      try {
        await this.teamsService.saveTacticalLayout(workspaceId, team.id, team.seasonId!, snapshot, this.layoutSlot());
      } catch (error) {
        console.error('Unable to save tactical layout.', error);
        this.error.set('Non è stato possibile salvare la disposizione della rosa. Riprova.');
      } finally {
        this.layoutSaving.set(false);
      }
    });
    return this.layoutSaveQueue;
  }

  protected onCategoryChange(category: string): void {
    this.form.category = category;
    const rules: Record<string, Partial<TeamInput>> = {
      'Juniores Under 19': { periodCount: 2, periodMinutes: 45, playersOnRoster: 20, federationReportRequired: false, playersOnField: 11, outfieldPlayersCount: 10, goalkeeperCount: 1, maxSubstitutions: 5, reentryAllowed: false, fixedPlayerCount: 11, allPlayersMustPlay: false },
      'Under 18': { periodCount: 2, periodMinutes: 45, playersOnRoster: 20, federationReportRequired: false, playersOnField: 11, outfieldPlayersCount: 10, goalkeeperCount: 1, maxSubstitutions: 5, reentryAllowed: false, fixedPlayerCount: 11, allPlayersMustPlay: false },
      'Allievi Under 17': { periodCount: 2, periodMinutes: 45, playersOnRoster: 20, federationReportRequired: false, playersOnField: 11, outfieldPlayersCount: 10, goalkeeperCount: 1, maxSubstitutions: 7, reentryAllowed: false, fixedPlayerCount: 11, allPlayersMustPlay: false },
      'Allievi B Under 16': { periodCount: 2, periodMinutes: 40, playersOnRoster: 20, federationReportRequired: false, playersOnField: 11, outfieldPlayersCount: 10, goalkeeperCount: 1, maxSubstitutions: 7, reentryAllowed: false, fixedPlayerCount: 11, allPlayersMustPlay: false },
      'Giovanissimi Under 15': { periodCount: 2, periodMinutes: 35, playersOnRoster: 20, federationReportRequired: false, playersOnField: 11, outfieldPlayersCount: 10, goalkeeperCount: 1, maxSubstitutions: 7, reentryAllowed: false, fixedPlayerCount: 11, allPlayersMustPlay: false },
      'Giovanissimi B Under 14': { periodCount: 2, periodMinutes: 35, playersOnRoster: 20, federationReportRequired: false, playersOnField: 11, outfieldPlayersCount: 10, goalkeeperCount: 1, maxSubstitutions: 7, reentryAllowed: false, fixedPlayerCount: 11, allPlayersMustPlay: false },
      'Esordienti II anno Under 13': { periodCount: 3, periodMinutes: 20, playersOnRoster: 18, federationReportRequired: true, playersOnField: 9, outfieldPlayersCount: 8, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 9, allPlayersMustPlay: true },
      'Esordienti I anno Under 12': { periodCount: 3, periodMinutes: 20, playersOnRoster: 18, federationReportRequired: true, playersOnField: 9, outfieldPlayersCount: 8, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 9, allPlayersMustPlay: true },
      'Pulcini II anno Under 11': { periodCount: 3, periodMinutes: 20, playersOnRoster: 14, federationReportRequired: false, playersOnField: 7, outfieldPlayersCount: 6, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 7, allPlayersMustPlay: true },
      'Pulcini I anno Under 10': { periodCount: 3, periodMinutes: 20, playersOnRoster: 14, federationReportRequired: false, playersOnField: 7, outfieldPlayersCount: 6, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 7, allPlayersMustPlay: true },
      'Primi Calci II anno Under 9': { periodCount: 3, periodMinutes: 20, playersOnRoster: 14, federationReportRequired: false, playersOnField: 7, outfieldPlayersCount: 6, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 7, allPlayersMustPlay: true },
      'Primi Calci I anno Under 8': { periodCount: 3, periodMinutes: 20, playersOnRoster: 14, federationReportRequired: false, playersOnField: 7, outfieldPlayersCount: 6, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 7, allPlayersMustPlay: true },
      'Piccoli Amici II anno Under 7': { periodCount: 3, periodMinutes: 20, playersOnRoster: 14, federationReportRequired: false, playersOnField: 7, outfieldPlayersCount: 6, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 7, allPlayersMustPlay: true },
      'Piccoli Amici I anno Under 6': { periodCount: 3, periodMinutes: 20, playersOnRoster: 14, federationReportRequired: false, playersOnField: 7, outfieldPlayersCount: 6, goalkeeperCount: 1, maxSubstitutions: null, reentryAllowed: true, fixedPlayerCount: 7, allPlayersMustPlay: true }
    };
    Object.assign(this.form, rules[category] ?? {});
  }

  protected openCreate(): void {
    this.formError.set('');
    this.editingId.set(null);
    this.formOpen.set(true);
    this.form = this.emptyForm();
    this.teamIconPreview.set('');
    this.teamIconUploadStatus.set('');
    this.error.set('');
    this.notice.set('');
  }

  protected openEdit(team: TeamRecord): void {
    this.formError.set('');
    this.editingId.set(team.id);
    this.formOpen.set(true);
    this.teamIconPreview.set('');
    this.form = {
      name: team.name,
      category: team.category,
      facilityName: team.facilityName || '',
      facilityAddress: team.facilityAddress || '',
      headquartersAddress: team.headquartersAddress || '',
      federationNumber: team.federationNumber || '',
      outfieldPlayersCount: team.outfieldPlayersCount ?? null,
      goalkeeperCount: team.goalkeeperCount ?? null,
      periodCount: team.periodCount ?? null,
      periodMinutes: team.periodMinutes ?? null,
      playersOnField: team.playersOnField ?? null,
      playersOnRoster: team.playersOnRoster ?? null,
      maxSubstitutions: team.maxSubstitutions ?? null,
      reentryAllowed: team.reentryAllowed ?? false,
      federationReportRequired: team.federationReportRequired ?? false,
      fixedPlayerCount: team.fixedPlayerCount ?? null,
      allPlayersMustPlay: team.allPlayersMustPlay ?? false,
      icon: team.icon || '⚽',
      seasonLabel: team.seasonLabel || '2026/2027'
    };
    this.teamIconUploadStatus.set('');
    this.error.set('');
    this.notice.set('');
  }

  protected cancelEdit(): void {
    this.formError.set('');
    this.editingId.set(null);
    this.formOpen.set(false);
    this.form = this.emptyForm();
    this.teamIconPreview.set('');
    this.teamIconUploadStatus.set('');
    this.error.set('');
  }

  protected async save(formEl?: HTMLElement): Promise<void> {
    this.formError.set('');
    clearFieldProblems(formEl);
    const problems: FieldProblem[] = [];
    const empty = 'Compila questo campo';
    if (!this.form.category?.trim()) problems.push({ field: 'category', label: 'Categoria', message: 'Seleziona la categoria' });
    if (!this.form.name.trim()) problems.push({ field: 'name', label: 'Nome squadra', message: empty });
    const season = this.form.seasonLabel.trim();
    const seasonMatch = /^([0-9]{4})\/([0-9]{4})$/.exec(season);
    if (!season) problems.push({ field: 'seasonLabel', label: 'Stagione sportiva', message: empty });
    else if (!seasonMatch || Number(seasonMatch[2]) !== Number(seasonMatch[1]) + 1) problems.push({ field: 'seasonLabel', label: 'Stagione sportiva', message: 'Scrivi la stagione così: 2026/2027' });
    if (problems.length) {
      showFieldProblems(formEl, problems);
      const names = problems.map(problem => problem.label).join(', ');
      this.formError.set(problems.length === 1 ? `${problems[0].label}: ${problems[0].message.toLowerCase()}.` : `Controlla i campi evidenziati: ${names}.`);
      this.notifications.notify({ title: problems.length === 1 && problems[0].message === empty ? empty : 'Controlla i campi evidenziati', message: names, type: 'warning', durationMs: 6000 });
      return;
    }
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) { this.formError.set('Sessione scaduta: esci e accedi di nuovo.'); return; }

    this.saving.set(true);
    this.error.set('');
    this.notice.set('');
    try {
      const existing = this.teams().find((team) => team.id === this.editingId());
      if (existing) {
        await this.teamsService.update(workspaceId, existing, this.form);
        this.notice.set('Squadra aggiornata.');
      } else {
        await this.teamsService.create(workspaceId, this.form);
        this.notice.set('Squadra creata correttamente.');
      }
      this.editingId.set(null);
      this.formOpen.set(false);
      this.form = this.emptyForm();
      this.teamIconPreview.set('');
      this.teamIconUploadStatus.set('');
      await this.loadTeams();
    } catch (error) {
      console.error('Unable to save team.', error);
      const message = 'Non è stato possibile salvare la squadra. Controlla la connessione a internet e riprova.';
      this.formError.set(message);
      this.notifications.notify({ title: 'Squadra non salvata', message, type: 'error', durationMs: 7000 });
    } finally {
      this.saving.set(false);
    }
  }


  protected async deleteTeam(team: TeamRecord): Promise<void> {
    const confirmed = await this.notifications.confirm({
      title: 'Eliminare definitivamente la squadra?',
      message: `Verranno eliminati "${team.name}", i giocatori associati, la rosa, le formazioni e i dati della partita salvati per questa squadra. L'operazione non è reversibile.`,
      confirmText: 'Elimina squadra', cancelText: 'Annulla', tone: 'danger'
    });
    if (!confirmed) return;
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.saving.set(true); this.error.set(''); this.notice.set('');
    try {
      await this.teamsService.deleteTeam(workspaceId, team);
      if (this.expandedRosterId() === team.id) {
        this.expandedRosterId.set(null); this.liveMatch.set(false);
        this.lineup.set({}); this.shirtPositions.set({});
        localStorage.removeItem('fsm-active-match-team');
      }
      this.notice.set('Squadra e giocatori associati eliminati definitivamente.');
      await this.loadTeams();
    } catch (error) {
      console.error('Unable to delete team.', error);
      this.error.set('Non è stato possibile eliminare la squadra. Riprova.');
    } finally { this.saving.set(false); }
  }

  protected async toggleArchive(team: TeamRecord): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    if (!team.isArchived) {
      const confirmed = await this.notifications.confirm({
        title: 'Archiviare questa squadra?',
        message: `La squadra «${team.name}» verrà archiviata e non sarà più disponibile per avviare una nuova partita. Potrai ripristinarla in seguito.`,
        confirmText: 'Archivia squadra', cancelText: 'Annulla', tone: 'default', icon: 'archive'
      });
      if (!confirmed) return;
    }

    try {
      await this.teamsService.setArchived(workspaceId, team, !team.isArchived);
      this.notice.set(team.isArchived ? 'Squadra ripristinata.' : 'Squadra archiviata.');
      await this.loadTeams();
    } catch (error) {
      console.error('Unable to archive team.', error);
      this.error.set('Non è stato possibile aggiornare la squadra.');
    }
  }

  protected async reload(): Promise<void> {
    await this.loadTeams();
  }

  private async loadTeams(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) {
      this.loading.set(false);
      return;
    }

    this.loading.set(true);
    try {
      this.teams.set(await this.teamsService.list(workspaceId));
      const resumeTeamId = this.resumeMatch ? localStorage.getItem('fsm-active-match-team') : null;
      if (resumeTeamId && !this.expandedRosterId()) {
        const resumeTeam = this.teams().find(item => item.id === resumeTeamId && !!item.seasonId);
        if (resumeTeam) {
          // A resumed match already contains its own lineup, formation and positions
          // in the live-match document. Load only its player records here; avoid
          // loading the separate tactical layout before mounting the match panel.
          this.expandedRosterId.set(resumeTeam.id);
          this.layoutSlot.set(1);
          this.rosterLoading.set(true);
          try {
            this.players.set(await this.playerService.list(workspaceId, this.teams()));
            this.liveMatch.set(true);
          } finally {
            this.rosterLoading.set(false);
          }
        } else {
          localStorage.removeItem('fsm-active-match-team');
          this.matchClosed.emit();
        }
      }
      if (this.expandedRosterId() && !this.liveMatch()) {
        this.players.set(await this.playerService.list(workspaceId, this.teams()));
      }
    } catch (error) {
      console.error('Unable to load teams.', error);
      this.error.set('Non è stato possibile caricare le squadre. Controlla i permessi Firestore.');
    } finally {
      this.loading.set(false);
    }
  }

  private emptyForm(): TeamInput {
    return { name: '', category: '', facilityName: '', facilityAddress: '', headquartersAddress: '', federationNumber: '', outfieldPlayersCount: null, goalkeeperCount: null, periodCount: null, periodMinutes: null, playersOnField: null, playersOnRoster: null, maxSubstitutions: null, reentryAllowed: false, federationReportRequired: false, fixedPlayerCount: null, allPlayersMustPlay: false, icon: '⚽', seasonLabel: '2026/2027' };
  }
}
