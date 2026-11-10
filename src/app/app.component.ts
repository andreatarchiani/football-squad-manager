import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FirebaseAuthService } from './core/firebase-auth.service';
import { AuthPageComponent } from './features/auth/auth-page.component';
import { TeamsPageComponent } from './features/teams/teams-page.component';

@Component({
  selector: 'fsm-root',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, AuthPageComponent, TeamsPageComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  protected readonly navigation = ['Panoramica', 'Squadre', 'Giocatori', 'Formazioni', 'Partite'];
  protected readonly activePage = signal<'overview' | 'teams'>('overview');

  protected navigate(index: number): void {
    if (index === 0) this.activePage.set('overview');
    if (index === 1) this.activePage.set('teams');
  }
  protected readonly auth = inject(FirebaseAuthService);

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
