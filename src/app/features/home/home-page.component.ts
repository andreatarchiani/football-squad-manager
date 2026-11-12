import { ChangeDetectionStrategy, Component, EventEmitter, Output, effect, inject, signal } from '@angular/core';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { FIRESTORE_DB } from '../../core/firebase.tokens';
import { TeamService, type TeamRecord } from '../teams/team.service';

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
  private readonly db = inject(FIRESTORE_DB, { optional: true });
  @Output() readonly openTeams = new EventEmitter<void>();
  @Output() readonly launchMatch = new EventEmitter<{ teamId: string; layoutSlot: 1 | 2 }>();
  protected readonly teams = signal<TeamRecord[]>([]);
  protected readonly selectedTeamId = signal('');
  protected readonly accountRole = signal('Allenatore');
  protected readonly layoutSlot = signal<1 | 2>(1);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly user = this.auth.user;

  constructor() { effect(() => { if (this.auth.workspaceId()) void this.load(); }); }

  protected get selectedTeam(): TeamRecord | undefined {
    return this.teams().find(team => team.id === this.selectedTeamId());
  }

  protected async openTeam(teamId: string): Promise<void> {
    await this.selectTeam(teamId);
    this.openTeams.emit();
  }

  protected async selectTeam(teamId: string): Promise<void> {
    this.selectedTeamId.set(teamId);
    const uid = this.user()?.uid;
    if (!uid || !this.db) return;
    this.saving.set(true);
    try { await setDoc(doc(this.db, 'userProfiles', uid), { defaultTeamId: teamId, updatedAt: new Date() }, { merge: true }); }
    catch (error) { console.error('Unable to save default team.', error); this.error.set('Non è stato possibile salvare la squadra predefinita.'); }
    finally { this.saving.set(false); }
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

  private async load(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const uid = this.user()?.uid;
    if (!workspaceId) return;
    try {
      const [teams, profile] = await Promise.all([
        this.teamsService.list(workspaceId),
        uid && this.db ? getDoc(doc(this.db, 'userProfiles', uid)) : Promise.resolve(null)
      ]);
      this.teams.set(teams);
      const data = profile?.exists() ? profile.data() : {};
      const role = String(data?.['accountRole'] ?? 'Allenatore');
      this.accountRole.set(['Società', 'Allenatore', 'Collaboratore', 'Altro'].includes(role) ? role : 'Allenatore');
      const preferred = String(data?.['defaultTeamId'] ?? '');
      const selected = teams.some(team => team.id === preferred && !team.isArchived) ? preferred : (teams.find(team => !team.isArchived)?.id ?? '');
      this.selectedTeamId.set(selected);
      if (!preferred && selected) await this.selectTeam(selected);
    } catch (error) {
      console.error('Unable to load home workspace.', error);
      this.error.set('Non è stato possibile caricare i dati del tuo account e delle squadre.');
    } finally { this.loading.set(false); }
  }
}
