import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { SwUpdate } from '@angular/service-worker';
import { interval } from 'rxjs';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FirebaseAuthService } from './core/firebase-auth.service';
import { NotificationService } from './core/notifications/notification.service';
import { NotificationHostComponent } from './core/notifications/notification-host.component';
import { AuthPageComponent } from './features/auth/auth-page.component';
import { TeamsPageComponent } from './features/teams/teams-page.component';
import { PlayersPageComponent } from './features/players/players-page.component';
import { VoiceAssistantComponent } from './features/voice-assistant/voice-assistant.component';
import { HomePageComponent } from './features/home/home-page.component';
import type { TeamRecord } from './features/teams/team.service';
import type { PlayerRecord } from './features/players/player.service';

@Component({
  selector: 'fsm-root',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, AuthPageComponent, TeamsPageComponent, PlayersPageComponent, VoiceAssistantComponent, HomePageComponent, NotificationHostComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  protected readonly navigation = ['Home', 'Squadre', 'Giocatori', 'Formazioni', 'Partite'];
  protected readonly activePage = signal<'overview' | 'teams' | 'players' | 'match'>(typeof localStorage !== 'undefined' && !!localStorage.getItem('fsm-active-match-team') ? 'match' : 'overview');
  protected readonly matchLaunch = signal<{ team: TeamRecord; players: PlayerRecord[]; lineup: Record<string, string>; formation: string; positions: Record<string, { x: number; y: number }>; layoutSlot: 1 | 2; token: number } | null>(null);
  protected readonly rosterRequest = signal<{ teamId: string; layoutSlot: 1 | 2; token: number } | null>(null);
  protected readonly updateAvailable = signal(false);
  protected readonly releaseChangelogOpen = signal(false);
  private readonly releaseChangelogStorageKey = 'fsm-pending-release-changelog';
  protected readonly releaseVersion = 'v0.6';
  protected readonly updating = signal(false);
  protected readonly loadingMinimumElapsed = signal(false);
  private readonly swUpdate = inject(SwUpdate);
  private readonly notifications = inject(NotificationService);

  constructor() {
    if (localStorage.getItem(this.releaseChangelogStorageKey) === this.releaseVersion) {
      localStorage.removeItem(this.releaseChangelogStorageKey);
      this.releaseChangelogOpen.set(true);
    }
    window.setTimeout(() => this.loadingMinimumElapsed.set(true), 2500);
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((event) => {
        if (event.type === 'VERSION_READY') void this.activateReadyVersion();
      });
      void this.checkForUpdate();
      interval(5 * 60 * 1000).subscribe(() => void this.checkForUpdate());
    }
  }

  private async activateReadyVersion(): Promise<void> {
    if (!this.swUpdate.isEnabled || this.updating()) return;
    this.updating.set(true);
    try {
      await this.swUpdate.activateUpdate();
      localStorage.setItem(this.releaseChangelogStorageKey, this.releaseVersion);
      window.location.reload();
    } catch (error) {
      console.error('Unable to activate application update.', error);
      localStorage.removeItem(this.releaseChangelogStorageKey);
      this.updating.set(false);
      this.updateAvailable.set(true);
    }
  }

  protected async applyUpdate(): Promise<void> {
    if (!this.swUpdate.isEnabled || this.updating()) return;
    this.updating.set(true);
    try {
      await this.swUpdate.activateUpdate();
      localStorage.setItem(this.releaseChangelogStorageKey, this.releaseVersion);
      window.location.reload();
    } catch (error) {
      console.error('Unable to activate application update.', error);
      localStorage.removeItem(this.releaseChangelogStorageKey);
      this.updating.set(false);
    }
  }

  protected closeReleaseChangelog(): void { this.releaseChangelogOpen.set(false); }

  private async checkForUpdate(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch (error) {
      console.warn('Application update check failed.', error);
    }
  }

  protected launchMatch(request: { team: TeamRecord; players: PlayerRecord[]; lineup: Record<string, string>; formation: string; positions: Record<string, { x: number; y: number }>; layoutSlot: 1 | 2 }): void {
    this.rosterRequest.set(null);
    this.matchLaunch.set({ ...request, token: Date.now() });
    this.activePage.set('match');
  }

  protected returnHomeAfterMatch(): void { this.matchLaunch.set(null); this.activePage.set('overview'); }

  protected openTeamRoster(request: { teamId: string; layoutSlot: 1 | 2 }): void {
    this.matchLaunch.set(null);
    if (!request.teamId) { this.rosterRequest.set(null); this.activePage.set('teams'); return; }
    this.rosterRequest.set({ ...request, token: Date.now() });
    this.activePage.set('teams');
  }

  protected navigate(index: number): void {
    if (index === 0) this.activePage.set('overview');
    if (index === 1) { this.matchLaunch.set(null); this.rosterRequest.set(null); this.activePage.set('teams'); }
    if (index === 2) this.activePage.set('players');
  }

  protected readonly auth = inject(FirebaseAuthService);

  protected async signOut(): Promise<void> {
    const confirmed = await this.notifications.confirm({
      title: 'Vuoi davvero fare il logout?',
      message: 'Dovrai accedere nuovamente per continuare a gestire la tua squadra.',
      confirmText: 'Logout',
      cancelText: 'Annulla',
      tone: 'danger'
    });

    if (!confirmed) return;

    try {
      await this.auth.signOut();
      this.notifications.notify({
        title: 'Logout effettuato',
        message: 'Hai disconnesso il tuo account.',
        type: 'success'
      });
    } catch (error) {
      console.error('Unable to sign out.', error);
      this.notifications.notify({
        title: 'Logout non riuscito',
        message: 'Non è stato possibile uscire. Riprova.',
        type: 'error',
        durationMs: 6000
      });
    }
  }
}
