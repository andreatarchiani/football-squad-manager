import { ChangeDetectionStrategy, Component, HostListener, inject } from '@angular/core';
import { NotificationService, NotificationType } from './notification.service';

@Component({
  selector: 'fsm-notification-host',
  standalone: true,
  templateUrl: './notification-host.component.html',
  styleUrl: './notification-host.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class NotificationHostComponent {
  protected readonly service = inject(NotificationService);

  protected dismiss(id: number): void {
    this.service.dismiss(id);
  }

  protected resolve(confirmed: boolean): void {
    this.service.resolveConfirmation(confirmed);
  }

  protected iconFor(type: NotificationType): string {
    switch (type) {
      case 'success': return '✓';
      case 'error': return '!';
      case 'warning': return '⚠';
      default: return 'i';
    }
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    if (this.service.confirmation()) this.resolve(false);
  }
}
