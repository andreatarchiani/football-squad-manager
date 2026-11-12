import { Injectable } from '@angular/core';

/**
 * The recognition transport is deliberately isolated from command parsing and execution.
 * A future wake-word/always-on adapter can implement the same lifecycle without changing
 * the assistant UI or the command pipeline.
 */
export type VoiceActivationMode = 'push-to-talk' | 'wake-word';

interface SpeechRecognitionAlternativeLike { transcript: string; }
interface SpeechRecognitionResultLike extends ArrayLike<SpeechRecognitionAlternativeLike> { isFinal: boolean; }
interface SpeechRecognitionEventLike extends Event {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}
interface SpeechRecognitionErrorEventLike extends Event { error: string; }
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}
interface SpeechRecognitionWindow extends Window {
  SpeechRecognition?: new () => SpeechRecognitionLike;
  webkitSpeechRecognition?: new () => SpeechRecognitionLike;
}

@Injectable({ providedIn: 'root' })
export class VoiceRecognitionService {
  readonly activationMode: VoiceActivationMode = 'push-to-talk';
  private recognition: SpeechRecognitionLike | null = null;

  get supported(): boolean {
    if (typeof window === 'undefined') return false;
    const browserWindow = window as SpeechRecognitionWindow;
    return Boolean(browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition);
  }

  start(
    onFinalTranscript: (transcript: string) => void,
    onError: (message: string) => void,
    onEnd: () => void
  ): void {
    this.stop();
    const browserWindow = window as SpeechRecognitionWindow;
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      onError('Il riconoscimento vocale non è supportato da questo browser. Prova con Google Chrome o Microsoft Edge.');
      onEnd();
      return;
    }

    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.lang = 'it-IT';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalTranscript = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal && result[0]) finalTranscript += result[0].transcript;
      }
      const transcript = finalTranscript.trim();
      if (transcript) onFinalTranscript(transcript);
    };
    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Permesso microfono negato. Consenti l’accesso al microfono nelle impostazioni del browser.',
        'no-speech': 'Non ho sentito nessuna voce. Premi il microfono e riprova.',
        'audio-capture': 'Non riesco ad accedere a un microfono. Controlla che sia collegato e disponibile.',
        network: 'Il riconoscimento vocale non è riuscito per un problema di rete.'
      };
      onError(messages[event.error] ?? 'Si è verificato un errore durante il riconoscimento vocale.');
    };
    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      onEnd();
    };

    try {
      recognition.start();
    } catch {
      this.recognition = null;
      onError('Non è stato possibile avviare il microfono. Riprova.');
      onEnd();
    }
  }

  stop(): void {
    const recognition = this.recognition;
    this.recognition = null;
    if (recognition) {
      recognition.onend = null;
      try { recognition.stop(); } catch { /* The browser may already have stopped it. */ }
    }
  }
}
