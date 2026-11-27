import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { clearFieldProblems, showFieldProblems, type FieldProblem } from '../../core/form-feedback';
import { StaffService, emptyStaff, type StaffInput, type StaffRecord } from './staff.service';

@Component({
  selector: 'fsm-staff-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './staff-page.component.html',
  // Same look as "Anagrafe Calciatore".
  styleUrl: '../players/players-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class StaffPageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly service = inject(StaffService);
  private readonly notifications = inject(NotificationService);

  protected readonly staff = signal<StaffRecord[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly formOpen = signal(false);
  protected readonly editingId = signal<string | null>(null);
  protected readonly categoryOpen = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  protected readonly notice = signal('');
  protected readonly categories = ['Prima Squadra', 'Juniores Under 19', 'Under 18', 'Allievi Under 17', 'Allievi B Under 16', 'Giovanissimi Under 15', 'Giovanissimi B Under 14', 'Esordienti II anno Under 13', 'Esordienti I anno Under 12', 'Pulcini II anno Under 11', 'Pulcini I anno Under 10', 'Primi Calci II anno Under 9', 'Primi Calci I anno Under 8', 'Piccoli Amici II anno Under 7', 'Piccoli Amici I anno Under 6', 'Tutte le categorie'];
  protected form: StaffInput = emptyStaff();
  protected readonly archiveOpen = signal(false);
  protected readonly archiveLoading = signal(false);
  protected readonly archive = signal<(StaffRecord & { eventTitle: string })[]>([]);
  protected readonly picked = signal<Set<string>>(new Set());
  protected readonly copying = signal(false);

  protected async openArchive(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.archiveOpen.set(true); this.archiveLoading.set(true); this.picked.set(new Set());
    try { this.archive.set(await this.service.listArchive(workspaceId)); }
    catch (error) { console.error('Unable to load the archive.', error); this.archive.set([]); }
    finally { this.archiveLoading.set(false); }
  }
  protected togglePick(id: string): void { this.picked.update(set => { const next = new Set(set); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  protected async copyPicked(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const chosen = this.archive().filter(item => this.picked().has(item.id));
    if (!workspaceId || !chosen.length) return;
    this.copying.set(true);
    try {
      await Promise.all(chosen.map(({ id, eventTitle, ...data }) => { void id; void eventTitle; return this.service.save(workspaceId, data); }));
      this.notifications.notify({ title: 'Dirigenti caricati', message: `${chosen.length} aggiunti a questo evento.`, type: 'success' });
      this.archiveOpen.set(false);
      await this.load();
    } catch (error) {
      console.error('Unable to copy officials.', error);
      this.notifications.notify({ title: 'Caricamento non riuscito', message: 'Riprova tra un momento.', type: 'warning' });
    } finally { this.copying.set(false); }
  }

  constructor() { effect(() => { if (this.auth.workspaceId()) void this.load(); }); }

  protected initials(person: StaffRecord): string {
    return `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase() || '—';
  }

  protected openCreate(): void {
    this.editingId.set(null); this.form = emptyStaff(); this.formError.set(''); this.categoryOpen.set(false); this.formOpen.set(true);
  }

  protected openEdit(person: StaffRecord): void {
    const { id, ...data } = person;
    this.editingId.set(id); this.form = { ...data }; this.formError.set(''); this.categoryOpen.set(false); this.formOpen.set(true);
  }

  protected cancel(): void { this.formOpen.set(false); this.editingId.set(null); this.formError.set(''); }

  protected setCategory(value: string): void { this.form.affiliationCategory = value; this.categoryOpen.set(false); }

  protected async save(formEl?: HTMLElement): Promise<void> {
    this.formError.set('');
    clearFieldProblems(formEl);
    const problems = this.validate();
    if (problems.length) {
      showFieldProblems(formEl, problems);
      const names = problems.map(problem => problem.label).join(', ');
      this.formError.set(problems.length === 1 ? `${problems[0].label}: ${problems[0].message.toLowerCase()}.` : `Controlla i campi evidenziati: ${names}.`);
      this.notifications.notify({ title: problems.length === 1 && problems[0].message === 'Compila questo campo' ? 'Compila questo campo' : 'Controlla i campi evidenziati', message: names, type: 'warning', durationMs: 6000 });
      return;
    }
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) { this.formError.set('Sessione scaduta: esci e accedi di nuovo.'); return; }
    this.saving.set(true);
    try {
      const editing = this.editingId();
      await this.service.save(workspaceId, this.form, editing);
      this.notifications.notify({ title: editing ? 'Dirigente aggiornato' : 'Dirigente inserito', message: `${this.form.firstName} ${this.form.lastName}`, type: 'success' });
      this.formOpen.set(false); this.editingId.set(null);
      await this.load();
    } catch (error) {
      console.error('Unable to save staff member.', error);
      const message = 'Non è stato possibile salvare il dirigente. Controlla la connessione a internet e riprova.';
      this.formError.set(message);
      this.notifications.notify({ title: 'Dirigente non salvato', message, type: 'error', durationMs: 7000 });
    } finally { this.saving.set(false); }
  }

  protected async remove(person: StaffRecord): Promise<void> {
    const confirmed = await this.notifications.confirm({ title: 'Eliminare il dirigente?', message: `"${person.firstName} ${person.lastName}" verrà eliminato dall'anagrafica. L'operazione non è reversibile.`, confirmText: 'Elimina', cancelText: 'Annulla', tone: 'danger' });
    if (!confirmed) return;
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    try {
      await this.service.delete(workspaceId, person.id);
      this.notifications.notify({ title: 'Dirigente eliminato', type: 'success' });
      await this.load();
    } catch (error) {
      console.error('Unable to delete staff member.', error);
      this.notifications.notify({ title: 'Eliminazione non riuscita', message: 'Riprova tra poco.', type: 'error' });
    }
  }

  private validate(): FieldProblem[] {
    const problems: FieldProblem[] = [];
    const empty = 'Compila questo campo';
    if (!this.form.firstName.trim()) problems.push({ field: 'firstName', label: 'Nome', message: empty });
    if (!this.form.lastName.trim()) problems.push({ field: 'lastName', label: 'Cognome', message: empty });
    if (this.form.postalCode.trim() && !/^\d{5}$/.test(this.form.postalCode.trim())) problems.push({ field: 'postalCode', label: 'CAP', message: 'Il CAP deve avere 5 cifre' });
    return problems;
  }

  private async load(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) { this.loading.set(false); return; }
    this.loading.set(true);
    try { this.staff.set(await this.service.list(workspaceId)); this.error.set(''); }
    catch (error) { console.error('Unable to load staff.', error); this.error.set('Non è stato possibile caricare i dirigenti. Riprova tra poco.'); }
    finally { this.loading.set(false); }
  }
}
