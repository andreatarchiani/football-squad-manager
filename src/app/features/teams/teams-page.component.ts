import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { TeamService, type TeamInput, type TeamRecord } from './team.service';
import { PlayerService, type PlayerRecord } from '../players/player.service';
import { LiveMatchComponent } from './live-match.component';

@Component({
  selector: 'fsm-teams-page',
  standalone: true,
  imports: [FormsModule, LiveMatchComponent],
  templateUrl: './teams-page.component.html',
  styleUrl: './teams-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TeamsPageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamsService = inject(TeamService);
  private readonly playerService = inject(PlayerService);

  protected readonly teams = signal<TeamRecord[]>([]);
  protected readonly players = signal<PlayerRecord[]>([]);
  protected readonly expandedRosterId = signal<string | null>(null);
  protected readonly rosterLoading = signal(false);
  protected readonly layoutSaving = signal(false);
  private layoutSaveQueue: Promise<void> = Promise.resolve();
  protected readonly formation = signal('4-3-3');
  protected readonly lineup = signal<Record<string, string>>({});
  protected readonly activeSlotId = signal<string | null>(null);
  protected readonly liveMatch = signal(false);
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
    void this.loadTeams();
  }

  protected get visibleTeams(): TeamRecord[] {
    return this.teams().filter((team) => this.showArchived() || !team.isArchived);
  }

  protected slots() { return this.pitchSlots[this.formation()]; }

  protected expandedTeamName(): string { return this.teams().find(team => team.id === this.expandedRosterId())?.name || 'Partita'; }
  protected startMatch(): void { this.activeSlotId.set(null); this.liveMatch.set(true); }
  protected closeMatch(): void { this.liveMatch.set(false); }

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

  protected changeFormation(value: string): void {
    this.formation.set(value);
    this.activeSlotId.set(null);
    this.lineup.update(current => Object.fromEntries(
      Object.entries(current).filter(([id]) => this.pitchSlots[value].some(slot => slot.id === id))
    ));
    void this.persistTacticalLayout();
  }

  protected assignPlayer(slotId: string, playerId: string): void {
    this.lineup.update(current => {
      const next = { ...current };
      for (const [key, value] of Object.entries(next)) if (value === playerId) delete next[key];
      if (playerId) next[slotId] = playerId;
      else delete next[slotId];
      return next;
    });
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
    return (playerId && this.shirtPositions()[playerId]) || { x: slot.x, y: slot.y };
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
    const x = Math.max(5, Math.min(95, ((local.x + target.offsetWidth / 2) / target.offsetWidth) * 100));
    const y = Math.max(4, Math.min(96, ((local.y + target.offsetHeight / 2) / target.offsetHeight) * 100));
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
      this.players.set(await this.playerService.list(workspaceId, this.teams()));
      const seasonId = team.seasonId;
      const saved = seasonId ? await this.teamsService.loadTacticalLayout(workspaceId, team.id, seasonId) : null;
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
        await this.teamsService.saveTacticalLayout(workspaceId, team.id, team.seasonId!, snapshot);
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

  protected async toggleArchive(team: TeamRecord): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;

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
      if (this.expandedRosterId()) {
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
