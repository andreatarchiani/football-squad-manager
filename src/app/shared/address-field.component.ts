import { ChangeDetectionStrategy, Component, ElementRef, OnDestroy, inject, input, model, signal } from '@angular/core';

/**
 * Text field that suggests real addresses while typing (like Maps).
 *
 * Uses the free Photon geocoder (OpenStreetMap data, no API key). To keep the
 * app light it only asks after 3 letters and a short pause, cancels older
 * requests and never blocks typing: if the service is unreachable the field
 * simply works as a normal text box.
 */
interface Suggestion { title: string; subtitle: string; value: string; }

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
          @for (item of suggestions(); track item.value; let i = $index) {
            <li role="option" [class.active]="i === active()" [attr.aria-selected]="i === active()" (pointerdown)="$event.preventDefault(); choose(item)">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21s-6.5-6.1-6.5-11.2a6.5 6.5 0 0 1 13 0C18.5 14.9 12 21 12 21z"/><circle cx="12" cy="9.8" r="2.3"/></svg>
              <span><strong>{{ item.title }}</strong>@if (item.subtitle) { <small>{{ item.subtitle }}</small> }</span>
            </li>
          }
          <li class="address-credit" aria-hidden="true">Dati © OpenStreetMap</li>
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
    .address-menu { position: absolute; top: calc(100% + 4px); left: 0; right: 0; z-index: 60; display: grid; gap: 2px; max-height: 280px; margin: 0; padding: 6px; overflow-y: auto; list-style: none; border: 1.5px solid var(--c-hi, #4fd2ff); border-radius: 12px; background: var(--panel-solid, #071a38); box-shadow: 0 14px 34px rgba(0, 0, 0, .65); }
    .address-menu li { display: grid; grid-template-columns: 20px minmax(0, 1fr); align-items: center; gap: 8px; padding: 8px 10px; border-radius: 8px; color: #fff; cursor: pointer; }
    .address-menu li:is(:hover, .active) { background: rgba(var(--c-rgb, 42, 157, 255), .28); }
    .address-menu svg { width: 18px; height: 18px; fill: none; stroke: var(--c-hi, #4fd2ff); stroke-width: 1.8; }
    .address-menu strong { display: block; overflow: hidden; font-size: 14px; font-weight: 600; white-space: nowrap; text-overflow: ellipsis; }
    .address-menu small { display: block; overflow: hidden; color: var(--soft, #a9cbe8); font-size: 12px; white-space: nowrap; text-overflow: ellipsis; }
    .address-menu .address-credit { display: block; padding: 4px 10px 0; color: var(--muted, #7d9bbb); font-size: 10px; cursor: default; }
    .address-menu .address-credit:hover { background: none; }
  `]
})
export class AddressFieldComponent implements OnDestroy {
  readonly value = model<string>('');
  readonly name = input<string>('');
  readonly placeholder = input<string>('');
  readonly maxlength = input<number>(180);

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
    this.active.set(-1);
    this.schedule(text);
  }

  protected onFocus(): void { if (this.suggestions().length) this.open.set(true); }

  protected onKey(event: KeyboardEvent): void {
    const list = this.suggestions();
    if (!this.open() || !list.length) return;
    if (event.key === 'ArrowDown') { event.preventDefault(); this.active.set((this.active() + 1) % list.length); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.active.set((this.active() - 1 + list.length) % list.length); }
    else if (event.key === 'Enter' && this.active() >= 0) { event.preventDefault(); this.choose(list[this.active()]); }
    else if (event.key === 'Escape') { this.open.set(false); }
  }

  protected choose(item: Suggestion): void {
    this.value.set(item.value);
    this.open.set(false);
    this.suggestions.set([]);
    this.host.nativeElement.querySelector('input')?.dispatchEvent(new Event('input', { bubbles: true }));
    // The value is final: do not search again because of the event above.
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
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
    if (query.length < 3) { this.request?.abort(); this.suggestions.set([]); this.open.set(false); this.searching.set(false); return; }
    this.timer = setTimeout(() => void this.search(query), 380);
  }

  private async search(query: string): Promise<void> {
    const key = query.toLowerCase();
    const remembered = this.memory.get(key);
    if (remembered) { this.show(remembered); return; }
    this.request?.abort();
    const controller = new AbortController();
    this.request = controller;
    this.searching.set(true);
    try {
      // Biased towards Italy; results are limited to keep the response tiny.
      const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=6&lat=43.0&lon=12.0&location_bias_scale=0.4`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.json() as { features?: { properties?: Record<string, unknown> }[] };
      const items = this.toSuggestions(data.features ?? []);
      this.memory.set(key, items);
      if (this.request === controller) this.show(items);
    } catch (error) {
      if ((error as Error).name !== 'AbortError') { this.suggestions.set([]); this.open.set(false); }
    } finally {
      if (this.request === controller) this.searching.set(false);
    }
  }

  private show(items: Suggestion[]): void {
    this.suggestions.set(items);
    this.open.set(items.length > 0 && this.host.nativeElement.contains(document.activeElement));
  }

  private toSuggestions(features: { properties?: Record<string, unknown> }[]): Suggestion[] {
    const seen = new Set<string>();
    const out: Suggestion[] = [];
    for (const feature of features) {
      const p = feature.properties ?? {};
      const text = (k: string) => String(p[k] ?? '').trim();
      const street = text('street') ? `${text('street')}${text('housenumber') ? ' ' + text('housenumber') : ''}` : '';
      const city = text('city') || text('town') || text('village') || text('district') || text('county');
      const place = [text('postcode'), city].filter(Boolean).join(' ');
      const province = text('county') && text('county') !== city ? text('county') : '';
      const name = text('name');
      const main = street || name;
      if (!main) continue;
      const value = [main, place].filter(Boolean).join(', ');
      if (seen.has(value)) continue;
      seen.add(value);
      const title = name && street && name !== street ? name : main;
      const subtitle = [title === main ? '' : street, place, province, text('country') !== 'Italia' ? text('country') : ''].filter(Boolean).join(', ');
      out.push({ title, subtitle, value });
    }
    return out;
  }
}
