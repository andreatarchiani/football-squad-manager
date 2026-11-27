import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, computed, effect, inject, signal } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { ActiveEventService } from '../../core/active-event.service';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { PlayerService } from '../players/player.service';
import { TeamsPageComponent } from '../teams/teams-page.component';
import { OpponentsComponent } from './opponents.component';
import { SquadTransferService, type ImportResult } from './squad-transfer.service';

/** "Anagrafe squadre": my team (with import/export) and the opponent teams of the selected event. */
@Component({
  selector: 'fsm-squads-page',
  standalone: true,
  imports: [TeamsPageComponent, OpponentsComponent],
  templateUrl: './squads-page.component.html',
  styleUrl: './squads-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SquadsPageComponent implements OnChanges {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamService = inject(TeamService);
  private readonly playerService = inject(PlayerService);
  private readonly transfer = inject(SquadTransferService);
  protected readonly events = inject(ActiveEventService);

  @Input() initialTab: 'mine' | 'opponents' = 'mine';
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly tab = signal<'mine' | 'opponents'>('mine');
  protected readonly team = signal<TeamRecord | null>(null);
  protected readonly importOpen = signal(false);
  protected readonly importMode = signal<'event' | 'file'>('event');
  protected readonly sources = signal<{ id: string; name: string; eventTitle: string; count: number; here: boolean }[]>([]);
  protected readonly sourcesLoading = signal(false);
  protected readonly sourceId = signal('');
  protected readonly busy = signal(false);
  protected readonly progress = signal<{ done: number; total: number } | null>(null);
  protected readonly percent = computed(() => { const p = this.progress(); return p && p.total ? Math.round(p.done / p.total * 100) : 0; });
  protected readonly message = signal('');
  protected readonly result = signal<ImportResult | null>(null);
  protected readonly exporting = signal(false);
  protected readonly exportInfo = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly refreshKey = signal(0);

  constructor() { effect(() => { if (this.auth.workspaceId() && this.events.activeId()) void this.loadTeam(); }); }

  ngOnChanges(): void { this.tab.set(this.initialTab); }

  protected setTab(tab: 'mine' | 'opponents'): void { this.tab.set(tab); }

  protected async openImport(): Promise<void> {
    this.message.set(''); this.result.set(null); this.sourceId.set('');
    this.importMode.set('event');
    this.importOpen.set(true);
    this.sourcesLoading.set(true);
    try { this.sources.set(await this.transfer.listExports()); }
    catch { this.sources.set([]); this.message.set('Non riesco a leggere le squadre esportate: controlla la connessione e riprova.'); }
    finally { this.sourcesLoading.set(false); }
  }

  protected closeImport(): void { if (!this.busy()) this.importOpen.set(false); }

  protected async runImportFromEvent(): Promise<void> {
    const source = this.sources().find(item => item.id === this.sourceId());
    if (!source) { this.message.set('Scegli quale squadra importare.'); return; }
    await this.run(() => this.transfer.importFromExport(source.id, this.onProgress));
  }

  protected async runImportFromFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { this.message.set('Salva il file Excel come “CSV” e riprova.'); return; }
    const text = await file.text();
    await this.run(() => this.transfer.importFromText(text, this.onProgress));
  }

  protected async exportRoster(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const team = this.team();
    if (!workspaceId || !team) { this.exportInfo.set({ ok: false, text: 'In questo evento non c’è ancora la tua squadra: creala o importala prima di esportarla.' }); return; }
    this.exporting.set(true);
    this.exportInfo.set(null);
    try {
      const players = await this.playerService.list(workspaceId, [team]);
      const count = await this.transfer.exportToApp(team, players);
      const time = new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' });
      this.exportInfo.set({ ok: true, text: `Esportata “${team.name}” con ${count} giocatori (ore ${time}). Ora vai nel nuovo evento, premi Importa e scegli questa squadra.` });
    } catch (error) {
      console.error('Unable to export the squad.', error);
      this.exportInfo.set({ ok: false, text: 'Esportazione non riuscita: controlla la connessione e riprova.' });
    } finally { this.exporting.set(false); }
  }

  private readonly onProgress = (done: number, total: number): void => this.progress.set({ done, total });

  private async run(action: () => Promise<ImportResult>): Promise<void> {
    this.busy.set(true);
    this.progress.set({ done: 0, total: 0 });
    this.message.set(''); this.result.set(null);
    try {
      const result = await action();
      this.result.set(result);
      this.refreshKey.update(key => key + 1);
      await this.loadTeam();
      this.changed.emit();
    } catch (error) {
      console.error('Import failed.', error);
      this.message.set((error as Error).message || 'Importazione non riuscita.');
    } finally { this.busy.set(false); this.progress.set(null); }
  }

  private async loadTeam(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    try { this.team.set((await this.teamService.list(workspaceId)).find(team => !team.isArchived) ?? null); } catch { this.team.set(null); }
  }
}
