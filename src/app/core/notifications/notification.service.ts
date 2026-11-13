import { Injectable, signal } from '@angular/core';

export type NotificationType = 'success' | 'error' | 'info' | 'warning';
export type ConfirmationTone = 'default' | 'danger';

export interface AppNotification {
  id: number;
  title: string;
  message?: string;
  type: NotificationType;
}

export interface NotificationOptions {
  title: string;
  message?: string;
  type?: NotificationType;
  durationMs?: number;
}

export interface ConfirmationOptions {
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  tone?: ConfirmationTone;
  icon?: 'archive';
}

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private readonly notificationState = signal<AppNotification[]>([]);
  private readonly confirmationState = signal<ConfirmationOptions | null>(null);
  private nextId = 0;
  private confirmationResolver: ((confirmed: boolean) => void) | null = null;

  readonly notifications = this.notificationState.asReadonly();
  readonly confirmation = this.confirmationState.asReadonly();

  notify(options: NotificationOptions): void {
    const notification: AppNotification = {
      id: ++this.nextId,
      title: options.title,
      message: options.message,
      type: options.type ?? 'info'
    };

    this.notificationState.update((items) => [...items, notification]);
    const duration = options.durationMs ?? 4500;
    if (duration > 0 && typeof window !== 'undefined') {
      window.setTimeout(() => this.dismiss(notification.id), duration);
    }
  }

  dismiss(id: number): void {
    this.notificationState.update((items) => items.filter((item) => item.id !== id));
  }

  confirm(options: ConfirmationOptions): Promise<boolean> {
    if (this.confirmationResolver) {
      this.confirmationResolver(false);
    }

    this.confirmationState.set({
      confirmText: 'Conferma',
      cancelText: 'Annulla',
      tone: 'default',
      ...options
    });

    return new Promise<boolean>((resolve) => {
      this.confirmationResolver = resolve;
    });
  }

  resolveConfirmation(confirmed: boolean): void {
    const resolve = this.confirmationResolver;
    this.confirmationResolver = null;
    this.confirmationState.set(null);
    resolve?.(confirmed);
  }
}
