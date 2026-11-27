import { ChangeDetectionStrategy, Component, EventEmitter, Input, OnChanges, Output, computed, effect, inject, signal } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { ActiveEventService } from '../../core/active-event.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { FsmSelectComponent } from '../../shared/fsm-select.component';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { PlayerService } from '../players/player.service';
import { TeamsPageComponent } from '../teams/teams-page.component';
import { OpponentsComponent } from './opponents.component';
import { SquadTransferService } from './squad-transfer.service';

/** "Anagrafe squadre": my team (with import/export) and the opponent teams of the selected event. */
@Component({
  selector: 'fsm-squads-page',
  standalone: true,
  imports: [TeamsPageComponent, OpponentsComponent, FsmSelectComponent],
  templateUrl: './squads-page.component.html',
  styleUrl: './squads-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class SquadsPageComponent implements OnChanges {
  private readonly auth = inject(FirebaseAuthService);
  private readonly teamService = inject(TeamService);
  private readonly playerService = inject(PlayerService);
  private readonly transfer = inject(SquadTransferService);
  private readonly notifications = inject(NotificationService);
  protected readonly events = inject(ActiveEventService);

  @Input() initialTab: 'mine' | 'opponents' = 'mine';
  @Output() readonly changed = new EventEmitter<void>();

  protected readonly tab = signal<'mine' | 'opponents'>('mine');
  protected readonly team = signal<TeamRecord | null>(null);
  protected readonly importOpen = signal(false);
  protected readonly importMode = signal<'event' | 'file'>('event');
  protected readonly sources = signal<{ id: string; name: string; eventTitle: string; count: number }[]>([]);
  protected readonly sourceTitle = signal('');
  protected readonly busy = signal(false);
  protected readonly progress = signal<{ done: number; total: number } | null>(null);
  protected readonly percent = computed(() => { const p = this.progress(); return p && p.total ? Math.round(p.done / p.total * 100) : 0; });
  protected readonly message = signal('');
  protected readonly refreshKey = signal(0);
  protected readonly sourceLabels = computed(() => this.sources().map(source => this.label(source)));
  private label(source: { name: string; eventTitle: string; count: number }): string { return `${source.name} · ${source.eventTitle} (${source.count} giocatori)`; }

  constructor() { effect(() => { if (this.auth.workspaceId() && this.events.activeId()) void this.loadTeam(); }); }

  ngOnChanges(): void { this.tab.set(this.initialTab); }

  protected setTab(tab: 'mine' | 'opponents'): void { this.tab.set(tab); }

  protected async openImport(): Promise<void> {
    this.message.set('');
    this.importMode.set('event');
    this.importOpen.set(true);
    this.sourceTitle.set('');
    try { this.sources.set(await this.transfer.listExports()); } catch { this.sources.set([]); }
  }

  protected closeImport(): void { this.importOpen.set(false); }

  protected async runImportFromEvent(): Promise<void> {
    const label = this.sourceTitle();
    const source = this.sources().find(item => this.label(item) === label);
    if (!source) { this.message.set('Scegli quale squadra importare.'); return; }
    await this.run(() => this.transfer.importFromExport(source.id, this.onProgress));
  }

  protected async runImportFromFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { this.message.set('Salva il file Excel come “CSV (delimitato dal separatore di elenco)” e riprova: oppure usa un file esportato da qui.'); return; }
    const text = await file.text();
    await this.run(() => this.transfer.importFromText(text, this.onProgress));
  }

  protected async exportRoster(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const team = this.team();
    if (!workspaceId || !team) { this.notifications.notify({ title: 'Nessuna squadra', message: 'Crea prima la squadra di questo evento.', type: 'warning' }); return; }
    const players = await this.playerService.list(workspaceId, [team]);
    try {
      const count = await this.transfer.exportToApp(team, players);
      this.notifications.notify({ title: 'Squadra esportata', message: `${team.name} con ${count} giocatori: ora puoi importarla in un altro evento.`, type: 'success' });
    } catch { this.notifications.notify({ title: 'Esportazione non riuscita', message: 'Riprova tra un momento.', type: 'warning' }); }
  }

  private readonly onProgress = (done: number, total: number): void => this.progress.set({ done, total });

  private async run(action: () => Promise<{ added: number; skipped: number; failed: string[]; teamCreated: boolean }>): Promise<void> {
    this.busy.set(true);
    this.progress.set({ done: 0, total: 0 });
    this.message.set('');
    try {
      const result = await action();
      const parts = [`${result.added} giocatori aggiunti`];
      if (result.teamCreated) parts.unshift('Squadra creata');
      if (result.skipped) parts.push(`${result.skipped} già presenti`);
      if (result.failed.length) parts.push(`${result.failed.length} non importati (${result.failed.slice(0, 2).join('; ')})`);
      this.notifications.notify({ title: 'Importazione completata', message: parts.join(' · ') + '.', type: result.failed.length ? 'warning' : 'success', durationMs: 8000 });
      this.importOpen.set(false);
      this.refreshKey.update(key => key + 1);
      await this.loadTeam();
      this.changed.emit();
    } catch (error) {
      this.message.set((error as Error).message || 'Importazione non riuscita.');
    } finally { this.busy.set(false); this.progress.set(null); }
  }

  private async loadTeam(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.team.set((await this.teamService.list(workspaceId)).find(team => !team.isArchived) ?? null);
  }
}
