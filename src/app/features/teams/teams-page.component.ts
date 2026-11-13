import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { TeamService, type TeamInput, type TeamRecord } from './team.service';
import { PlayerService, type PlayerRecord } from '../players/player.service';
import { NotificationService } from '../../core/notifications/notification.service';
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
  @Input() launchRequest: { team: TeamRecord; players: PlayerRecord[]; lineup: Record<string, string>; formation: string; positions: Record<string, { x: number; y: number }>; layoutSlot: 1 | 2; token: number } | null = null;
  @Input() rosterRequest: { teamId: string; layoutSlot: 1 | 2; token: number } | null = null;
  @Input() resumeMatch = false;
  @Output() readonly matchClosed = new EventEmitter<void>();
  private handledLaunchToken = 0;
  private handledRosterToken = 0;
  private teamsLoadPromise: Promise<void> = Promise.resolve();
  protected readonly layoutSlot = signal<1 | 2>(1);
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
  protected readonly activeSlotId = signal<string | null>(null);
  protected readonly liveMatch = signal(false);
  protected readonly autoStartMatch = signal(false);
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
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly formOpen = signal(false);
  protected form: TeamInput = this.emptyForm();

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
    return this.teams().filter((team) => this.showArchived() || !team.isArchived);
  }

  protected slots() { return this.pitchSlots[this.formation()]; }

  protected expandedTeamName(): string { return this.teams().find(team => team.id === this.expandedRosterId())?.name || 'Partita'; }
  private async openRequestedRoster(request: NonNullable<TeamsPageComponent['rosterRequest']>): Promise<void> {
    await this.teamsLoadPromise;
    const team = this.teams().find(item => item.id === request.teamId && !item.isArchived);
    if (!team) { this.error.set('La squadra selezionata non è disponibile.'); return; }
    this.liveMatch.set(false);
    this.autoStartMatch.set(false);
    if (this.expandedRosterId() !== team.id) await this.toggleRoster(team);
    if (request.layoutSlot !== this.layoutSlot()) await this.selectLayoutSlot(request.layoutSlot);
    await new Promise<void>(resolve => setTimeout(resolve, 120));
    const rosterPanel = Array.from(document.querySelectorAll<HTMLElement>('[data-roster-team]'))
      .find(element => element.dataset['rosterTeam'] === team.id);
    rosterPanel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  private launchFromHome(request: NonNullable<TeamsPageComponent['launchRequest']>): void {
    const team = request.team;
    if (team.isArchived || !team.seasonId) { this.error.set('La squadra selezionata non è disponibile.'); return; }
    if (!this.teams().some(item => item.id === team.id)) this.teams.update(items => [...items, team]);
    this.players.set([...request.players]);
    this.expandedRosterId.set(team.id);
    this.layoutSlot.set(request.layoutSlot);
    this.activeSlotId.set(null);
    this.rosterLoading.set(false);
    this.error.set('');
    this.formation.set(this.formations.includes(request.formation) ? request.formation : '4-3-3');
    this.lineup.set({ ...request.lineup });
    this.shirtPositions.set({ ...request.positions });
    this.autoStartMatch.set(true);
    localStorage.setItem('fsm-active-match-team', team.id);
    // Show the match panel immediately; the live-match component starts its clock
    // before performing any asynchronous persistence.
    this.liveMatch.set(true);
  }
  protected closeMatch(): void { this.liveMatch.set(false); this.autoStartMatch.set(false); localStorage.removeItem('fsm-active-match-team'); this.matchClosed.emit(); }

  protected playerForSlot(slotId: string): PlayerRecord | undefined {
    return this.rosterForExpanded().find(player => player.id === this.lineup()[slotId]);
  }

  protected rosterForExpanded(): PlayerRecord[] {
    const team = this.teams().find(item => item.id === this.expandedRosterId());
    return team ? this.rosterFor(team).filter(player => player.status === 'active') : [];
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
    const saved = await this.teamsService.loadTacticalLayout(workspaceId, team.id, team.seasonId, slot);
    const validIds = new Set(this.rosterForExpanded().map(player => player.id));
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
    const position = (playerId && this.shirtPositions()[playerId]) || { x: slot.x, y: slot.y };
    // Keep the full shirt and name tag inside the pitch, including older saved layouts.
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
    return this.rosterForExpanded()
      .filter(player => this.playerHasRole(player, slot.role)
        && (!usedElsewhere.has(player.id) || player.id === selectedId))
      .sort((a, b) => (a.shirtNumber ?? 100) - (b.shirtNumber ?? 100)
        || a.lastName.localeCompare(b.lastName, 'it'));
  }

  private playerHasRole(player: PlayerRecord, role: string): boolean {
    return player.primaryRole === role || player.roles.includes(role as PlayerRecord['primaryRole']);
  }

  private autoArrange(): void {
    const remaining = [...this.rosterForExpanded()];
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
      this.layoutSlot.set(1);
      const [players, saved] = await Promise.all([
        this.playerService.list(workspaceId, this.teams()),
        seasonId ? this.teamsService.loadTacticalLayout(workspaceId, team.id, seasonId, 1) : Promise.resolve(null)
      ]);
      this.players.set(players);
      const validPlayerIds = new Set(this.rosterForExpanded().map(player => player.id));
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

  protected openCreate(): void {
    this.editingId.set(null);
    this.formOpen.set(true);
    this.form = this.emptyForm();
    this.error.set('');
    this.notice.set('');
  }

  protected openEdit(team: TeamRecord): void {
    this.editingId.set(team.id);
    this.formOpen.set(true);
    this.form = {
      name: team.name,
      category: team.category,
      clubName: team.clubName,
      seasonLabel: team.seasonLabel || '2026/2027'
    };
    this.error.set('');
    this.notice.set('');
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
    this.formOpen.set(false);
    this.form = this.emptyForm();
    this.error.set('');
  }

  protected async save(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const seasonMatch = /^([0-9]{4})\/([0-9]{4})$/.exec(this.form.seasonLabel.trim());
    if (!workspaceId || !this.form.name.trim() || !seasonMatch
      || Number(seasonMatch[2]) !== Number(seasonMatch[1]) + 1) {
      this.error.set('Inserisci il nome della squadra e una stagione valida nel formato 2026/2027.');
      return;
    }

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
      await this.loadTeams();
    } catch (error) {
      console.error('Unable to save team.', error);
      this.error.set('Non è stato possibile salvare la squadra. Verifica la connessione e i permessi Firestore.');
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
    return { name: '', category: '', clubName: '', seasonLabel: '2026/2027' };
  }
}
