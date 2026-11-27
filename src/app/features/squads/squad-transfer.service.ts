import { Injectable, inject } from '@angular/core';
import { collection, deleteDoc, doc, getDocs, setDoc } from 'firebase/firestore';
import { FIRESTORE_DB } from '../../core/firebase.tokens';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { ActiveEventService } from '../../core/active-event.service';
import { TeamService, type TeamInput, type TeamRecord } from '../teams/team.service';
import { PLAYER_ROLES, PlayerService, type PlayerInput, type PlayerRecord, type PlayerRole, type PlayerStatus } from '../players/player.service';

export type Progress = (done: number, total: number) => void;
export interface ImportResult { added: number; skipped: number; failed: string[]; teamCreated: boolean; }

const COLUMNS = ['Cognome', 'Nome', 'Numero', 'Ruolo', 'Stato', 'Data di nascita', 'Luogo di nascita', 'Residenza', 'CAP', 'Documento identità', 'Categoria appartenenza', 'Matricola federale', 'Tessera federale', 'Telefono', 'Mail', 'Piede', 'Note'] as const;
const STATUS_LABEL: Record<PlayerStatus, string> = { active: 'Attivo', injured: 'Infortunato', suspended: 'Squalificato', left: 'Ceduto' };

/** Copies a squad from another event or from a file, and exports it (CSV, opens in Excel). */
@Injectable({ providedIn: 'root' })
export class SquadTransferService {
  private readonly db = inject(FIRESTORE_DB, { optional: true });
  private readonly auth = inject(FirebaseAuthService);
  private readonly events = inject(ActiveEventService);
  private readonly teamService = inject(TeamService);
  private readonly playerService = inject(PlayerService);

  /** Events (other than the current one) that have a team with players to copy. */
  async sourceEvents(): Promise<{ id: string; title: string; team: string; players: number }[]> {
    const workspaceId = this.auth.workspaceId();
    if (!workspaceId) return [];
    const teams = (await this.teamService.listAll(workspaceId)).filter(team => !team.isArchived);
    const players = await this.playerService.list(workspaceId, teams);
    return this.events.events().filter(event => event.id !== this.events.activeId()).flatMap(event => {
      const own = teams.filter(team => this.events.eventOfTeam(team) === event.id);
      const count = players.filter(player => own.some(team => team.id === player.teamId) && !player.isArchived).length;
      return own.length ? [{ id: event.id, title: this.events.activeTitleOf(event), team: own[0].name, players: count }] : [];
    });
  }

  /** Copies the team (if the current event has none) and all its players from another event. */
  async importFromEvent(sourceEventId: string, onProgress?: Progress): Promise<ImportResult> {
    const workspaceId = this.requireWorkspace();
    const all = (await this.teamService.listAll(workspaceId)).filter(team => !team.isArchived);
    const sources = all.filter(team => this.events.eventOfTeam(team) === sourceEventId);
    if (!sources.length) throw new Error('L’evento scelto non ha una squadra da importare.');
    const sourcePlayers = (await this.playerService.list(workspaceId, sources)).filter(player => !player.isArchived && player.status !== 'left');
    const { team, created } = await this.ensureTarget(workspaceId, sources[0]);
    const inputs = sourcePlayers.map(player => this.toInput(player, team.id));
    return { ...(await this.addPlayers(workspaceId, team, inputs, onProgress)), teamCreated: created };
  }

  /** Adds the players read from a CSV/Excel file to the team of the current event. */
  async importFromText(text: string, onProgress?: Progress): Promise<ImportResult> {
    const workspaceId = this.requireWorkspace();
    const [team] = await this.teamService.list(workspaceId);
    if (!team) throw new Error('Prima crea la squadra di questo evento, poi importa i giocatori.');
    const inputs = this.parseCsv(text, team.id);
    if (!inputs.length) throw new Error('Nel file non ho trovato giocatori: servono almeno le colonne Cognome, Nome e Numero.');
    return { ...(await this.addPlayers(workspaceId, team, inputs, onProgress)), teamCreated: false };
  }

  /** Saves a copy of the squad inside the app, so it can be imported into any other event. */
  async exportToApp(team: TeamRecord, players: PlayerRecord[]): Promise<number> {
    const workspaceId = this.requireWorkspace();
    if (!this.db) throw new Error('Database non disponibile.');
    const list = players.filter(player => !player.isArchived && player.status !== 'left');
    const { id, ...teamData } = JSON.parse(JSON.stringify(team)) as TeamRecord;
    void id;
    await setDoc(doc(this.db, 'workspaces', workspaceId, 'squadExports', team.id), {
      name: team.name, eventTitle: this.events.activeTitle(), exportedAt: Date.now(), team: teamData,
      players: list.map(player => JSON.parse(JSON.stringify(this.toInput(player, '')))) 
    });
    return list.length;
  }

  async listExports(): Promise<{ id: string; name: string; eventTitle: string; count: number }[]> {
    const workspaceId = this.requireWorkspace();
    if (!this.db) return [];
    const snap = await getDocs(collection(this.db, 'workspaces', workspaceId, 'squadExports'));
    return snap.docs.map(item => { const d = item.data(); return { id: item.id, name: String(d['name'] ?? ''), eventTitle: String(d['eventTitle'] ?? ''), count: Array.isArray(d['players']) ? d['players'].length : 0, at: Number(d['exportedAt'] ?? 0) }; })
      .sort((a, b) => b.at - a.at).map(({ at, ...rest }) => { void at; return rest; });
  }

  async deleteExport(id: string): Promise<void> {
    if (this.db) await deleteDoc(doc(this.db, 'workspaces', this.requireWorkspace(), 'squadExports', id));
  }

  /** Imports an exported squad into the current event (creating the team if the event has none). */
  async importFromExport(exportId: string, onProgress?: Progress): Promise<ImportResult> {
    const workspaceId = this.requireWorkspace();
    if (!this.db) throw new Error('Database non disponibile.');
    const snap = await getDocs(collection(this.db, 'workspaces', workspaceId, 'squadExports'));
    const item = snap.docs.find(entry => entry.id === exportId);
    if (!item) throw new Error('La squadra esportata non esiste più.');
    const data = item.data();
    const source = { ...(data['team'] as object), id: exportId } as TeamRecord;
    const { team, created } = await this.ensureTarget(workspaceId, source);
    const players = ((data['players'] as PlayerInput[]) ?? []).map(player => ({ ...player, teamId: team.id }));
    return { ...(await this.addPlayers(workspaceId, team, players, onProgress)), teamCreated: created };
  }

  /** Downloads the squad as a CSV file that Excel opens directly. */
  exportCsv(team: TeamRecord, players: PlayerRecord[]): void {
    const rows = players.filter(player => !player.isArchived).sort((a, b) => (a.shirtNumber ?? 999) - (b.shirtNumber ?? 999)).map(player => [
      player.lastName, player.firstName, player.shirtNumber ?? '', player.primaryRole, STATUS_LABEL[player.status] ?? 'Attivo', player.dateOfBirth, player.placeOfBirth, player.residence, player.postalCode,
      player.identityDocument, player.affiliationCategory, player.federationNumber, player.federationCard, player.keyContactPhone, player.keyContactEmail, player.preferredFoot, player.notes
    ]);
    const csv = [COLUMNS as unknown as string[], ...rows].map(row => row.map(cell => this.cell(cell)).join(';')).join('\r\n');
    const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${this.fileName(team.name)}-rosa.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(link.href), 4000);
  }

  /* ----------------------------------------------------------- helpers */
  private async ensureTarget(workspaceId: string, source: TeamRecord): Promise<{ team: TeamRecord; created: boolean }> {
    const existing = (await this.teamService.list(workspaceId))[0];
    if (existing) return { team: existing, created: false };
    const seasonLabel = this.events.active()?.event.seasonLabel || source.seasonLabel;
    const input: TeamInput = { ...source, seasonLabel };
    const id = await this.teamService.create(workspaceId, input);
    const team = (await this.teamService.list(workspaceId)).find(item => item.id === id);
    if (!team) throw new Error('Non sono riuscito a creare la squadra nel nuovo evento.');
    return { team, created: true };
  }

  private async addPlayers(workspaceId: string, team: TeamRecord, inputs: PlayerInput[], onProgress?: Progress): Promise<Omit<ImportResult, 'teamCreated'>> {
    const existing = await this.playerService.list(workspaceId, [team]);
    const key = (first: string, last: string, birth: string) => `${last}|${first}|${birth}`.toLowerCase().trim();
    const known = new Set(existing.map(player => key(player.firstName, player.lastName, player.dateOfBirth)));
    const taken = new Set(existing.map(player => player.shirtNumber).filter((n): n is number => n !== null));
    const result = { added: 0, skipped: 0, failed: [] as string[] };
    // Decide numbers first (a number already used in this team gets the first free one), then save a few players at a time.
    const jobs: { input: PlayerInput; label: string }[] = [];
    for (const input of inputs) {
      const id = key(input.firstName, input.lastName, input.dateOfBirth);
      if (known.has(id)) { result.skipped++; continue; }
      known.add(id);
      let number = Number(input.shirtNumber);
      if (!Number.isInteger(number) || number < 1 || number > 99 || taken.has(number)) number = Array.from({ length: 99 }, (_, i) => i + 1).find(n => !taken.has(n)) ?? 0;
      taken.add(number);
      jobs.push({ input: { ...input, shirtNumber: String(number) }, label: `${input.lastName} ${input.firstName}`.trim() });
    }
    let done = 0;
    onProgress?.(0, jobs.length);
    for (let i = 0; i < jobs.length; i += 4) {
      await Promise.all(jobs.slice(i, i + 4).map(async job => {
        try {
          await Promise.race([this.playerService.save(workspaceId, job.input, [team]), new Promise((_, reject) => setTimeout(() => reject(new Error('tempo scaduto')), 25000))]);
          result.added++;
        } catch (error) { result.failed.push(`${job.label}: ${(error as Error).message}`); }
        onProgress?.(++done, jobs.length);
      }));
    }
    return result;
  }

  private toInput(player: PlayerRecord, teamId: string): PlayerInput {
    return {
      firstName: player.firstName, lastName: player.lastName, dateOfBirth: player.dateOfBirth, placeOfBirth: player.placeOfBirth, residence: player.residence, postalCode: player.postalCode,
      identityDocument: player.identityDocument, affiliationCategory: player.affiliationCategory, federationNumber: player.federationNumber, federationCard: player.federationCard,
      keyContactPhone: player.keyContactPhone, keyContactEmail: player.keyContactEmail, preferredFoot: player.preferredFoot, primaryRole: player.primaryRole, notes: player.notes,
      teamId, shirtNumber: player.shirtNumber == null ? '' : String(player.shirtNumber), roles: [...player.roles], status: player.status,
      guardians: { mother: player.guardians.mother ? { ...player.guardians.mother } : null, father: player.guardians.father ? { ...player.guardians.father } : null }
    };
  }

  private parseCsv(text: string, teamId: string): PlayerInput[] {
    const clean = text.replace(/^﻿/, '');
    const delimiter = (clean.split('\n')[0] ?? '').split(';').length >= (clean.split('\n')[0] ?? '').split(',').length ? ';' : ',';
    const rows = this.splitRows(clean, delimiter).filter(row => row.some(cell => cell.trim()));
    if (rows.length < 2) return [];
    const header = rows[0].map(cell => cell.trim().toLowerCase());
    const at = (names: string[]) => header.findIndex(name => names.includes(name));
    const col = {
      last: at(['cognome']), first: at(['nome']), number: at(['numero', 'n°', 'numero maglia']), role: at(['ruolo']), status: at(['stato']), birth: at(['data di nascita']), place: at(['luogo di nascita']),
      residence: at(['residenza']), cap: at(['cap']), doc: at(['documento identità', 'documento identita', 'documento']), category: at(['categoria appartenenza', 'categoria']),
      federation: at(['matricola federale', 'matricola']), card: at(['tessera federale', 'tessera']), phone: at(['telefono']), mail: at(['mail', 'email']), foot: at(['piede']), notes: at(['note'])
    };
    if (col.last < 0 || col.first < 0) return [];
    const get = (row: string[], index: number) => index >= 0 ? (row[index] ?? '').trim() : '';
    return rows.slice(1).filter(row => get(row, col.last) && get(row, col.first)).map(row => {
      const role = (PLAYER_ROLES.find(item => item.toLowerCase() === get(row, col.role).toLowerCase()) ?? 'Centrocampista') as PlayerRole;
      const status = (Object.entries(STATUS_LABEL).find(([, label]) => label.toLowerCase() === get(row, col.status).toLowerCase())?.[0] ?? 'active') as PlayerStatus;
      return {
        firstName: get(row, col.first), lastName: get(row, col.last), dateOfBirth: get(row, col.birth), placeOfBirth: get(row, col.place), residence: get(row, col.residence), postalCode: get(row, col.cap),
        identityDocument: get(row, col.doc), affiliationCategory: get(row, col.category), federationNumber: get(row, col.federation), federationCard: get(row, col.card),
        keyContactPhone: get(row, col.phone), keyContactEmail: get(row, col.mail), preferredFoot: get(row, col.foot), primaryRole: role, notes: get(row, col.notes),
        teamId, shirtNumber: get(row, col.number), roles: [role], status, guardians: { mother: null, father: null }
      } satisfies PlayerInput;
    });
  }

  private splitRows(text: string, delimiter: string): string[][] {
    const rows: string[][] = []; let row: string[] = []; let cell = ''; let quoted = false;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === delimiter) { row.push(cell); cell = ''; }
      else if (char === '\n' || char === '\r') { if (char === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += char;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  private cell(value: string | number): string {
    const text = String(value ?? '');
    return /[;"\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }
  private fileName(name: string): string { return name.trim().replace(/[^\w\-]+/g, '-').replace(/^-+|-+$/g, '') || 'squadra'; }
  private requireWorkspace(): string {
    const id = this.auth.workspaceId();
    if (!id) throw new Error('Area di lavoro non disponibile.');
    return id;
  }
}
