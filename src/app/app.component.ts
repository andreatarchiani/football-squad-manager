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

@Component({
  selector: 'fsm-root',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, AuthPageComponent, TeamsPageComponent, PlayersPageComponent, VoiceAssistantComponent, NotificationHostComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  protected readonly navigation = ['Panoramica', 'Squadre', 'Giocatori', 'Formazioni', 'Partite'];
  protected readonly activePage = signal<'overview' | 'teams' | 'players'>(typeof localStorage !== 'undefined' && !!localStorage.getItem('fsm-active-match-team') ? 'teams' : 'overview');
  protected readonly updateAvailable = signal(false);
  protected readonly updating = signal(false);
  private readonly swUpdate = inject(SwUpdate);
  private readonly notifications = inject(NotificationService);

  constructor() {
    if (this.swUpdate.isEnabled) {
      this.swUpdate.versionUpdates.subscribe((event) => {
        if (event.type === 'VERSION_READY') this.updateAvailable.set(true);
      });
      void this.checkForUpdate();
      interval(6 * 60 * 60 * 1000).subscribe(() => void this.checkForUpdate());
    }
  }

  protected async applyUpdate(): Promise<void> {
    if (!this.swUpdate.isEnabled || this.updating()) return;
    this.updating.set(true);
    try {
      await this.swUpdate.activateUpdate();
      window.location.reload();
    } catch (error) {
      console.error('Unable to activate application update.', error);
      this.updating.set(false);
    }
  }

  private async checkForUpdate(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch (error) {
      console.warn('Application update check failed.', error);
    }
  }

  protected navigate(index: number): void {
    if (index === 0) this.activePage.set('overview');
    if (index === 1) this.activePage.set('teams');
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
