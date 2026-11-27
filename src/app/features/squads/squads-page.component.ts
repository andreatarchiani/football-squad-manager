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
  protected readonly sources = signal<{ id: string; title: string; team: string; players: number }[]>([]);
  protected readonly sourceTitle = signal('');
  protected readonly busy = signal(false);
  protected readonly message = signal('');
  protected readonly refreshKey = signal(0);
  protected readonly sourceLabels = computed(() => this.sources().map(source => `${source.title} · ${source.team} (${source.players})`));

  constructor() { effect(() => { if (this.auth.workspaceId() && this.events.activeId()) void this.loadTeam(); }); }

  ngOnChanges(): void { this.tab.set(this.initialTab); }

  protected setTab(tab: 'mine' | 'opponents'): void { this.tab.set(tab); }

  protected async openImport(): Promise<void> {
    this.message.set('');
    this.importMode.set('event');
    this.importOpen.set(true);
    this.sourceTitle.set('');
    try { this.sources.set(await this.transfer.sourceEvents()); } catch { this.sources.set([]); }
  }

  protected closeImport(): void { this.importOpen.set(false); }

  protected async runImportFromEvent(): Promise<void> {
    const label = this.sourceTitle();
    const source = this.sources().find(item => `${item.title} · ${item.team} (${item.players})` === label);
    if (!source) { this.message.set('Scegli da quale evento importare.'); return; }
    await this.run(() => this.transfer.importFromEvent(source.id));
  }

  protected async runImportFromFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    if (/\.xlsx?$/i.test(file.name)) { this.message.set('Salva il file Excel come “CSV (delimitato dal separatore di elenco)” e riprova: oppure usa un file esportato da qui.'); return; }
    const text = await file.text();
    await this.run(() => this.transfer.importFromText(text));
  }

  protected async exportRoster(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const team = this.team();
    if (!workspaceId || !team) { this.notifications.notify({ title: 'Nessuna squadra', message: 'Crea prima la squadra di questo evento.', type: 'warning' }); return; }
    const players = await this.playerService.list(workspaceId, [team]);
    this.transfer.exportCsv(team, players);
    this.notifications.notify({ title: 'Rosa esportata', message: `${players.filter(player => !player.isArchived).length} giocatori nel file CSV (si apre con Excel).`, type: 'success' });
  }

  private async run(action: () => Promise<{ added: number; skipped: number; failed: string[]; teamCreated: boolean }>): Promise<void> {
    this.busy.set(true);
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
    } finally { this.busy.set(false); }
  }

  private async loadTeam(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.team.set((await this.teamService.list(workspaceId)).find(team => !team.isArchived) ?? null);
  }
}
