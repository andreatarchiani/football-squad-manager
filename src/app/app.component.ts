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
import { FIRESTORE_DB } from './core/firebase.tokens';
import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';

type SupportStatus = 'new' | 'progress' | 'resolved';
interface SupportTicket { id: string; authorEmail: string; authorName: string; description: string; page: string; browser: string; status: SupportStatus; createdAt: Date; updatedAt: Date; }


@Component({
  selector: 'fsm-root',
  standalone: true,
  imports: [DatePipe, MatButtonModule, MatIconModule, AuthPageComponent, TeamsPageComponent, PlayersPageComponent, VoiceAssistantComponent, HomePageComponent, NotificationHostComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  // Firestore Security Rules independently enforce access to support tickets.
  protected readonly isSupportAccount = computed(() =>
    this.auth.user()?.email?.trim().toLowerCase() === 'squadmanagersupport@gmail.com'
  );
  protected readonly supportFilter = signal<'all' | SupportStatus>('all');
  protected readonly supportSearch = signal('');
  protected readonly supportTickets = signal<SupportTicket[]>([]);
  protected readonly supportLoading = signal(false);
  protected readonly supportError = signal('');
  protected readonly supportSelectedTicket = signal<string | null>(null);
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
  protected selectSupportTicket(id: string): void { this.supportSelectedTicket.set(id); }
  protected closeSupportTicket(): void { this.supportSelectedTicket.set(null); }

  private readonly supportDb = inject(FIRESTORE_DB, { optional: true });

  protected async loadSupportTickets(): Promise<void> {
    if (!this.isSupportAccount() || this.supportLoading()) return;
    this.supportLoading.set(true);
    this.supportError.set('');
    try {
      if (!this.supportDb) throw new Error('Database non disponibile.');
      const result = await getDocs(query(collection(this.supportDb, 'supportTickets'), orderBy('createdAt', 'desc'), limit(300)));
      this.supportTickets.set(result.docs.map(snapshot => {
        const data = snapshot.data();
        return {
          id: snapshot.id,
          authorEmail: String(data['authorEmail'] ?? ''),
          authorName: String(data['authorName'] ?? ''),
          description: String(data['description'] ?? ''),
          page: String(data['page'] ?? ''),
          browser: String(data['browser'] ?? ''),
          status: (data['status'] as SupportStatus) || 'new',
          createdAt: data['createdAt']?.toDate?.() ?? new Date(),
          updatedAt: data['updatedAt']?.toDate?.() ?? new Date()
        };
      }));
    } catch (error) {
      console.error('Unable to load support tickets', error);
      this.supportError.set('Impossibile caricare le segnalazioni. Verifica che le regole Firestore siano state pubblicate.');
    } finally { this.supportLoading.set(false); }
  }

  protected async updateSupportTicketStatus(ticket: SupportTicket, status: SupportStatus): Promise<void> {
    try {
      if (!this.supportDb || !this.isSupportAccount()) throw new Error('Accesso non autorizzato.');
      await updateDoc(doc(this.supportDb, 'supportTickets', ticket.id), { status, updatedAt: serverTimestamp() });
      this.supportTickets.update(tickets => tickets.map(item => item.id === ticket.id ? { ...item, status } : item));
    } catch (error) {
      console.error('Unable to update support ticket status', error);
      this.notifications.notify({ title: 'Aggiornamento non riuscito', message: 'Non è stato possibile aggiornare la segnalazione. Riprova.', type: 'error' });
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

  protected readonly bugReportFileError = signal('');
  protected readonly bugReportSending = signal(false);

  protected openBugReport(): void {
    this.bugReportText.set('');
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

  protected async sendBugReport(): Promise<void> {
    const description = this.bugReportText().trim();
    const user = this.auth.user();
    if (!description || !user || this.bugReportSending()) return;
    this.bugReportSending.set(true);
    this.bugReportFileError.set('');
    try {
      if (!this.supportDb) throw new Error('Database non disponibile.');
      const ticket = await addDoc(collection(this.supportDb, 'supportTickets'), {
        authorUid: user.uid,
        authorEmail: user.email || '',
        authorName: (user.displayName || '').slice(0, 120),
        description,
        page: this.activePage(),
        browser: navigator.userAgent.slice(0, 500),
        status: 'new',
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp()
      });
      this.bugReportOpen.set(false);
      this.bugReportText.set('');
      this.notifications.notify({
        title: 'Segnalazione inviata',
        message: `Ticket ${ticket.id.slice(0, 8).toUpperCase()} ricevuto dal Centro Assistenza.`,
        type: 'success',
        durationMs: 5500
      });
    } catch (error) {
      console.error('Unable to submit support ticket', error);
      this.bugReportFileError.set('Invio non riuscito. Verifica la connessione e riprova.');
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
