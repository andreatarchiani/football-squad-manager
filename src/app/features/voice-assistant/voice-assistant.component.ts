import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import type { TeamInput } from '../teams/team.service';
import { VoiceCommandExecutor } from './voice-command.executor';
import { VoiceCommandParser } from './voice-command.parser';
import { VoiceRecognitionService } from '../../core/voice/voice-recognition.service';

@Component({
  selector: 'fsm-voice-assistant',
  standalone: true,
  templateUrl: './voice-assistant.component.html',
  styleUrl: './voice-assistant.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class VoiceAssistantComponent {
  private readonly recognition = inject(VoiceRecognitionService);
  private readonly parser = inject(VoiceCommandParser);
  private readonly executor = inject(VoiceCommandExecutor);

  protected readonly panelOpen = signal(false);
  protected readonly listening = signal(false);
  protected readonly saving = signal(false);
  protected readonly transcript = signal('');
  protected readonly draft = signal<TeamInput | null>(null);
  protected readonly message = signal('');
  protected readonly error = signal('');

  protected get supported(): boolean { return this.recognition.supported; }

  protected toggleListening(): void {
    if (this.listening()) {
      this.recognition.stop();
      this.listening.set(false);
      return;
    }
    this.panelOpen.set(true);
    this.transcript.set('');
    this.draft.set(null);
    this.message.set('');
    this.error.set('');
    this.listening.set(true);
    this.recognition.start(
      (transcript) => {
        this.transcript.set(transcript);
        const command = this.parser.parse(transcript);
        if (!command) {
          this.error.set('Non ho riconosciuto un comando valido. Per ora puoi chiedermi di creare una squadra, specificandone il nome.');
          return;
        }
        this.draft.set(command.input);
        this.error.set('');
      },
      (message) => this.error.set(message),
      () => this.listening.set(false)
    );
  }

  protected updateDraft(field: keyof TeamInput, value: string): void {
    const current = this.draft();
    if (!current) return;
    this.draft.set({ ...current, [field]: value });
  }

  protected close(): void {
    this.recognition.stop();
    this.listening.set(false);
    this.panelOpen.set(false);
    this.draft.set(null);
    this.error.set('');
  }

  protected async confirm(): Promise<void> {
    const draft = this.draft();
    if (!draft || this.saving()) return;
    this.saving.set(true);
    this.error.set('');
    try {
      await this.executor.createTeam(draft);
      this.message.set(`Squadra “${draft.name}” creata correttamente.`);
      this.draft.set(null);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Non è stato possibile creare la squadra.');
    } finally {
      this.saving.set(false);
    }
  }
}
