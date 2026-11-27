import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { ActiveEventService } from '../../core/active-event.service';
import { FsmSelectComponent } from '../../shared/fsm-select.component';
import { TeamService, type TeamRecord } from '../teams/team.service';
import { PlayerService, type PlayerRecord } from '../players/player.service';
import { StaffService, type StaffRecord } from '../staff/staff.service';
import { SquadTransferService } from '../squads/squad-transfer.service';

type Tab = 'players' | 'staff' | 'teams';
const STATUS: Record<string, string> = { active: 'Attivo', injured: 'Infortunato', suspended: 'Squalificato', left: 'Ceduto' };

/** "Archivio anagrafe" of the selected event: players, officials and teams in one searchable list. */
@Component({
  selector: 'fsm-archive',
  standalone: true,
  imports: [FsmSelectComponent],
  templateUrl: './archive-page.component.html',
  styleUrl: './archive-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ArchivePageComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly events = inject(ActiveEventService);
  private readonly teamService = inject(TeamService);
  private readonly playerService = inject(PlayerService);
  private readonly staffService = inject(StaffService);
  private readonly transfer = inject(SquadTransferService);

  protected readonly tab = signal<Tab>('players');
  protected readonly search = signal('');
  protected readonly status = signal('Tutti');
  protected readonly pageSize = signal('10');
  protected readonly page = signal(0);
  protected readonly statuses = ['Tutti', 'Attivo', 'Infortunato', 'Squalificato', 'Ceduto'];
  protected readonly sizes = ['10', '25', '50'];
  protected readonly loading = signal(true);
  protected readonly team = signal<TeamRecord | null>(null);
  protected readonly players = signal<PlayerRecord[]>([]);
  protected readonly staff = signal<StaffRecord[]>([]);
  protected readonly opponents = computed(() => this.events.active()?.groupTeams ?? []);
  protected readonly eventTitle = this.events.activeTitle;
  protected readonly statusLabel = (key: string) => STATUS[key] ?? key;

  protected readonly rows = computed(() => {
    const q = this.search().trim().toLowerCase();
    const match = (...values: (string | number | null | undefined)[]) => !q || values.some(value => String(value ?? '').toLowerCase().includes(q));
    if (this.tab() === 'players') {
      const status = this.status();
      return this.players().filter(player => !player.isArchived && (status === 'Tutti' || STATUS[player.status] === status) && match(player.firstName, player.lastName, player.shirtNumber, player.federationNumber, player.federationCard))
        .sort((a, b) => (a.shirtNumber ?? 999) - (b.shirtNumber ?? 999));
    }
    if (this.tab() === 'staff') return this.staff().filter(item => match(item.firstName, item.lastName, item.federationNumber)).sort((a, b) => a.lastName.localeCompare(b.lastName));
    return this.opponents().filter(team => match(team.name, team.city, team.facilityName)).sort((a, b) => a.name.localeCompare(b.name));
  });
  protected readonly total = computed(() => this.rows().length);
  protected readonly pages = computed(() => Math.max(1, Math.ceil(this.total() / Number(this.pageSize()))));
  protected readonly visible = computed(() => { const size = Number(this.pageSize()); return this.rows().slice(this.page() * size, this.page() * size + size) as any[]; });

  constructor() {
    effect(() => { if (this.auth.workspaceId() && this.events.activeId()) void this.load(); });
  }

  protected setTab(tab: Tab): void { this.tab.set(tab); this.page.set(0); this.search.set(''); }
  protected setSearch(value: string): void { this.search.set(value); this.page.set(0); }
  protected move(step: number): void { this.page.update(page => Math.min(this.pages() - 1, Math.max(0, page + step))); }

  protected exportList(): void {
    const team = this.team();
    if (this.tab() === 'players' && team) { this.transfer.exportCsv(team, this.players()); return; }
    const rows = this.tab() === 'staff'
      ? [['Cognome', 'Nome', 'Data di nascita', 'Categoria', 'Matricola', 'Tessera'], ...this.staff().map(item => [item.lastName, item.firstName, item.dateOfBirth, item.affiliationCategory, item.federationNumber, item.federationCard])]
      : [['Squadra', 'Città', 'Impianto', 'Terreno', 'Referente', 'Telefono'], ...this.opponents().map(item => [item.name, item.city, item.facilityName, item.terrain, item.contact, item.phone])];
    const csv = rows.map(row => row.map(cell => /[;"\n]/.test(String(cell ?? '')) ? `"${String(cell).replace(/"/g, '""')}"` : String(cell ?? '')).join(';')).join('\r\n');
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
    link.download = `archivio-${this.tab()}.csv`;
    document.body.appendChild(link); link.click(); link.remove();
  }
  protected print(): void { window.print(); }

  private async load(): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return;
    this.loading.set(true);
    try {
      await this.events.whenReady();
      const teams = (await this.teamService.list(workspaceId)).filter(team => !team.isArchived);
      this.team.set(teams[0] ?? null);
      const [players, staff] = await Promise.all([this.playerService.list(workspaceId, teams), this.staffService.list(workspaceId)]);
      this.players.set(players); this.staff.set(staff);
    } catch (error) { console.error('Unable to load archive', error); }
    finally { this.loading.set(false); }
  }
}
