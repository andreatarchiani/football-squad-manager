import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, model, output, signal } from '@angular/core';

/**
 * Address box with suggestions (like Maps), used for the pitch of each match.
 *
 * - Free OpenStreetMap search (Photon), no API key.
 * - Results are centred on the area of the team (`near`, e.g. the team's own
 *   pitch address): typing "via fratelli lumiere" already proposes the street
 *   in your area first, without writing the city.
 * - The chosen place keeps its coordinates, so it can be opened or shared in Maps.
 */
export interface PickedAddress { value: string; lat: number | null; lon: number | null; }
interface Suggestion { title: string; subtitle: string; value: string; lat: number | null; lon: number | null; distanceKm: number | null; }

const ITALY_BBOX = '6.6,35.4,18.6,47.2';
const geoMemory = new Map<string, Promise<{ lat: number; lon: number } | null>>();

/** Coordinates of a free-text address (cached on the device). */
export function locateAddress(text: string): Promise<{ lat: number; lon: number } | null> {
  const key = text.trim().toLowerCase();
  if (!key) return Promise.resolve(null);
  const hit = geoMemory.get(key);
  if (hit) return hit;
  const request = (async () => {
    try {
      const stored = localStorage.getItem(`fsm-geo:${key}`);
      if (stored) return JSON.parse(stored) as { lat: number; lon: number };
    } catch { /* storage unavailable */ }
    try {
      const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(text)}&limit=1&bbox=${ITALY_BBOX}`);
      if (!response.ok) return null;
      const data = await response.json() as { features?: { geometry?: { coordinates?: number[] } }[] };
      const point = data.features?.[0]?.geometry?.coordinates;
      if (!point || point.length < 2) return null;
      const found = { lat: point[1], lon: point[0] };
      try { localStorage.setItem(`fsm-geo:${key}`, JSON.stringify(found)); } catch { /* storage unavailable */ }
      return found;
    } catch { return null; }
  })();
  geoMemory.set(key, request);
  return request;
}

/** Link that opens the place in Google Maps (app or web, on iPhone and Android). */
export function mapsLink(address: string, lat?: number | null, lon?: number | null): string {
  const query = lat != null && lon != null ? `${lat},${lon}` : address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function distanceKm(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

@Component({
  selector: 'fsm-address-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(document:pointerdown)': 'onOutside($event)' },
  template: `
    <div class="address-field" [class.is-open]="open() && suggestions().length > 0">
      <input type="text" autocomplete="off" [attr.name]="name()" [attr.maxlength]="maxlength()" [placeholder]="placeholder()"
        [value]="value()" (input)="onInput($any($event.target).value)" (focus)="onFocus()" (keydown)="onKey($event)"
        role="combobox" aria-autocomplete="list" [attr.aria-expanded]="open() && suggestions().length > 0">
      @if (searching()) { <span class="address-spinner" aria-hidden="true"></span> }
      @if (open() && suggestions().length) {
        <ul class="address-menu" role="listbox" aria-label="Indirizzi suggeriti">
          @for (item of suggestions(); track item.value + item.subtitle; let i = $index) {
            <li role="option" [class.active]="i === active()" [attr.aria-selected]="i === active()" (pointerdown)="$event.preventDefault(); choose(item)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.1-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>
              <span><strong>{{ item.title }}</strong>@if (item.subtitle) { <small>{{ item.subtitle }}</small> }</span>
              @if (item.distanceKm !== null) { <em>{{ item.distanceKm < 10 ? item.distanceKm.toFixed(1) : item.distanceKm.toFixed(0) }} km</em> }
            </li>
          }
          <li class="address-credit" aria-hidden="true">Dati © OpenStreetMap · più vicini alla tua squadra</li>
        </ul>
      }
    </div>
  `,
  styles: [`
    :host { display: block; min-width: 0; }
    .address-field { position: relative; }
    .address-field input { width: 100%; box-sizing: border-box; }
    .address-spinner { position: absolute; top: 50%; right: 12px; width: 14px; height: 14px; margin-top: -7px; border: 2px solid rgba(13, 26, 42, .25); border-top-color: #0d1a2a; border-radius: 50%; animation: address-spin .7s linear infinite; }
    @keyframes address-spin { to { transform: rotate(360deg); } }
    .address-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 60; display: grid; gap: 2px; max-height: 300px; margin: 0; padding: 6px; overflow-y: auto; list-style: none; border: 1.5px solid var(--c-hi, #4fd2ff); border-radius: 12px; background: var(--panel-solid, #071a38); box-shadow: 0 14px 34px rgba(0, 0, 0, .65); }
    .address-menu li { display: grid; grid-template-columns: 20px minmax(0, 1fr) auto; align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; color: #fff; cursor: pointer; }
    .address-menu li:is(:hover, .active) { background: rgba(var(--c-rgb, 42, 157, 255), .28); }
    .address-menu svg { width: 18px; height: 18px; fill: none; stroke: var(--c-hi, #4fd2ff); stroke-width: 1.8; }
    .address-menu strong { display: block; overflow: hidden; font-size: 14px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
    .address-menu small { display: block; overflow: hidden; color: var(--soft, #a9cbe8); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
    .address-menu em { color: var(--muted, #7d9bbb); font-size: 11px; font-style: normal; white-space: nowrap; }
    .address-menu .address-credit { display: block; padding: 4px 10px 0; color: var(--muted, #7d9bbb); font-size: 10px; cursor: default; }
    .address-menu .address-credit:hover { background: none; }
  `]
})
export class AddressFieldComponent implements OnDestroy {
  readonly value = model<string>('');
  readonly name = input<string>('');
  readonly placeholder = input<string>('');
  readonly maxlength = input<number>(180);
  /** Address used to centre the search (e.g. the team's pitch). */
  readonly near = input<string>('');
  /** Emitted when a suggestion is chosen (with coordinates) or the text is typed by hand (without). */
  readonly picked = output<PickedAddress>();

  protected readonly suggestions = signal<Suggestion[]>([]);
  protected readonly open = signal(false);
  protected readonly active = signal(-1);
  protected readonly searching = signal(false);

  private readonly host = inject(ElementRef<HTMLElement>);
  private timer: ReturnType<typeof setTimeout> | null = null;
  private request: AbortController | null = null;
  private readonly memory = new Map<string, Suggestion[]>();

  protected onInput(text: string): void {
    this.value.set(text);
    this.picked.emit({ value: text, lat: null, lon: null });
    this.active.set(-1);
    this.schedule(text);
  }

  protected onFocus(): void {
    if (this.suggestions().length) this.open.set(true);
    if (this.near()) void locateAddress(this.near()); // warm up the centre of the search
  }

  protected onKey(event: KeyboardEvent): void {
    const list = this.suggestions();
    if (!this.open() || !list.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.active.set((this.active() + 1) % list.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.active.set((this.active() - 1 + list.length) % list.length); }
    else if (event.key === 'Enter' && this.active() >= 0) { event.preventDefault(); this.choose(list[this.active()]); }
    else if (event.key === 'Escape') { this.open.set(false); }
  }

  protected choose(item: Suggestion): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    this.request?.abort();
    this.value.set(item.value);
    this.picked.emit({ value: item.value, lat: item.lat, lon: item.lon });
    this.open.set(false);
    this.suggestions.set([]);
    this.searching.set(false);
  }

  protected onOutside(event: PointerEvent): void {
    if (!this.host.nativeElement.contains(event.target as Node)) this.open.set(false);
  }

  ngOnDestroy(): void {
    if (this.timer) clearTimeout(this.timer);
    this.request?.abort();
  }

  private schedule(text: string): void {
    if (this.timer) clearTimeout(this.timer);
    const query = text.trim();
    if (query.length < 4) { this.request?.abort(); this.suggestions.set([]); this.open.set(false); this.searching.set(false); return; }
    this.timer = setTimeout(() => void this.search(query), 250);
  }

  private async search(query: string): Promise<void> {
    const key = `${query.toLowerCase()}|${this.near().toLowerCase()}`;
    const remembered = this.memory.get(key);
    if (remembered) { this.show(remembered); return; }
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    this.searching.set(true);
    try {
      const centre = this.near() ? await locateAddress(this.near()) : null;
      const bias = centre ? `&lat=${centre.lat}&lon=${centre.lon}&zoom=11&location_bias_scale=0.1` : '';
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=12&bbox=${ITALY_BBOX}${bias}`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { features?: { properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }[] };
      const items = this.rank(this.toSuggestions(data.features ?? [], centre));
      this.memory.set(key, items);
      if (this.request === controller) this.show(items);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') { this.suggestions.set([]); this.open.set(false); }
    } finally {
      if (this.request === controller) this.searching.set(false);
    }
  }

  /** Closest places first; very far results are hidden when closer ones exist. */
  private rank(items: Suggestion[]): Suggestion[] {
    const withDistance = items.filter(item => item.distanceKm !== null);
    if (!withDistance.length) return items.slice(0, 6);
    const near = withDistance.filter(item => (item.distanceKm ?? 0) <= 80);
    const pool = near.length ? near : withDistance;
    return pool.sort((a, b) => (a.distanceKm ?? 0) - (b.distanceKm ?? 0)).slice(0, 6);
  }

  private show(items: Suggestion[]): void {
    this.suggestions.set(items);
    this.open.set(items.length > 0 && this.host.nativeElement.contains(document.activeElement));
  }

  private toSuggestions(features: { properties?: Record<string, unknown>; geometry?: { coordinates?: number[] } }[], centre: { lat: number; lon: number } | null): Suggestion[] {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const feature of features) {
      const p = feature.properties ?? {};
      const text = (k: string) => String(p[k] ?? '').trim();
      if (text('countrycode') && text('countrycode') !== 'IT') continue;
      const street = text('street') ? `${text('street')}${text('housenumber') ? ' ' + text('housenumber') : ''}` : '';
      const isStreet = text('osm_key') === 'highway' || text('type') === 'street';
      const name = text('name');
      const city = text('city') || text('town') || text('village') || text('district') || text('county');
      const place = [text('postcode'), city].filter(Boolean).join(' ');
      const province = text('county') && text('county') !== city ? text('county') : '';
      const main = street || name;
      if (!main) continue;
      const value = [isStreet || !street || name === street ? main : `${name}, ${street}`, place].filter(Boolean).join(', ');
      if (seen.has(value)) continue;
      seen.add(value);
      const point = feature.geometry?.coordinates;
      const lat = point && point.length > 1 ? point[1] : null;
      const lon = point && point.length > 1 ? point[0] : null;
      const title = name && street && name !== street ? name : main;
      const subtitle = [title === main ? '' : street, place, province].filter(Boolean).join(', ');
      out.push({ title, subtitle, value, lat, lon, distanceKm: centre && lat !== null && lon !== null ? distanceKm(centre, { lat, lon }) : null });
    }
    return out;
  }
}
