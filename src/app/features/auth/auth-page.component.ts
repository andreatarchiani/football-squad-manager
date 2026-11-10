import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';

type AuthMode = 'login' | 'register' | 'reset';

@Component({
  selector: 'fsm-auth-page',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './auth-page.component.html',
  styleUrl: './auth-page.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class AuthPageComponent {
  protected readonly auth = inject(FirebaseAuthService);
  protected mode: AuthMode = 'login';
  protected displayName = '';
  protected email = '';
  protected password = '';
  protected busy = false;
  protected message = '';
  protected error = '';

  protected async submit(): Promise<void> {
    this.message = '';
    this.error = '';
    this.busy = true;
    try {
      if (this.mode === 'register') {
        await this.auth.register(this.email, this.password, this.displayName);
        this.message = 'Account creato. Stiamo preparando il tuo spazio personale…';
      } else if (this.mode === 'reset') {
        await this.auth.sendPasswordReset(this.email);
        this.message = 'Se l’indirizzo è registrato, riceverai un’email per reimpostare la password.';
      } else {
        await this.auth.signIn(this.email, this.password);
      }
    } catch (error) {
      this.error = this.describeError(error);
    } finally {
      this.busy = false;
    }
  }

  protected async googleSignIn(): Promise<void> {
    this.message = '';
    this.error = '';
    this.busy = true;
    try {
      await this.auth.signInWithGoogle();
    } catch (error) {
      this.error = this.describeError(error);
    } finally {
      this.busy = false;
    }
  }

  protected setMode(mode: AuthMode): void {
    this.mode = mode;
    this.message = '';
    this.error = '';
  }

  private describeError(error: unknown): string {
    const code = typeof error === 'object' && error !== null && 'code' in error
      ? String(error.code)
      : '';

    switch (code) {
      case 'auth/email-already-in-use': return 'Esiste già un account con questa email.';
      case 'auth/invalid-email': return 'Inserisci un indirizzo email valido.';
      case 'auth/weak-password': return 'La password deve contenere almeno 6 caratteri.';
      case 'auth/invalid-credential':
      case 'auth/wrong-password':
      case 'auth/user-not-found': return 'Email o password non corrette.';
      case 'auth/popup-closed-by-user': return 'La finestra Google è stata chiusa prima di completare l’accesso.';
      case 'auth/popup-blocked': return 'Il browser ha bloccato la finestra Google. Consenti i popup e riprova.';
      case 'auth/operation-not-allowed': return 'Questo metodo di accesso non è abilitato in Firebase Console.';
      case 'auth/unauthorized-domain': return 'Questo dominio non è autorizzato in Firebase Authentication.';
      case 'auth/too-many-requests': return 'Troppi tentativi. Attendi qualche minuto e riprova.';
      default: return error instanceof Error ? error.message : 'Si è verificato un errore. Riprova.';
    }
  }
}
