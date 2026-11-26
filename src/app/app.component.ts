import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, untracked } from '@angular/core';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
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
import { HomePageComponent } from './features/home/home-page.component';
import { StaffPageComponent } from './features/staff/staff-page.component';
import { CalendarPageComponent } from './features/calendar/calendar-page.component';
import type { TeamRecord } from './features/teams/team.service';
import type { PlayerRecord } from './features/players/player.service';
import { FIRESTORE_DB } from './core/firebase.tokens';
import { addDoc, collection, doc, getDocs, limit, orderBy, query, serverTimestamp, updateDoc } from 'firebase/firestore';

type AppView = 'home' | 'office' | 'training' | 'match-hub' | 'players' | 'teams' | 'staff' | 'calendar' | 'formation' | 'lineup' | 'match';
type AppSection = 'home' | 'office' | 'training' | 'match';
type IconName = keyof typeof NAV_ICONS;
interface NavItem { label: string; icon: IconName; view?: AppView; soon?: boolean; }

/** Draws a circle as path data so that every icon is a single <path>. */
const circle = (cx: number, cy: number, r: number): string => `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;

const NAV_ICONS = {
  home: 'M3 10.5 12 3l9 7.5M5.5 8.6V21h5v-6h3v6h5V8.6',
  office: 'M4 8h16v12H4zM9 8V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V8M4 13.5h16M11 12.5h2v2h-2z',
  desk: `${circle(9, 6.5, 3)}M3.5 17c0-3.2 2.4-5.5 5.5-5.5 1.5 0 2.8.5 3.8 1.4M11 14.5h10v6H11zM16 20.5v-6`,
  cone: 'M12 3.5 7.2 18h9.6zM9.4 11.3h5.2M8.4 14.5h7.2M4 20.5h16',
  match: `M3 5h18v14H3zM12 5v14${circle(12, 12, 2.6)}M3 9.2h2.8v5.6H3M21 9.2h-2.8v5.6H21`,
  data: 'M4.5 20v-5.5M9.5 20V10M14.5 20v-7.5M19.5 20V5.5M3 20.5h18',
  player: `M3.5 5h17v14h-17z${circle(9, 10, 2.2)}M5.8 16.2c.5-1.9 1.6-2.9 3.2-2.9s2.7 1 3.2 2.9M14.2 9.5h4M14.2 13h3`,
  manager: `${circle(12, 8, 3.6)}M5 20.5c.6-3.9 3.3-6.3 7-6.3s6.4 2.4 7 6.3`,
  shield: 'M12 3 19.5 6v5.6c0 4.8-3.1 8-7.5 9.4-4.4-1.4-7.5-4.6-7.5-9.4V6zM12 8.2l2.4 1.7-.9 2.8h-3l-.9-2.8z',
  trophy: 'M8 4h8v5.2a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3.4 3.6M16 6h3a3 3 0 0 1-3.4 3.6M12 13.2V17M8.5 20.5h7M9.8 17h4.4',
  stats: 'M4.5 20v-5.5M9.5 20V10M14.5 20v-7.5M19.5 20V5.5M3.5 9.5l5-4 4.5 3 6.5-5',
  back: 'M9.5 14.5 4.5 9.5l5-5M4.5 9.5h10.5a5 5 0 0 1 0 10H12',
  people: `${circle(9, 8, 3)}M3 19.5c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5M15.8 5.3a3 3 0 0 1 0 5.4M17.6 14.2c2.1.6 3.4 2.6 3.4 5.3`,
  tactic: 'M6.5 4.5h11v16h-11zM9.5 3h5v3h-5zM9 10l2 2M11 10l-2 2M13.5 16l2 2M15.5 16l-2 2M10.5 17.5c.9-2.4 2.4-3.7 4.6-4.3M14 12l1.4 1.1-1.4 1.1',
  calendar: 'M4 6h16v14.5H4zM4 10.2h16M8 3.5v4.5M16 3.5v4.5M7.5 13.5h2M11 13.5h2M14.5 13.5h2M7.5 16.8h2M11 16.8h2',
  sheet: 'M6.5 4.5h11v16h-11zM9.5 3h5v3h-5zM9.5 10h5M9.5 13.5h5M9.5 17h3',
  formation: `${circle(12, 5, 1.6)}${circle(6, 10.5, 1.6)}${circle(18, 10.5, 1.6)}${circle(8.5, 17.5, 1.6)}${circle(15.5, 17.5, 1.6)}M7.3 9.3l3.4-3M16.7 9.3l-3.4-3M6.6 12.1l1.3 3.8M17.4 12.1l-1.3 3.8`,
  flag: 'M6.5 21V3.5M6.5 4h10.5l-2.2 3.4L17 10.8H6.5M3.5 21h7',
  bench: 'M3 10.5h18M5 10.5V7h14v3.5M4 10.5V17M20 10.5V17M3 13.8h18M7.5 13.8v4.5M16.5 13.8v4.5',
  possession: `${circle(12, 12, 8.5)}${circle(12, 12, 3.5)}M3.5 12h5M15.5 12h5`,
  analysis: 'M4 4.5h16v13H4zM7 14l3-3.2 3 2.2 4-5M8.5 21h7M12 17.5V21'
} as const;

const VIEW_SECTION: Record<AppView, AppSection> = {
  home: 'home', office: 'office', players: 'office', teams: 'office', staff: 'office', training: 'training', calendar: 'match',
  'match-hub': 'match', formation: 'match', lineup: 'match', match: 'match'
};
const SECTION_LANDING: Record<AppSection, AppView | null> = { home: null, office: 'office', training: 'training', match: 'match-hub' };
const VIEW_META: Record<AppView, { title: string; accent?: string; subtitle?: string; icon: IconName }> = {
  home: { title: 'Home Page', icon: 'home' },
  office: { title: 'Ufficio', icon: 'office' },
  players: { title: 'Anagrafe Calciatore', icon: 'player', subtitle: 'Anagrafica dei calciatori e assegnazione alla squadra' },
  teams: { title: 'Anagrafe Squadra', icon: 'shield', subtitle: 'Dati della squadra, impianto e regolamento di gara' },
  staff: { title: 'Anagrafe Dirigenti', icon: 'manager', subtitle: 'Anagrafica dei dirigenti della società' },
  calendar: { title: 'Calendario', icon: 'calendar', subtitle: 'Inserisci l’andata, il ritorno si crea da solo' },
  training: { title: 'Allenamenti', icon: 'cone' },
  'match-hub': { title: 'Campo', icon: 'match' },
  formation: { title: 'Formazione', icon: 'formation', subtitle: 'Prepara la prossima partita e lo schieramento titolare' },
  lineup: { title: 'Formazione', icon: 'formation', subtitle: 'Modulo, titolari, panchina e capitani' },
  match: { title: 'Panchina', accent: 'Live', icon: 'bench' }
};
/** Depth of every screen: going to a smaller depth is "indietro" (slide from the left). */
const VIEW_DEPTH: Record<AppView, number> = {
  home: 0, office: 1, training: 1, 'match-hub': 1,
  players: 2, teams: 2, staff: 2, calendar: 2, formation: 2, match: 2, lineup: 3
};
const HOME_TILES: { label: string; icon: IconName; view?: AppView; tone: string; soon?: boolean }[] = [
  { label: 'Ufficio', icon: 'desk', view: 'office', tone: 'office' },
  { label: 'Allenamento', icon: 'tactic', view: 'training', tone: 'training' },
  { label: 'Partita', icon: 'match', view: 'match-hub', tone: 'match' },
  { label: 'Dati', icon: 'data', tone: 'data', soon: true }
];
const MAIN_SECTIONS: { label: string; icon: IconName; view: AppView; section: AppSection }[] = [
  { label: 'Home', icon: 'home', view: 'home', section: 'home' },
  { label: 'Ufficio', icon: 'desk', view: 'office', section: 'office' },
  { label: 'Allenamento', icon: 'cone', view: 'training', section: 'training' },
  { label: 'Partita', icon: 'match', view: 'match-hub', section: 'match' }
];
const SECTION_MENU: Partial<Record<AppSection, NavItem[]>> = {
  office: [
    { label: 'Anagrafe Calciatore', icon: 'player', view: 'players' },
    { label: 'Anagrafe Dirigente', icon: 'manager', view: 'staff' },
    { label: 'Anagrafe Squadra', icon: 'shield', view: 'teams' },
    { label: 'Creazione Stagione / Campionato', icon: 'trophy', soon: true },
    { label: 'Configurazione statistiche', icon: 'stats', soon: true }
  ],
  training: [
    { label: 'Inserimento Presenze', icon: 'people', soon: true },
    { label: 'Creazione Esercitazione', icon: 'cone', soon: true },
    { label: 'Composizione Allenamento', icon: 'tactic', soon: true }
  ],
  match: [
    { label: 'Calendario', icon: 'calendar', view: 'calendar' },
    { label: 'Convocazione', icon: 'people', soon: true },
    { label: 'Distinta Gara', icon: 'sheet', soon: true },
    { label: 'Formazione', icon: 'formation', view: 'formation' },
    { label: 'Palle inattive', icon: 'flag', soon: true },
    { label: 'Panchina Live', icon: 'bench', view: 'match' },
    { label: 'Possesso palla', icon: 'possession', soon: true },
    { label: 'Statistiche avanzate', icon: 'stats', soon: true },
    { label: 'Analisi Partita', icon: 'analysis', soon: true }
  ]
};

type SupportStatus = 'new' | 'progress' | 'resolved';
interface SupportTicket { id: string; authorEmail: string; authorName: string; description: string; page: string; browser: string; status: SupportStatus; createdAt: Date; updatedAt: Date; }


@Component({
  selector: 'fsm-root',
  standalone: true,
  imports: [DatePipe, NgTemplateOutlet, MatButtonModule, MatIconModule, AuthPageComponent, TeamsPageComponent, PlayersPageComponent, HomePageComponent, StaffPageComponent, CalendarPageComponent, NotificationHostComponent],
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

  /** Navigation model of the "Football Manager" interface: a home hub plus three themed areas. */
  protected readonly icons = NAV_ICONS;
  protected readonly activePage = signal<AppView>(typeof localStorage !== 'undefined' && !!localStorage.getItem('fsm-active-match-team') ? 'match' : 'home');
  protected readonly matchActive = signal(typeof localStorage !== 'undefined' && !!localStorage.getItem('fsm-active-match-team'));
  protected readonly nextOpponent = signal(this.readNextOpponent());
  protected readonly nextTeam = signal(this.readNextTeam());
  /** Direction of the page animation: 'forward' slides in from the right, 'back' from the left. */
  protected readonly navDirection = signal<'forward' | 'back'>('forward');
  /** Who is signed in: shown on the Home so it is clear which profile is in use. */
  protected readonly profile = computed(() => {
    const user = this.auth.user();
    const name = user?.displayName?.trim() || '';
    const email = user?.email ?? '';
    const words = (name || email).replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean);
    const initials = ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
    const google = !!user?.providerData.some(item => item.providerId === 'google.com');
    return { name: name || email || 'Profilo', email, initials, method: google ? 'Google' : 'Email e password', role: this.auth.accountRole() };
  });
  protected readonly section = computed<AppSection>(() => VIEW_SECTION[this.activePage()]);
  protected readonly viewMeta = computed(() => VIEW_META[this.activePage()]);
  protected readonly sectionMenu = computed<NavItem[]>(() => SECTION_MENU[this.section()] ?? []);
  protected readonly homeTiles = HOME_TILES;
  protected readonly mainSections = MAIN_SECTIONS;
  protected readonly matchLaunch = signal<{ team: TeamRecord; players: PlayerRecord[]; lineup: Record<string, string>; formation: string; positions: Record<string, { x: number; y: number }>; layoutSlot: 1 | 2; opponentName: string; token: number } | null>(null);
  protected readonly rosterRequest = signal<{ teamId: string; layoutSlot: 1 | 2; token: number } | null>(null);
  protected readonly updateAvailable = signal(false);
  protected readonly bugReportOpen = signal(false);
  protected readonly bugReportText = signal('');
  protected readonly releaseChangelogOpen = signal(false);
  private readonly releaseChangelogStorageKey = 'fsm-pending-release-changelog';
  protected readonly releaseVersion = 'v0.11';
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
    window.setTimeout(() => this.loadingMinimumElapsed.set(true), 700);
    try { history.replaceState({ fsmView: this.activePage() }, ''); } catch { /* history unavailable */ }
    window.addEventListener('popstate', (event: PopStateEvent) => {
      const view = (event.state as { fsmView?: AppView } | null)?.fsmView;
      if (this.isSupportAccount() || !this.auth.user()) return;
      this.setView(view && view in VIEW_DEPTH ? view : 'home', true);
    });
    window.addEventListener('fsm-match-context', () => { this.nextOpponent.set(this.readNextOpponent()); this.nextTeam.set(this.readNextTeam()); });
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
    this.matchActive.set(true);
    this.activePage.set('match');
  }

  protected returnHomeAfterMatch(): void {
    this.matchLaunch.set(null);
    this.matchActive.set(false);
    this.setView('formation');
  }

  protected openTeamRoster(request: { teamId: string; layoutSlot: 1 | 2 }): void {
    this.matchLaunch.set(null);
    if (!request.teamId) { this.setView('teams'); return; }
    this.rosterRequest.set({ ...request, token: Date.now() });
    this.setView('lineup');
  }

  /** Opens a menu entry. Entries without a screen yet are marked "in arrivo" and stay inert. */
  protected openItem(item: { view?: AppView; soon?: boolean }): void {
    if (item.soon || !item.view) return;
    if (item.view === 'match' && !this.matchActive()) { this.setView('formation'); return; }
    this.setView(item.view);
  }

  protected isItemActive(item: { view?: AppView }): boolean {
    const view = this.activePage();
    return !!item.view && (item.view === view || (item.view === 'formation' && view === 'lineup'));
  }

  /** "Indietro" / "Menù precedente": from a screen back to its area, from an area back to Home. */
  protected goBack(): void {
    const view = this.activePage();
    if (view === 'lineup') { this.setView('formation'); return; }
    const landing = SECTION_LANDING[this.section()];
    this.setView(!landing || view === landing ? 'home' : landing);
  }

  protected setView(view: AppView, fromHistory = false): void {
    const current = this.activePage();
    if (view !== current) {
      this.navDirection.set(fromHistory || VIEW_DEPTH[view] < VIEW_DEPTH[current] ? 'back' : 'forward');
      // Phone "back" gesture / browser back button go to the previous screen of the app.
      if (!fromHistory && typeof history !== 'undefined') {
        try { history.pushState({ fsmView: view }, ''); } catch { /* history unavailable */ }
      }
    }
    // A launch request must be consumed only once: re-opening "Panchina Live" later
    // has to resume the saved match instead of starting a new one.
    if (this.activePage() === 'match' && view !== 'match') this.matchLaunch.set(null);
    if (view === 'teams') { this.matchLaunch.set(null); this.rosterRequest.set(null); }
    this.nextOpponent.set(this.readNextOpponent());
    this.nextTeam.set(this.readNextTeam());
    this.activePage.set(view);
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  }

  /** Team selected in "Formazione" (written there), shown in the header match chips. */
  private readNextTeam(): { name: string; category: string } {
    try {
      const raw = typeof localStorage !== 'undefined' ? localStorage.getItem('fsm-next-team') : null;
      const parsed = raw ? JSON.parse(raw) : null;
      return { name: String(parsed?.name ?? '').trim(), category: String(parsed?.category ?? '').trim() };
    } catch { return { name: '', category: '' }; }
  }

  private readNextOpponent(): string {
    try { return typeof localStorage !== 'undefined' ? (localStorage.getItem('fsm-next-opponent') ?? '').trim() : ''; }
    catch { return ''; }
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
