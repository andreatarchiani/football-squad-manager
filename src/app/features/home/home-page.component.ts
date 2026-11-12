import { ChangeDetectionStrategy, Component, EventEmitter, Output, effect, inject, signal } from '@angular/core';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { FIRESTORE_DB } from '../../core/firebase.tokens';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { PlayerService, type PlayerRecord } from '../players/player.service';

@Component({
  selector: 'fsm-home-page',
  standalone: true,
  templateUrl: './home-page.component.html',
  styleUrl: './home-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class HomePageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamsService = inject(TeamService);
  private readonly playerService = inject(PlayerService);
  private readonly db = inject(FIRESTORE_DB, { optional: true });
  @Output() readonly openTeams = new EventEmitter<void>();
  @Output() readonly launchMatch = new EventEmitter<{ teamId: string; layoutSlot: 1 | 2 }>();
  protected readonly teams = signal<TeamRecord[]>([]);
  protected readonly selectedTeamId = signal('');
  protected readonly teamDropdownOpen = signal(false);
  protected readonly accountRole = signal('Allenatore');
  protected readonly layoutSlot = signal<1 | 2>(1);
  protected readonly previewPlayers = signal<PlayerRecord[]>([]);
  protected readonly previewLineup = signal<Record<string, string>>({});
  protected readonly previewFormation = signal('4-3-3');
  protected readonly previewPositions = signal<Record<string, { x: number; y: number }>>({});
  protected readonly previewActiveSlotId = signal<string | null>(null);
  protected readonly previewSaving = signal(false);
  protected readonly previewLoading = signal(false);
  private previewPressTimer: ReturnType<typeof setTimeout> | null = null;
  private previewLongPressTriggered = false;
  private previewSaveQueue: Promise<void> = Promise.resolve();
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
  protected readonly error = signal('');
  protected readonly user = this.auth.user;
  protected readonly editingProfileName = signal(false);
  protected readonly profileNameDraft = signal('');
  protected readonly profileNameSaving = signal(false);
  private previewRequest = 0;
  private loadRequest = 0;

  private selectionStorageKey(uid: string): string { return `fsm-default-team-${uid}`; }

  constructor() { effect(() => { if (this.auth.workspaceId()) void this.load(); }); }

  protected get selectableTeams(): TeamRecord[] {
    return this.teams().filter(team => !team.isArchived);
  }

  protected get selectedTeam(): TeamRecord | undefined {
    const selectedId = this.selectedTeamId();
    if (!selectedId || this.selectableTeams.length === 0) return undefined;
    return this.selectableTeams.find(team => team.id === selectedId);
  }

  protected beginProfileNameEdit(): void {
    this.profileNameDraft.set(this.user()?.displayName || '');
    this.editingProfileName.set(true);
    this.error.set('');
  }

  protected cancelProfileNameEdit(): void {
    this.editingProfileName.set(false);
    this.profileNameDraft.set('');
  }

  protected async saveProfileName(): Promise<void> {
    const name = this.profileNameDraft().trim();
    if (!name) { this.error.set('Inserisci un nome valido.'); return; }
    this.profileNameSaving.set(true);
    this.error.set('');
    try {
      await this.auth.updateDisplayName(name);
      const uid = this.user()?.uid;
      if (uid && this.db) await setDoc(doc(this.db, 'userProfiles', uid), { displayName: name, updatedAt: new Date() }, { merge: true });
      this.editingProfileName.set(false);
      this.profileNameDraft.set('');
    } catch (error) {
      console.error('Unable to update profile name.', error);
      this.error.set('Non è stato possibile aggiornare il nome. Riprova.');
    } finally { this.profileNameSaving.set(false); }
  }

  protected async openTeam(teamId: string): Promise<void> {
    await this.selectTeam(teamId);
    this.openTeams.emit();
  }

  protected toggleTeamDropdown(): void { this.teamDropdownOpen.update(open => !open); }

  protected async selectTeam(teamId: string): Promise<void> {
    this.teamDropdownOpen.set(false);
    this.previewActiveSlotId.set(null);
    const validTeamId = this.selectableTeams.some(team => team.id === teamId) ? teamId : this.selectedTeamId();
    if (!validTeamId) return;
    this.selectedTeamId.set(validTeamId);
    const uid = this.user()?.uid;
    if (uid && typeof localStorage !== 'undefined') {
      localStorage.setItem(this.selectionStorageKey(uid), validTeamId);
    }
    void this.loadPreview();
    if (!uid || !this.db) return;
    this.saving.set(true);
    try { await setDoc(doc(this.db, 'userProfiles', uid), { defaultTeamId: validTeamId, updatedAt: new Date() }, { merge: true }); }
    catch (error) { console.error('Unable to save default team.', error); this.error.set('Non è stato possibile salvare la squadra predefinita.'); }
    finally { this.saving.set(false); }
  }

  protected async selectLayoutSlot(slot: 1 | 2): Promise<void> {
    this.layoutSlot.set(slot);
    await this.loadPreview();
  }

  protected previewPlayer(slotId: string): PlayerRecord | undefined {
    const id = this.previewLineup()[slotId];
    return this.previewPlayers().find(player => player.id === id);
  }

  protected previewPosition(slot: { id: string; x: number; y: number }): { x: number; y: number } {
    const player = this.previewPlayer(slot.id);
    const position = (player && this.previewPositions()[player.id]) || { x: slot.x, y: slot.y };
    return { x: Math.max(9, Math.min(91, position.x)), y: Math.max(9, Math.min(91, position.y)) };
  }

  protected startPreviewShirtPress(event: PointerEvent, slotId: string): void {
    if (event.button !== 0) return;
    this.previewLongPressTriggered = false;
    if (this.previewPressTimer) clearTimeout(this.previewPressTimer);
    this.previewPressTimer = setTimeout(() => {
      this.previewLongPressTriggered = true;
      this.previewActiveSlotId.set(slotId);
      this.previewPressTimer = null;
    }, 450);
  }

  protected endPreviewShirtPress(): void {
    if (this.previewPressTimer) clearTimeout(this.previewPressTimer);
    this.previewPressTimer = null;
  }

  protected openPreviewPlayerPicker(slotId: string): void {
    if (this.previewLongPressTriggered) { this.previewLongPressTriggered = false; return; }
    this.previewActiveSlotId.set(slotId);
  }

  protected closePreviewPlayerPicker(): void { this.previewActiveSlotId.set(null); }

  protected activePreviewSlot() {
    return (this.pitchSlots[this.previewFormation()] ?? []).find(slot => slot.id === this.previewActiveSlotId());
  }

  protected previewOptionsForSlot(slot: { id: string; role: string }): PlayerRecord[] {
    const selectedId = this.previewLineup()[slot.id] || '';
    const usedElsewhere = new Set(Object.entries(this.previewLineup()).filter(([id, playerId]) => id !== slot.id && playerId).map(([, playerId]) => playerId));
    return this.previewPlayers().filter(player =>
      (player.primaryRole === slot.role || player.roles.includes(slot.role as PlayerRecord['primaryRole']))
      && (!usedElsewhere.has(player.id) || player.id === selectedId)
    ).sort((a, b) => (a.shirtNumber ?? 100) - (b.shirtNumber ?? 100) || a.lastName.localeCompare(b.lastName, 'it'));
  }

  protected assignPreviewPlayer(slotId: string, playerId: string): void {
    this.previewLineup.update(current => {
      const next = { ...current };
      for (const [id, assignedId] of Object.entries(next)) if (assignedId === playerId) delete next[id];
      if (playerId) next[slotId] = playerId;
      else delete next[slotId];
      return next;
    });
    this.previewActiveSlotId.set(null);
    void this.persistPreviewLineup();
  }

  private async persistPreviewLineup(): Promise<void> {
    const team = this.selectedTeam;
    const workspaceId = this.auth.workspaceId();
    if (!team?.seasonId || !workspaceId) return;
    const layout = { formation: this.previewFormation(), lineup: { ...this.previewLineup() }, shirtPositions: { ...this.previewPositions() } };
    const slot = this.layoutSlot();
    this.previewSaving.set(true);
    const save = this.previewSaveQueue.then(async () => {
      try { await this.teamsService.saveTacticalLayout(workspaceId, team.id, team.seasonId!, layout, slot); }
      catch (error) {
        console.error('Unable to save home lineup.', error);
        this.error.set('Non è stato possibile salvare la modifica della rosa.');
      }
    });
    this.previewSaveQueue = save;
    await save;
    if (this.previewSaveQueue === save) this.previewSaving.set(false);
  }

  protected async saveRole(role: string): Promise<void> {
    this.accountRole.set(role);
    const uid = this.user()?.uid;
    if (!uid || !this.db) return;
    try { await setDoc(doc(this.db, 'userProfiles', uid), { accountRole: role, updatedAt: new Date() }, { merge: true }); }
    catch (error) { console.error('Unable to save account role.', error); this.error.set('Non è stato possibile salvare il tipo di profilo.'); }
  }

  protected start(): void {
    const team = this.selectedTeam;
    if (!team || team.isArchived || !team.seasonId) {
      this.error.set('Seleziona una squadra attiva con una stagione valida prima di avviare la partita.');
      return;
    }
    this.error.set('');
    this.launchMatch.emit({ teamId: team.id, layoutSlot: this.layoutSlot() });
  }

  private async loadPreview(): Promise<void> {
    const request = ++this.previewRequest;
    const team = this.selectedTeam;
    const workspaceId = this.auth.workspaceId();
    if (!team?.seasonId || !workspaceId) {
      this.previewPlayers.set([]);
      this.previewLineup.set({});
      this.previewPositions.set({});
      this.previewLoading.set(false);
      return;
    }
    this.previewLoading.set(true);
    try {
      const [players, saved] = await Promise.all([
        this.playerService.list(workspaceId, this.teams()),
        this.teamsService.loadTacticalLayout(workspaceId, team.id, team.seasonId, this.layoutSlot())
      ]);
      if (request !== this.previewRequest || this.selectedTeamId() !== team.id) return;
      this.previewPlayers.set(players.filter(player => !player.isArchived && player.status === 'active' && player.teamId === team.id && player.seasonId === team.seasonId));
      const formation = saved?.formation && ['4-3-3', '4-4-2', '3-5-2'].includes(saved.formation) ? saved.formation : '4-3-3';
      this.previewFormation.set(formation);
      const validSlots = new Set(this.pitchSlots[formation].map(slot => slot.id));
      const validPlayers = new Set(this.previewPlayers().map(player => player.id));
      this.previewLineup.set(Object.fromEntries(Object.entries(saved?.lineup ?? {}).filter(([slotId, playerId]) => validSlots.has(slotId) && validPlayers.has(playerId))));
      this.previewPositions.set(saved?.shirtPositions ?? {});
    } catch (error) {
      console.error('Unable to load home tactical preview.', error);
      this.error.set('Non è stato possibile caricare la formazione selezionata.');
    } finally { if (request === this.previewRequest) this.previewLoading.set(false); }
  }

  private async load(): Promise<void> {
    const request = ++this.loadRequest;
    const workspaceId = this.auth.workspaceId();
    const uid = this.user()?.uid;
    if (!workspaceId) return;
    try {
      const [teams, profile] = await Promise.all([
        this.teamsService.list(workspaceId),
        uid && this.db ? getDoc(doc(this.db, 'userProfiles', uid)) : Promise.resolve(null)
      ]);
      if (request !== this.loadRequest || workspaceId !== this.auth.workspaceId() || uid !== this.user()?.uid) return;
      this.teams.set(teams);
      const data = profile?.exists() ? profile.data() : {};
      const role = String(data?.['accountRole'] ?? 'Allenatore');
      this.accountRole.set(['Società', 'Allenatore', 'Collaboratore', 'Altro'].includes(role) ? role : 'Allenatore');
      const savedPreference = String(data?.['defaultTeamId'] ?? '');
      const localPreference = uid && typeof localStorage !== 'undefined' ? localStorage.getItem(this.selectionStorageKey(uid)) ?? '' : '';
      const isSelectable = (id: string) => teams.some(team => team.id === id && !team.isArchived);
      const selected = isSelectable(savedPreference)
        ? savedPreference
        : isSelectable(localPreference)
          ? localPreference
          : teams.filter(team => !team.isArchived)[Math.floor(Math.random() * teams.filter(team => !team.isArchived).length)]?.id ?? '';
      this.selectedTeamId.set(selected);
      if (uid && typeof localStorage !== 'undefined') {
        if (selected) localStorage.setItem(this.selectionStorageKey(uid), selected);
        else localStorage.removeItem(this.selectionStorageKey(uid));
      }
      if (selected && selected !== savedPreference && uid && this.db) {
        try { await setDoc(doc(this.db, 'userProfiles', uid), { defaultTeamId: selected, updatedAt: new Date() }, { merge: true }); }
        catch (error) { console.error('Unable to save automatically selected team.', error); }
      }
      await this.loadPreview();
    } catch (error) {
      console.error('Unable to load home workspace.', error);
      this.error.set('Non è stato possibile caricare i dati del tuo account e delle squadre.');
    } finally { if (request === this.loadRequest) this.loading.set(false); }
  }
}
