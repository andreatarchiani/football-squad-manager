import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { ActiveEventService } from '../../core/active-event.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { prepareIconImage } from '../../core/icon-image';
import { CalendarService, emptyGroupTeam, isMapsLink, type CalendarData, type CalendarRound, type GroupTeam } from '../calendar/calendar.service';

const TERRAINS = ['Erba naturale', 'Erba sintetica', 'Mista sintetico-naturale'];
const ICONS = ['⚽', '🛡️', '🏆', '⭐', '👑', '🦅', '🦁', '🐺', '🐉', '🔥', '⚡', '💎', '🏟️', '🎯', '🔱', '🌟'];

/** Opponent teams of the selected event ("Anagrafe squadre › Squadre avversarie"). */
@Component({
  selector: 'fsm-opponents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="op-bar"><strong>{{ teams().length }} squadre avversarie</strong><button type="button" class="op-add" (click)="create()">＋ Crea nuova squadra</button></div>
    @if (!teams().length) { <div class="op-empty">Nessuna squadra avversaria: creale qui e poi scegli dal calendario in quale giornata giocarle.</div> }
    <ul class="op-list">
      @for (team of teams(); track team.id) {
        <li><button type="button" (click)="edit(team)">
          <span class="op-logo">@if (isImage(team.icon)) { <img [src]="team.icon" alt=""> } @else { {{ team.icon || '⚽' }} }</span>
          <span class="op-name"><strong>{{ team.name }}</strong><small>{{ team.city || team.facilityName || 'Dati da completare' }}</small></span>
          <span class="op-edit">✎</span>
        </button></li>
      }
    </ul>
    @if (draft(); as d) {
      <div class="op-backdrop" role="presentation" (click)="close()">
        <section class="op-dialog" role="dialog" aria-modal="true" (click)="$event.stopPropagation()">
          <header><h3>{{ original() ? 'Modifica squadra avversaria' : 'Nuova squadra avversaria' }}</h3><button type="button" (click)="close()" aria-label="Chiudi">×</button></header>
          <div class="op-form">
            <div class="op-icons">
              @for (icon of icons; track icon) { <button type="button" [class.on]="d.icon === icon" (click)="set('icon', icon)">{{ icon }}</button> }
              <label class="op-up" [class.on]="isImage(d.icon)">@if (isImage(d.icon)) { <img [src]="d.icon" alt=""> } @else { ＋ }<input hidden type="file" accept="image/png,image/jpeg,image/webp,image/gif" (change)="upload($event)"></label>
            </div>
            <label>Nome squadra *<input maxlength="80" [value]="d.name" (input)="set('name', $any($event.target).value)" [class.bad]="!d.name.trim()"></label>
            @if (error()) { <p class="op-error">{{ error() }}</p> }
            <label>Nome impianto<input maxlength="100" [value]="d.facilityName" (input)="set('facilityName', $any($event.target).value)"></label>
            <label>Indirizzo impianto<input maxlength="180" [value]="d.address" (input)="set('address', $any($event.target).value)"></label>
            <label>Link di Maps dell’impianto<input type="url" maxlength="400" placeholder="Incolla qui il link" [value]="d.mapsUrl" (input)="set('mapsUrl', $any($event.target).value.trim())"></label>
            <fieldset><legend>Tipologia terreno di gioco *</legend>
              @for (terrain of terrains; track terrain) { <label class="op-radio"><input type="radio" name="terrain" [checked]="d.terrain === terrain" (change)="set('terrain', terrain)"> {{ terrain }}</label> }
            </fieldset>
            <div class="op-two">
              <label>Colore completo giocatori<input type="color" [value]="d.kitsField[0] || '#ffffff'" (input)="setKit('kitsField', $any($event.target).value)"></label>
              <label>Colore completo portieri<input type="color" [value]="d.kitsKeeper[0] || '#ffffff'" (input)="setKit('kitsKeeper', $any($event.target).value)"></label>
            </div>
            <label>Città<input maxlength="80" [value]="d.city" (input)="set('city', $any($event.target).value)"></label>
            <label>Indirizzo sede<input maxlength="180" [value]="d.headquarters" (input)="set('headquarters', $any($event.target).value)"></label>
            <label>Matricola federale<input maxlength="60" [value]="d.federation" (input)="set('federation', $any($event.target).value)"></label>
            <label>Referente<input maxlength="80" [value]="d.contact" (input)="set('contact', $any($event.target).value)"></label>
            <div class="op-two"><label>Telefono<input type="tel" maxlength="40" [value]="d.phone" (input)="set('phone', $any($event.target).value)"></label><label>Email<input type="email" maxlength="120" [value]="d.email" (input)="set('email', $any($event.target).value)"></label></div>
          </div>
          <footer>
            @if (original()) { <button type="button" class="del" (click)="remove()" [disabled]="used()" [title]="used() ? 'È usata nel calendario: toglila prima dalla giornata' : ''">Elimina</button> }
            <button type="button" (click)="close()">Annulla</button>
            <button type="button" class="ok" (click)="save()" [disabled]="!valid() || saving()">Salva</button>
          </footer>
        </section>
      </div>
    }
  `,
  styles: [`
    :host { display: block; color: #fff; }
    .op-bar { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 10px; }
    .op-add, footer button { min-height: 44px; padding: 0 16px; border: 1.5px solid var(--c-hi); border-radius: 12px; color: #fff; background: rgba(var(--c-rgb), .25); font: inherit; font-weight: 800; cursor: pointer; }
    .op-empty { padding: 24px; border: 1.5px dashed rgba(var(--c-rgb), .6); border-radius: 14px; text-align: center; color: var(--soft); }
    .op-list { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .op-list button { display: flex; align-items: center; gap: 12px; width: 100%; min-height: 60px; padding: 8px 12px; border: 1.5px solid rgba(var(--c-rgb), .55); border-radius: 14px; color: #fff; background: rgba(0, 0, 0, .3); font: inherit; text-align: left; cursor: pointer; }
    .op-logo { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 50%; background: rgba(255, 255, 255, .1); font-size: 24px; overflow: hidden; }
    .op-logo img, .op-up img { width: 100%; height: 100%; object-fit: cover; }
    .op-name { display: grid; flex: 1; } .op-name small { color: var(--soft); }
    .op-backdrop { position: fixed; inset: 0; z-index: 300; display: grid; place-items: center; padding: 12px; background: rgba(0, 0, 0, .7); }
    .op-dialog { display: grid; gap: 10px; width: min(560px, 100%); max-height: 94vh; padding: 14px; overflow: auto; border: 1.5px solid var(--c-hi); border-radius: 18px; background: var(--panel-solid, #0b1628); }
    .op-dialog header { display: flex; justify-content: space-between; align-items: center; } .op-dialog h3 { margin: 0; }
    .op-dialog header button { width: 40px; height: 40px; border: 1.5px solid rgba(255, 255, 255, .3); border-radius: 12px; color: #fff; background: none; font-size: 22px; }
    .op-form { display: grid; gap: 10px; }
    .op-form label { display: grid; gap: 4px; font-weight: 700; font-size: 13px; }
    .op-form input:not([type=radio]):not([type=color]) { min-height: 44px; padding: 0 12px; border: 1.5px solid rgba(var(--c-rgb), .6); border-radius: 12px; color: #fff; background: rgba(0, 0, 0, .35); font: inherit; }
    .op-form input[type=color] { width: 100%; height: 44px; border: 1.5px solid rgba(var(--c-rgb), .6); border-radius: 12px; background: none; }
    .op-form input.bad { border-color: #ff4458; }
    fieldset { display: grid; gap: 6px; margin: 0; padding: 10px; border: 1.5px solid rgba(var(--c-rgb), .5); border-radius: 12px; }
    .op-radio { display: flex !important; align-items: center; gap: 8px; grid-auto-flow: column; justify-content: start; }
    .op-icons { display: flex; flex-wrap: wrap; gap: 6px; }
    .op-icons button, .op-up { display: grid; place-items: center; width: 42px; height: 42px; border: 1.5px solid rgba(255, 255, 255, .3); border-radius: 12px; color: #fff; background: rgba(0, 0, 0, .3); font-size: 20px; cursor: pointer; overflow: hidden; }
    .op-icons .on, .op-up.on { border-color: #ffd21a; }
    .op-two { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
    .op-error { margin: 0; color: #ff8a97; }
    footer { display: flex; justify-content: flex-end; gap: 8px; }
    footer .ok { border-color: #fff3a6; color: #1a1300; background: linear-gradient(180deg, #ffe74d, #ffb800); } footer .del { margin-right: auto; border-color: #ff4458; } footer button:disabled { opacity: .45; }
  `]
})
export class OpponentsComponent {
  private readonly auth = inject(FirebaseAuthService);
  private readonly events = inject(ActiveEventService);
  private readonly service = inject(CalendarService);
  private readonly notifications = inject(NotificationService);

  protected readonly icons = ICONS;
  protected readonly terrains = TERRAINS;
  protected readonly draft = signal<GroupTeam | null>(null);
  protected readonly original = signal('');
  protected readonly saving = signal(false);
  protected readonly teams = computed(() => [...(this.events.active()?.groupTeams ?? [])].sort((a, b) => a.name.localeCompare(b.name)));
  protected readonly valid = computed(() => {
    const d = this.draft();
    if (!d || !d.name.trim()) return false;
    const name = d.name.trim().toLowerCase();
    return !this.teams().some(team => team.id !== d.id && team.name.toLowerCase() === name);
  });
  protected readonly error = computed(() => this.draft()?.name.trim() && !this.valid() ? 'Esiste già una squadra con questo nome in questo evento.' : '');
  protected readonly used = computed(() => {
    const d = this.draft();
    const calendar = this.events.active();
    if (!d || !calendar) return false;
    return [...calendar.andata, ...calendar.ritorno].some(round => round.opponent.trim().toLowerCase() === this.original().trim().toLowerCase() && !!round.opponent);
  });

  protected isImage(value: string | null | undefined): boolean { return typeof value === 'string' && value.startsWith('data:image/'); }
  protected create(): void { this.original.set(''); this.draft.set({ ...emptyGroupTeam(), id: `t-${Date.now().toString(36)}` }); }
  protected edit(team: GroupTeam): void { this.original.set(team.name); this.draft.set({ ...team, kitsField: [...team.kitsField], kitsKeeper: [...team.kitsKeeper] }); }
  protected close(): void { this.draft.set(null); }
  protected set(key: keyof GroupTeam, value: string): void { this.draft.update(d => d ? { ...d, [key]: value } : d); }
  protected setKit(key: 'kitsField' | 'kitsKeeper', value: string): void { this.draft.update(d => d ? { ...d, [key]: [value] } : d); }

  protected async upload(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file || !file.type.startsWith('image/') || file.size > 8 * 1024 * 1024) return;
    try { this.set('icon', await prepareIconImage(file)); } catch { /* ignore */ }
  }

  protected async save(): Promise<void> {
    const d = this.draft();
    if (!d || !this.valid()) return;
    const team: GroupTeam = { ...d, name: d.name.trim(), mapsUrl: isMapsLink(d.mapsUrl) ? d.mapsUrl.trim() : '' };
    const old = this.original();
    const rename = (round: CalendarRound) => old && round.opponent === old ? { ...round, opponent: team.name } : round;
    await this.persist(calendar => {
      const exists = calendar.groupTeams.some(item => item.id === team.id);
      const groupTeams = exists ? calendar.groupTeams.map(item => item.id === team.id ? team : item) : [...calendar.groupTeams, team];
      return { ...calendar, groupTeams, andata: calendar.andata.map(rename), ritorno: calendar.ritorno.map(rename) };
    });
  }

  protected async remove(): Promise<void> {
    const d = this.draft();
    if (!d || this.used()) return;
    await this.persist(calendar => ({ ...calendar, groupTeams: calendar.groupTeams.filter(team => team.id !== d.id) }));
  }

  /** Always starts from the calendar as it is saved now, so changes made in the calendar are never lost. */
  private async persist(change: (calendar: CalendarData) => CalendarData): Promise<void> {
    const workspaceId = this.auth.workspaceId();
    const eventId = this.events.activeId();
    if (!workspaceId || !eventId) return;
    this.saving.set(true);
    try {
      const fresh = await this.service.load(workspaceId, eventId);
      await this.service.save(workspaceId, change({ ...fresh, id: eventId }));
      await this.events.reload();
      this.draft.set(null);
    } catch (error) {
      console.error('Unable to save opponent team', error);
      this.notifications.notify({ title: 'Squadra non salvata', message: 'Riprova tra un momento.', type: 'warning' });
    } finally { this.saving.set(false); }
  }
}
