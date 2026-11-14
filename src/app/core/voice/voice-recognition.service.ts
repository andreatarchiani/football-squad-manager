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
    let ended = false;

    const normalize = (value: string): string => value.toLocaleLowerCase('it-IT')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    recognition.onresult = (event) => {
      if (ended || this.recognition !== recognition) return;
      const interimSegments: string[] = [];
      // Read the current result list as a snapshot. Do not concatenate event
      // deltas: some browser versions replay old final results on later events.
      for (let index = 0; index < event.results.length; index += 1) {
        const result = event.results[index];
        const transcript = result?.[0]?.transcript?.trim();
        if (!transcript) continue;
        if (result.isFinal) {
          const key = normalize(transcript);
          if (!key || seenFinalSegments.has(key)) continue;

          const currentWords = normalize(finalSegments.join(' ')).split(' ').filter(Boolean);
          const nextWords = key.split(' ').filter(Boolean);
          // Some engines replay a final phrase as a longer, slightly changed
          // segment. Ignore contained repeats and remove any repeated boundary.
          const currentText = currentWords.join(' ');
          if (currentText && (currentText === key || currentText.includes(key))) continue;
          let overlap = Math.min(currentWords.length, nextWords.length);
          while (overlap > 0 && currentWords.slice(-overlap).join(' ') !== nextWords.slice(0, overlap).join(' ')) {
            overlap -= 1;
          }
          const remaining = nextWords.slice(overlap).join(' ');
          seenFinalSegments.add(key);
          if (remaining) finalSegments.push(remaining);
        } else {
          interimSegments.push(transcript);
        }
      }
      finalTranscript = finalSegments.join(' ').replace(/\s+/g, ' ').trim();
      const snapshot = [finalTranscript, interimSegments.join(' ')].filter(Boolean).join(' ').trim();
      if (snapshot) onTranscript(snapshot, interimSegments.length === 0 && Boolean(finalTranscript));
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
      if (ended) return;
      ended = true;
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
