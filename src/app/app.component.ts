import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { FirebaseAuthService } from './core/firebase-auth.service';
import { AuthPageComponent } from './features/auth/auth-page.component';

@Component({
  selector: 'fsm-root',
  standalone: true,
  imports: [MatButtonModule, MatIconModule, AuthPageComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AppComponent {
  protected readonly navigation = ['Panoramica', 'Squadre', 'Giocatori', 'Formazioni', 'Partite'];
  protected readonly auth = inject(FirebaseAuthService);

  protected async signOut(): Promise<void> {
    await this.auth.signOut();
  }
}
