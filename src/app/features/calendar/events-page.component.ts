import { ChangeDetectionStrategy, Component, ElementRef, EventEmitter, Output, computed, effect, inject, signal, viewChild } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { clearFieldProblems, showFieldProblems, type FieldProblem } from '../../core/form-feedback';
import { prepareIconImage } from '../../core/icon-image';
import { FsmSelectComponent } from '../../shared/fsm-select.component';
import { ActiveEventService } from '../../core/active-event.service';
import { TeamService, type TeamRecord } from '../teams/team.service';
import {
  ACTIVITIES, BALL_SIZES, CalendarService, FORMATS, GROUP_OPTIONS, NATURES, ORGANIZATIONS, SCOPES, SEASON_CATEGORIES, SEASON_TABS,
  categoryRules, emptyEvent, eventTitle, findNextMatch, tabOfCategory, type CalendarData, type EventDetails, type SeasonTab
} from './calendar.service';
import { CalendarPageComponent } from './calendar-page.component';

type View = 'list' | 'edit' | 'girone';
type Flag = 'flyingSubstitutions' | 'reentry' | 'extraTime' | 'penalties' | 'extraReport';
type NumberKey = 'playersOnField' | 'playersOnList' | 'periods' | 'periodMinutes' | 'interval' | 'maxSubstitutions';
type TextKey = 'name' | 'fieldLength' | 'fieldWidth' | 'goalWidth' | 'goalHeight' | 'ballWeight' | 'group';

@Component({
  selector: 'fsm-events-page',
  standalone: true,
  imports: [CalendarPageComponent, FsmSelectComponent],
  templateUrl: './events-page.component.html',
  styleUrl: './events-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class EventsPageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamService = inject(TeamService);
  protected readonly activeEvents = inject(ActiveEventService);
  private readonly service = inject(CalendarService);
  private readonly notifications = inject(NotificationService);
  private readonly formRef = viewChild<ElementRef<HTMLElement>>('eventForm');

  /** Asks the app to open "Anagrafe Squadra" (to create a team). */
  @Output() readonly openOpponents = new EventEmitter<void>();
  @Output() readonly openTeams = new EventEmitter<void>();

  protected readonly view = signal<View>('list');
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly teams = signal<TeamRecord[]>([]);
  protected readonly events = this.activeEvents.events;
  protected readonly activeId = signal('');
  protected readonly editingId = signal<string | null>(null);
  protected readonly draft = signal<EventDetails>(emptyEvent());
  protected readonly confirmDelete = signal(false);

  protected readonly tabs = SEASON_TABS;
  protected readonly categories = SEASON_CATEGORIES;
  protected readonly allCategories = Object.values(SEASON_CATEGORIES).flat();
  protected readonly organizations = ORGANIZATIONS;
  protected readonly groupOptions = GROUP_OPTIONS;
  protected readonly activities = ACTIVITIES;
  protected readonly natures = NATURES;
  protected readonly scopes = SCOPES;
  protected readonly formats = FORMATS;
  protected readonly ballSizes = BALL_SIZES;
  protected readonly seasons = this.seasonOptions();

  protected readonly toggleRows: { key: Flag; label: string }[] = [
    { key: 'flyingSubstitutions', label: 'Sostituzioni volanti' }, { key: 'reentry', label: 'Reingresso consentito' },
    { key: 'extraTime', label: 'Tempi supplementari' }, { key: 'penalties', label: 'Calci di rigore' }
  ];

  constructor() { effect(() => { if (this.auth.workspaceId()) void this.load(); }); }

  /* ------------------------------------------------------------ list */
  protected title(event: CalendarData): string { return eventTitle(event); }
  protected isImage(value: string): boolean { return value.startsWith('data:image/'); }
  protected rounds(event: CalendarData): number { return event.andata.length + event.ritorno.length; }
  protected nextOf(event: CalendarData): string {
    const round = findNextMatch(event);
    if (!round) return '';
    const date = new Date(`${round.date}T12:00:00`);
    return `${date.toLocaleDateString('it-IT', { day: 'numeric', month: 'short' })}${round.time ? ' · ' + round.time : ''} vs ${round.opponent}`;
  }

  protected open(id: string): void { this.activeEvents.select(id); this.activeId.set(id); this.view.set('girone'); }
  protected async backToList(): Promise<void> { this.view.set('list'); await this.activeEvents.reload(); }

  /* ------------------------------------------------------------ form */
  protected newEvent(): void {
    const season = this.seasons[1] ?? '';
    this.editingId.set(null);
    this.confirmDelete.set(false);
    this.draft.set({ ...emptyEvent(), seasonLabel: season, name: season ? `Stagione ${season}` : '' });
    this.view.set('edit');
  }

  protected editEvent(id: string): void {
    const event = this.events().find(item => item.id === id);
    if (!event) return;
    this.editingId.set(id);
    this.confirmDelete.set(false);
    this.draft.set({ ...event.event, kitsField: [...event.event.kitsField], kitsKeeper: [...event.event.kitsKeeper], tab: event.event.category ? tabOfCategory(event.event.category) : event.event.tab });
    this.view.set('edit');
  }

  protected cancelEdit(): void { this.view.set(this.editingId() ? 'girone' : 'list'); if (this.editingId()) this.activeId.set(this.editingId()!); }

  protected patch(change: Partial<EventDetails>): void { this.draft.update(draft => ({ ...draft, ...change })); }
  protected setText(key: TextKey, value: string): void { this.patch({ [key]: value } as Partial<EventDetails>); }
  protected setNumber(key: NumberKey, value: string): void { this.patch({ [key]: value === '' ? null : Number(value) } as Partial<EventDetails>); }
  protected setFlag(key: Flag, value: boolean): void { this.patch({ [key]: value } as Partial<EventDetails>); }

  protected selectTab(tab: SeasonTab): void { this.patch({ tab }); }
  protected selectCategory(category: string): void {
    this.patch({ category, tab: tabOfCategory(category) });
    // New events start from the usual rules of the category (editable afterwards).
    if (!this.editingId()) this.patch(categoryRules(category));
  }
  protected applyRules(): void {
    const category = this.draft().category;
    this.patch(category ? categoryRules(category) : categoryRules('Senior'));
    this.notifications.notify({ title: 'Regolamento aggiornato', message: category ? `Valori tipici di “${category}”: puoi modificarli.` : 'Valori standard 11 vs 11: puoi modificarli.', type: 'success' });
  }
  protected selectFormat(format: string): void {
    const players = Number(format.split(' ')[0]);
    this.patch({ format, playersOnField: Number.isFinite(players) ? players : this.draft().playersOnField });
  }

  protected setColor(kind: 'kitsField' | 'kitsKeeper', index: number, value: string): void {
    this.patch({ [kind]: this.draft()[kind].map((color, i) => i === index ? value : color) } as Partial<EventDetails>);
  }
  protected addColor(kind: 'kitsField' | 'kitsKeeper'): void {
    if (this.draft()[kind].length < 6) this.patch({ [kind]: [...this.draft()[kind], '#888888'] } as Partial<EventDetails>);
  }
  protected removeColor(kind: 'kitsField' | 'kitsKeeper', index: number): void {
    this.patch({ [kind]: this.draft()[kind].filter((_, i) => i !== index) } as Partial<EventDetails>);
  }

  protected async uploadLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) { this.notifications.notify({ title: 'Immagine non valida', message: 'Scegli un’immagine PNG, JPG o WebP sotto gli 8 MB.', type: 'warning' }); return; }
    try { this.patch({ logo: await prepareIconImage(file, 128) }); }
    catch { this.notifications.notify({ title: 'Logo non caricato', message: 'Prova con un file PNG, JPG o WebP.', type: 'warning' }); }
  }

  protected async save(): Promise<void> {
    const draft = this.draft();
    const problems: FieldProblem[] = [];
    if (!draft.name.trim()) problems.push({ field: 'name', message: 'Compila questo campo: il nome della stagione.' });
    if (!draft.seasonLabel) problems.push({ field: 'season', message: 'Scegli la stagione sportiva.' });
    if (!draft.category) problems.push({ field: 'category', message: 'Scegli la categoria.' });
    if (draft.groupMode === 'manual' && !draft.group.trim()) problems.push({ field: 'group', message: 'Scrivi il nome del girone.' });
    const form = this.formRef()?.nativeElement;
    clearFieldProblems(form);
    if (problems.length) { showFieldProblems(form, problems); return; }
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.saving.set(true);
    try {
      const id = await this.service.saveEvent(workspaceId, this.editingId(), draft);
      this.notifications.notify({ title: this.editingId() ? 'Evento aggiornato' : 'Stagione creata', message: 'Ora inserisci le giornate nel girone.', type: 'success' });
      await this.activeEvents.reload();
      this.activeEvents.select(id);
      this.activeId.set(id);
      this.view.set('girone');
    } catch (error) {
      console.error('Unable to save the event.', error);
      this.notifications.notify({ title: 'Non salvato', message: 'Controlla la connessione e riprova.', type: 'error', durationMs: 7000 });
    } finally { this.saving.set(false); }
  }

  protected async remove(): Promise<void> {
    const id = this.editingId();
    const workspaceId = this.auth.workspaceId();
    if (!id || !workspaceId) return;
    if (!this.confirmDelete()) { this.confirmDelete.set(true); return; }
    try {
      await this.service.deleteEvent(workspaceId, id);
      this.notifications.notify({ title: 'Evento eliminato', message: 'Il calendario di questo evento è stato eliminato.', type: 'success' });
      this.view.set('list');
      await this.activeEvents.reload();
    } catch (error) {
      console.error('Unable to delete the event.', error);
      this.notifications.notify({ title: 'Non eliminato', message: 'Riprova tra poco.', type: 'error' });
    }
  }

  /* ------------------------------------------------------------ data */
  private seasonOptions(): string[] {
    const now = new Date();
    const start = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    return [start - 1, start, start + 1, start + 2].map(year => `${year}/${year + 1}`);
  }

  private async load(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    try {
      await this.activeEvents.whenReady();
      this.teams.set((await this.teamService.list(workspaceId)).filter(team => !team.isArchived));
      this.error.set('');
    } catch (error) {
      console.error('Unable to load the events.', error);
      this.error.set('Non è stato possibile caricare le stagioni.');
    } finally { this.loading.set(false); }
  }
}
