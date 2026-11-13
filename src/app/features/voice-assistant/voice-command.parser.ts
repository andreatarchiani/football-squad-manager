import { Injectable } from '@angular/core';
import type { TeamInput } from '../teams/team.service';

export type VoiceCommand =
  | { type: 'create-team'; input: TeamInput };

@Injectable({ providedIn: 'root' })
export class VoiceCommandParser {
  parse(transcript: string): VoiceCommand | null {
    const text = transcript.trim();
    if (!/\b(aggiungi|crea|inserisci|registra)\b/i.test(text) || !/\bsquadra\b/i.test(text)) {
      return null;
    }

    const name = this.capture(
      text,
      /\b(?:con\s+il\s+nome|con\s+nome|nome|chiamata)\s+(.+?)(?=\s*(?:,|;)?\s*(?:società|societa|club|categoria|stagione)\b|$)/i
    ) ?? this.capture(
      text,
      /\bsquadra\s+(.+?)(?=\s*(?:,|;)?\s*(?:società|societa|club|categoria|stagione)\b|$)/i
    );

    if (!name) return null;

    const currentSeason = this.currentSeason();
    return {
      type: 'create-team',
      input: {
        name,
        clubName: this.capture(text, /\b(?:società|societa|club)\s+(?:è\s+|e\s+|si\s+chiama\s+)?(.+?)(?=\s*(?:,|;)?\s*(?:categoria|stagione)\b|$)/i) ?? '',
        category: this.capture(text, /\bcategoria\s+(?:è\s+|e\s+)?(.+?)(?=\s*(?:,|;)?\s*stagione\b|$)/i) ?? '',
        icon: 'shield',
        seasonLabel: this.capture(text, /\bstagione\s+(?:è\s+|e\s+)?(\d{4}\s*[/\-]\s*\d{4})/i) ?? currentSeason
      }
    };
  }

  private capture(text: string, pattern: RegExp): string | null {
    const value = pattern.exec(text)?.[1]?.trim()
      .replace(/^[,;:\s]+|[,;.\s]+$/g, '');
    return value ? value : null;
  }

  private currentSeason(): string {
    const now = new Date();
    const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    return `${startYear}/${startYear + 1}`;
  }
}
