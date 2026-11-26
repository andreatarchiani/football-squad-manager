import { Injectable, inject } from '@angular/core';
import { doc, getDoc, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
import { FIRESTORE_DB } from '../../core/firebase.tokens';

/** One match of my team in a round ("giornata"). */
export interface CalendarRound {
  number: number;          // 1..N andata, N+1..2N ritorno
  leg: 'A' | 'R';          // Andata / Ritorno
  opponent: string;
  home: boolean;           // true = my team plays at home
  date: string;            // YYYY-MM-DD
  time: string;            // HH:mm
}

export interface CalendarData {
  groupName: string;       // e.g. "Girone unico Arezzo"
  andata: CalendarRound[];
  ritorno: CalendarRound[];
}

export function emptyCalendar(): CalendarData { return { groupName: '', andata: [], ritorno: [] }; }

/**
 * Builds the return leg from the first leg: same opponents in the same order,
 * home and away swapped. Dates and times already typed for the return leg are
 * kept when the opponent of that round has not changed.
 */
export function buildReturnLeg(andata: CalendarRound[], previous: CalendarRound[] = []): CalendarRound[] {
  const total = andata.length;
  return andata.map((round, index) => {
    const old = previous[index];
    const keep = old && old.opponent.trim().toLowerCase() === round.opponent.trim().toLowerCase();
    return {
      number: total + index + 1,
      leg: 'R' as const,
      opponent: round.opponent,
      home: !round.home,
      date: keep ? old.date : '',
      time: keep ? old.time : (round.time || '')
    };
  });
}

@Injectable({ providedIn: 'root' })
export class CalendarService {
  private readonly firestore = inject(FIRESTORE_DB, { optional: true });

  async load(workspaceId: string, teamId: string): Promise<CalendarData> {
    const snapshot = await getDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', teamId));
    if (!snapshot.exists()) return emptyCalendar();
    const data = snapshot.data();
    const rounds = Array.isArray(data['rounds']) ? (data['rounds'] as Record<string, unknown>[]).map(item => this.round(item)) : [];
    return {
      groupName: String(data['groupName'] ?? ''),
      andata: rounds.filter(round => round.leg === 'A').sort((a, b) => a.number - b.number),
      ritorno: rounds.filter(round => round.leg === 'R').sort((a, b) => a.number - b.number)
    };
  }

  async save(workspaceId: string, teamId: string, teamName: string, calendar: CalendarData): Promise<void> {
    const clean = (round: CalendarRound) => ({
      number: round.number, leg: round.leg, opponent: round.opponent.trim().slice(0, 80), home: round.home,
      date: round.date || '', time: round.time || ''
    });
    await setDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', teamId), {
      teamId,
      teamName,
      groupName: calendar.groupName.trim().slice(0, 80),
      rounds: [...calendar.andata, ...calendar.ritorno].map(clean),
      updatedAt: serverTimestamp()
    });
  }

  private round(item: Record<string, unknown>): CalendarRound {
    return {
      number: Number(item['number'] ?? 0),
      leg: item['leg'] === 'R' ? 'R' : 'A',
      opponent: String(item['opponent'] ?? ''),
      home: item['home'] !== false,
      date: String(item['date'] ?? ''),
      time: String(item['time'] ?? '')
    };
  }

  private db(): Firestore {
    if (!this.firestore) throw new Error('Firestore non è configurato.');
    return this.firestore;
  }
}
