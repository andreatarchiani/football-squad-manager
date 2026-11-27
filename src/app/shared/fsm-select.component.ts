import { ChangeDetectionStrategy, Component, EventEmitter, Input, Output, signal } from '@angular/core';

/** Dropdown with the look of the other menus of the app (replaces the browser's own select). */
@Component({
  selector: 'fsm-select',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="sel" [class.is-open]="open()">
      <button type="button" class="sel-trigger" (click)="open.update(v => !v)" [attr.aria-expanded]="open()" aria-haspopup="listbox" [attr.aria-label]="label">
        <span [class.placeholder]="!value">{{ value || placeholder }}</span><i aria-hidden="true"></i>
      </button>
      @if (open()) {
        <div class="sel-backdrop" (click)="open.set(false)"></div>
        <div class="sel-menu" role="listbox">
          @for (option of options; track option) {
            <button type="button" role="option" [class.is-selected]="option === value" [attr.aria-selected]="option === value" (click)="pick(option)">{{ option }}@if (option === value) { <b>✓</b> }</button>
          } @empty { <span class="sel-empty">{{ emptyText }}</span> }
        </div>
      }
    </div>`,
  styles: [`
    :host { display: block; min-width: 0; }
    .sel { position: relative; }
    .sel.is-open { z-index: 80; }
    .sel-trigger { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 38px; padding: 4px 10px; border: 1.5px solid var(--c-hi, #5aa2ff); border-radius: 10px; color: #fff; background: rgba(0, 0, 0, .35); font: inherit; font-size: 14px; font-weight: 600; text-align: left; cursor: pointer; }
    .sel-trigger span { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sel-trigger .placeholder { color: var(--soft, #9aa7c0); font-weight: 500; }
    .sel-trigger i { flex: none; width: 8px; height: 8px; border-right: 2px solid currentColor; border-bottom: 2px solid currentColor; transform: rotate(45deg) translateY(-3px); }
    .sel-backdrop { position: fixed; inset: 0; z-index: 40; background: transparent; }
    .sel-menu { position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 50; display: grid; gap: 2px; max-height: 260px; padding: 6px; overflow-y: auto; border: 1.5px solid var(--c-hi, #5aa2ff); border-radius: 12px; background: var(--panel-solid, #0b1628); box-shadow: 0 12px 30px rgba(0, 0, 0, .6); }
    .sel-menu button { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 9px 10px; border: 0; border-radius: 8px; color: #fff; background: transparent; font: inherit; font-size: 14px; text-align: left; cursor: pointer; }
    .sel-menu button:is(:hover, .is-selected) { background: rgba(var(--c-rgb, 40, 110, 255), .25); }
    .sel-menu b { color: var(--c-hi, #5aa2ff); }
    .sel-empty { padding: 8px 10px; color: var(--soft, #9aa7c0); font-size: 13px; }
  `]
})
export class FsmSelectComponent {
  @Input() options: string[] = [];
  @Input() value = '';
  @Input() placeholder = 'Seleziona';
  @Input() label = '';
  @Input() emptyText = 'Nessuna opzione';
  @Output() readonly changed = new EventEmitter<string>();
  protected readonly open = signal(false);
  protected pick(option: string): void { this.open.set(false); this.changed.emit(option); }
}
