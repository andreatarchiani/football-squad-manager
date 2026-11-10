import { Injectable, inject } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { TeamService, type TeamInput } from '../teams/team.service';

@Injectable({ providedIn: 'root' })
export class VoiceCommandExecutor {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teams = inject(TeamService);

  async createTeam(input: TeamInput): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) throw new Error('Lo spazio di lavoro non è disponibile. Ricarica la pagina e riprova.');
    if (!input.name.trim()) throw new Error('Il nome della squadra è obbligatorio.');
    const match = /^([0-9]{4})\/([0-9]{4})$/.exec(input.seasonLabel.trim());
    if (!match || Number(match[2]) !== Number(match[1]) + 1) {
      throw new Error('La stagione sportiva non è valida.');
    }
    await this.teams.create(workspaceId, input);
  }
}
