import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
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
  // This gate changes presentation only. Future ticket APIs must validate the Firebase ID token server-side.
  protected readonly isSupportAccount = computed(() =>
    this.auth.user()?.email?.trim().toLowerCase() === 'squadmanagersupport@gmail.com'
  );
  protected readonly supportFilter = signal<'all' | 'new' | 'progress' | 'resolved'>('all');
  protected readonly supportSearch = signal('');
  protected updateSupportSearch(event: Event): void {
    this.supportSearch.set((event.target as HTMLInputElement).value);
  }
  protected selectSupportFilter(value: 'all' | 'new' | 'progress' | 'resolved'): void {
    this.supportFilter.set(value);
  }

  protected readonly navigation = ['Home', 'Squadre', 'Giocatori', 'Formazioni', 'Partite'];
  protected readonly activePage = signal<'overview' | 'teams' | 'players' | 'match'>(typeof localStorage !== 'undefined' && !!localStorage.getItem('fsm-active-match-team') ? 'match' : 'overview');
  protected readonly matchLaunch = signal<{ team: TeamRecord; players: PlayerRecord[]; lineup: Record<string, string>; formation: string; positions: Record<string, { x: number; y: number }>; layoutSlot: 1 | 2; opponentName: string; token: number } | null>(null);
  protected readonly rosterRequest = signal<{ teamId: string; layoutSlot: 1 | 2; token: number } | null>(null);
  protected readonly updateAvailable = signal(false);
  protected readonly bugReportOpen = signal(false);
  protected readonly bugReportText = signal('');
  protected readonly releaseChangelogOpen = signal(false);
  private readonly releaseChangelogStorageKey = 'fsm-pending-release-changelog';
  protected readonly releaseVersion = 'v0.10';
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
        if (event.type === 'VERSION_READY') {
          // Keep the update pending until the user explicitly taps “Aggiorna ora”.
          this.updateAvailable.set(true);
        } else if (event.type === 'VERSION_INSTALLATION_FAILED') {
          console.error('Application update installation failed.', event.error);
          this.updateAvailable.set(true);
        }
      });
      void this.checkForUpdate();
      interval(5 * 60 * 1000).subscribe(() => void this.checkForUpdate());
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
      this.updateAvailable.set(true);
    }
  }

  protected readonly bugReportFiles = signal<File[]>([]);
  protected readonly bugReportFileError = signal('');
  protected readonly bugReportSending = signal(false);
  private readonly bugReportRecipient = 'squadmanagersupport@gmail.com';
  private readonly bugReportMaxBytes = 15 * 1024 * 1024;

  protected openBugReport(): void {
    this.bugReportText.set('');
    this.bugReportFiles.set([]);
    this.bugReportFileError.set('');
    this.bugReportOpen.set(true);
  }

  protected closeBugReport(): void {
    if (this.bugReportSending()) return;
    this.bugReportOpen.set(false);
  }

  protected updateBugReportText(event: Event): void {
    this.bugReportText.set((event.target as HTMLTextAreaElement).value);
  }

  protected formatBugReportFileSize(bytes: number): string {
    return bytes >= 1024 * 1024
      ? `${(bytes / (1024 * 1024)).toFixed(1)} MB`
      : `${Math.max(1, Math.ceil(bytes / 1024))} KB`;
  }

  protected updateBugReportFiles(event: Event): void {
    const input = event.target as HTMLInputElement;
    const incoming = Array.from(input.files ?? []);
    input.value = '';
    if (!incoming.length) return;

    const current = this.bugReportFiles();
    const allowed = incoming.filter(file => file.type.startsWith('image/') || file.type.startsWith('video/'));
    if (allowed.length !== incoming.length) {
      this.bugReportFileError.set('Puoi allegare solamente immagini o video.');
      return;
    }
    const selected = [...current, ...allowed];
    const total = selected.reduce((sum, file) => sum + file.size, 0);
    if (total > this.bugReportMaxBytes) {
      this.bugReportFileError.set('Gli allegati non possono superare 15 MB complessivi.');
      return;
    }
    this.bugReportFiles.set(selected);
    this.bugReportFileError.set('');
  }

  protected removeBugReportFile(index: number): void {
    this.bugReportFiles.update(files => files.filter((_, position) => position !== index));
    this.bugReportFileError.set('');
  }

  private getBugReportBody(description: string): string {
    const user = this.auth.user();
    return [
      'Ciao,',
      '',
      'vorrei segnalare il seguente problema:',
      description,
      '',
      '---',
      `Account: ${user?.displayName || user?.email || 'non disponibile'}`,
      `Pagina: ${this.activePage()}`,
      `Data: ${new Date().toLocaleString('it-IT')}`,
      `Browser: ${navigator.userAgent}`
    ].join('\n');
  }

  private async fileAsBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    }
    return btoa(binary).replace(/.{1,76}/g, '$&\r\n').trimEnd();
  }

  protected async sendBugReport(): Promise<void> {
    const description = this.bugReportText().trim();
    if (!description || this.bugReportSending()) return;

    const subject = 'Segnalazione bug - Football Squad Manager';
    const body = this.getBugReportBody(description);
    const files = this.bugReportFiles();

    if (!files.length) {
      window.location.href = `mailto:${this.bugReportRecipient}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
      return;
    }

    this.bugReportSending.set(true);
    this.bugReportFileError.set('');
    try {
      // mailto: cannot attach files. An RFC 822 email draft preserves the actual
      // attachments and recipient without requiring an email backend.
      const boundary = `fsm-bug-${Date.now()}`;
      const lines = [
        `To: ${this.bugReportRecipient}`,
        `Subject: ${subject}`,
        'MIME-Version: 1.0',
        `Content-Type: multipart/mixed; boundary="${boundary}"`,
        '',
        `--${boundary}`,
        'Content-Type: text/plain; charset=UTF-8',
        'Content-Transfer-Encoding: base64',
        '',
        this.encodeBugReportText(body),
        ''
      ];
      for (const file of files) {
        const safeName = file.name.replace(/[\r\n"\\]/g, '_');
        const asciiName = safeName.replace(/[^\x20-\x7E]/g, '_');
        lines.push(
          `--${boundary}`,
          `Content-Type: ${file.type}; name="${asciiName}"`,
          `Content-Disposition: attachment; filename="${asciiName}"`,
          'Content-Transfer-Encoding: base64',
          '',
          await this.fileAsBase64(file),
          ''
        );
      }
      lines.push(`--${boundary}--`, '');
      const draft = new Blob([lines.join('\r\n')], { type: 'message/rfc822' });
      const url = URL.createObjectURL(draft);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'segnalazione-bug.eml';
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
      this.notifications.notify({
        title: 'Email con allegati preparata',
        message: 'Apri il file .eml scaricato nell’app email e premi Invia.',
        type: 'success',
        durationMs: 8000
      });
    } catch (error) {
      console.error('Unable to prepare bug report attachments', error);
      this.bugReportFileError.set('Impossibile preparare gli allegati. Riprova.');
    } finally {
      this.bugReportSending.set(false);
    }
  }

  private encodeBugReportText(value: string): string {
    const bytes = new TextEncoder().encode(value);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/.{1,76}/g, '$&\r\n').trimEnd();
  }

  protected closeReleaseChangelog(): void { this.releaseChangelogOpen.set(false); }

  private async checkForUpdate(): Promise<void> {
    try {
      await this.swUpdate.checkForUpdate();
    } catch (error) {
      console.warn('Application update check failed.', error);
    }
  }

  protected launchMatch(request: { team: TeamRecord; players: PlayerRecord[]; lineup: Record<string, string>; formation: string; positions: Record<string, { x: number; y: number }>; layoutSlot: 1 | 2; opponentName: string }): void {
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
