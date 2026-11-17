import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
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
import { environment } from '../environments/environment';

type SupportStatus = 'new' | 'progress' | 'resolved';
interface SupportAttachment { id: number; name: string; type: string; size: number; }
interface SupportTicket { id: number; authorEmail: string; authorName: string; description: string; page: string; browser: string; status: SupportStatus; createdAt: string; updatedAt: string; attachments: SupportAttachment[]; }


@Component({
  selector: 'fsm-root',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, AuthPageComponent, TeamsPageComponent, PlayersPageComponent, VoiceAssistantComponent, HomePageComponent, NotificationHostComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  // This gate changes presentation only. Future ticket APIs must validate the Firebase ID token server-side.
  protected readonly isSupportAccount = computed(() =>
    this.auth.user()?.email?.trim().toLowerCase() === 'squadmanagersupport@gmail.com'
  );
  protected readonly supportFilter = signal<'all' | SupportStatus>('all');
  protected readonly supportSearch = signal('');
  protected readonly supportTickets = signal<SupportTicket[]>([]);
  protected readonly supportLoading = signal(false);
  protected readonly supportError = signal('');
  protected readonly supportSelectedTicket = signal<number | null>(null);
  protected readonly selectedTicket = computed(() => this.supportTickets().find(ticket => ticket.id === this.supportSelectedTicket()) ?? null);
  protected readonly supportCounters = computed(() => ({
    all: this.supportTickets().length,
    new: this.supportTickets().filter(ticket => ticket.status === 'new').length,
    progress: this.supportTickets().filter(ticket => ticket.status === 'progress').length,
    resolved: this.supportTickets().filter(ticket => ticket.status === 'resolved').length
  }));
  protected readonly filteredTickets = computed(() => {
    const search = this.supportSearch().trim().toLowerCase();
    return this.supportTickets().filter(ticket =>
      (this.supportFilter() === 'all' || ticket.status === this.supportFilter())
      && (!search || [ticket.description, ticket.authorEmail, ticket.authorName, String(ticket.id)].some(part => part.toLowerCase().includes(search)))
    );
  });
  protected updateSupportSearch(event: Event): void {
    this.supportSearch.set((event.target as HTMLInputElement).value);
  }
  protected selectSupportFilter(value: 'all' | SupportStatus): void { this.supportFilter.set(value); }
  protected selectSupportTicket(id: number): void { this.supportSelectedTicket.set(id); }
  protected closeSupportTicket(): void { this.supportSelectedTicket.set(null); }

  private supportApiEndpoint(path: string): string {
    const base = environment.supportApiUrl.trim().replace(/\\/$/, '');
    if (!base) throw new Error('Il server delle segnalazioni non è ancora configurato.');
    return `${base}/api/support/${path}`;
  }
  private async supportRequest(path: string, method = 'GET', body?: unknown): Promise<Response> {
    const user = this.auth.user();
    if (!user) throw new Error('Devi accedere per continuare.');
    const token = await user.getIdToken();
    const response = await fetch(this.supportApiEndpoint(path), {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      cache: 'no-store'
    });
    if (!response.ok) {
      let message = 'Impossibile contattare il servizio segnalazioni.';
      try { const detail = await response.json(); if (typeof detail.error === 'string') message = detail.error; } catch {}
      throw new Error(message);
    }
    return response;
  }
  protected async loadSupportTickets(): Promise<void> {
    if (!this.isSupportAccount() || this.supportLoading()) return;
    this.supportLoading.set(true);
    this.supportError.set('');
    try {
      const response = await this.supportRequest('tickets');
      const data = await response.json() as { tickets: SupportTicket[] };
      this.supportTickets.set(data.tickets);
    } catch (error) {
      this.supportError.set(error instanceof Error ? error.message : 'Impossibile caricare le segnalazioni.');
    } finally { this.supportLoading.set(false); }
  }
  protected async updateSupportTicketStatus(ticket: SupportTicket, status: SupportStatus): Promise<void> {
    try {
      await this.supportRequest(`tickets/${ticket.id}/status`, 'PATCH', { status });
      this.supportTickets.update(tickets => tickets.map(item => item.id === ticket.id ? { ...item, status } : item));
    } catch (error) {
      this.notifications.notify({ title: 'Aggiornamento non riuscito', message: error instanceof Error ? error.message : 'Riprova.', type: 'error' });
    }
  }
  protected async downloadSupportAttachment(ticketId: number, attachment: SupportAttachment): Promise<void> {
    try {
      const response = await this.supportRequest(`tickets/${ticketId}/attachments/${attachment.id}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = attachment.name; link.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 30000);
    } catch (error) {
      this.notifications.notify({ title: 'Download non riuscito', message: error instanceof Error ? error.message : 'Riprova.', type: 'error' });
    }
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
    effect(() => { if (this.isSupportAccount()) untracked(() => void this.loadSupportTickets()); });
    interval(30 * 1000).subscribe(() => { if (this.isSupportAccount()) void this.loadSupportTickets(); });
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

  private async fileAsBase64(file: File): Promise<string> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const chunkSize = 8192;
    let binary = '';
    for (let i = 0; i < bytes.length; i += chunkSize) binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
    return btoa(binary);
  }

  protected async sendBugReport(): Promise<void> {
    const description = this.bugReportText().trim();
    if (!description || this.bugReportSending()) return;
    this.bugReportSending.set(true);
    this.bugReportFileError.set('');
    try {
      const attachments = await Promise.all(this.bugReportFiles().map(async file => ({
        name: file.name, type: file.type, base64: await this.fileAsBase64(file)
      })));
      const response = await this.supportRequest('tickets', 'POST', {
        description,
        page: this.activePage(),
        browser: navigator.userAgent,
        attachments
      });
      const result = await response.json() as { id: number };
      this.bugReportOpen.set(false);
      this.bugReportText.set('');
      this.bugReportFiles.set([]);
      this.notifications.notify({
        title: 'Segnalazione inviata',
        message: `Ticket #${result.id} ricevuto dal Centro Assistenza.`,
        type: 'success',
        durationMs: 5500
      });
    } catch (error) {
      this.bugReportFileError.set(error instanceof Error ? error.message : 'Invio non riuscito. Riprova.');
    } finally { this.bugReportSending.set(false); }
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
