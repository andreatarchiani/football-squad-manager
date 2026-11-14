import { Injectable } from '@angular/core';

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
  private recognition: SpeechRecognitionLike | null = null;

  get supported(): boolean {
    if (typeof window === 'undefined') return false;
    const browserWindow = window as SpeechRecognitionWindow;
    return Boolean(browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition);
  }

  /**
   * Starts one bounded recording session. The caller owns the start/stop gesture.
   * Every result callback receives a complete snapshot, never an appended fragment.
   */
  start(
    onTranscript: (transcript: string, isFinal: boolean) => void,
    onError: (message: string) => void,
    onEnd: (finalTranscript: string) => void
  ): void {
    this.cancel();
    const browserWindow = window as SpeechRecognitionWindow;
    const Recognition = browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) {
      onError('Il riconoscimento vocale non è supportato da questo browser. Usa Google Chrome o Microsoft Edge aggiornato.');
      onEnd('');
      return;
    }

    const recognition = new Recognition();
    this.recognition = recognition;
    recognition.lang = 'it-IT';
    recognition.continuous = true;
    recognition.interimResults = true;

    const finalSegments: string[] = [];
    const seenFinalSegments = new Set<string>();
    let finalTranscript = '';

    recognition.onresult = (event) => {
      const interimSegments: string[] = [];
      // Read the current result list as a snapshot. Do not concatenate event
      // deltas: some browser versions replay old final results on later events.
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          const key = transcript.toLocaleLowerCase('it-IT')
            .normalize('NFD')
            .replace(/[\u0300-\u036f]/g, '')
            .replace(/[^\p{L}\p{N}\s]/gu, ' ')
            .replace(/\s+/g, ' ')
            .trim();
          // Duplicate final segments are discarded even if a browser reports
          // them at a different result index during the same button press.
          if (key && !seenFinalSegments.has(key)) {
            seenFinalSegments.add(key);
            finalSegments.push(transcript);
          }
        } else {
          interimSegments.push(transcript);
        }
      }
      finalTranscript = finalSegments.join(' ').replace(/\s+/g, ' ').trim();
      const snapshot = [finalTranscript, interimSegments.join(' ')].filter(Boolean).join(' ').trim();
      if (snapshot) onTranscript(snapshot, false);
    };

    recognition.onerror = (event) => {
      const messages: Record<string, string> = {
        'not-allowed': 'Permesso microfono negato. Consenti l’accesso al microfono nelle impostazioni del browser.',
        'service-not-allowed': 'Il browser non consente l’uso del riconoscimento vocale su questo sito.',
        'no-speech': 'Non ho sentito la voce. Tieni premuto il pulsante e riprova.',
        'audio-capture': 'Non riesco ad accedere al microfono. Controlla che sia disponibile.',
        network: 'Il riconoscimento vocale non è riuscito per un problema di rete.'
      };
      onError(messages[event.error] ?? 'Si è verificato un errore durante il riconoscimento vocale.');
    };

    recognition.onend = () => {
      if (this.recognition === recognition) this.recognition = null;
      onEnd(finalTranscript);
    };

    try {
      recognition.start();
    } catch {
      if (this.recognition === recognition) this.recognition = null;
      onError('Non è stato possibile avviare il microfono. Riprova.');
      onEnd('');
    }
  }

  /** Gracefully stops recording and waits for the browser's final result. */
  stop(): void {
    const recognition = this.recognition;
    if (!recognition) return;
    try { recognition.stop(); } catch { /* The browser may already have stopped. */ }
  }

  /** Cancels recording without processing a partial command. */
  cancel(): void {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try { recognition.stop(); } catch { /* The browser may already have stopped. */ }
  }
}
