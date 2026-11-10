import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { TeamService, type TeamInput, type TeamRecord } from './team.service';

@Component({
  selector: 'fsm-teams-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './teams-page.component.html',
  styleUrl: './teams-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class TeamsPageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamsService = inject(TeamService);

  protected readonly teams = signal<TeamRecord[]>([]);
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
    const seasonMatch = /^(\\d{4})\\/(\\d{4})$/.exec(this.form.seasonLabel.trim());
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
