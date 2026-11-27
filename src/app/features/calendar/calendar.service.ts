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
  venue: string;           // address of the pitch (away games; home games use the team address)
  venueLat?: number | null; // coordinates of the chosen address, for Maps
  venueLon?: number | null;
  venueUrl?: string;        // link copied from Google / Apple Maps ("Condividi › Copia link")
}

/** True when the text is a link shared from a maps app. */
export function isMapsLink(text: string): boolean {
  return /^https?:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps|(www\.)?google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.apple\.com|maps\.apple\/)/i.test(text.trim());
}

/** Coordinates written inside a full maps link (short links do not contain them). */
export function coordinatesFromLink(link: string): { lat: number; lon: number } | null {
  const match = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(link) ?? /[?&](?:q|ll|query|daddr|destination)=(-?\d+\.\d+),(-?\d+\.\d+)/.exec(link) ?? /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/.exec(link);
  return match ? { lat: Number(match[1]), lon: Number(match[2]) } : null;
}

/** Link that opens a place in Google Maps (app or web, on iPhone and Android). */
export function mapsLink(address: string, lat?: number | null, lon?: number | null): string {
  const query = lat != null && lon != null ? `${lat},${lon}` : address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}


/** A team of the group (girone) with its details. */
export interface GroupTeam {
  id: string;
  name: string;
  city: string;
  address: string;     // address of the pitch
  mapsUrl: string;     // optional link copied from Maps
  contact: string;     // contact person
  phone: string;
  email: string;
}

export function emptyGroupTeam(): GroupTeam { return { id: '', name: '', city: '', address: '', mapsUrl: '', contact: '', phone: '', email: '' }; }

export interface CalendarData {
  groupName: string;       // e.g. "Girone unico Arezzo"
  groupTeams: GroupTeam[]; // teams of the group, chosen from a list in each round
  andata: CalendarRound[];
  ritorno: CalendarRound[];
}

export function emptyCalendar(): CalendarData { return { groupName: '', groupTeams: [], andata: [], ritorno: [] }; }

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
      time: keep ? old.time : (round.time || ''),
      venue: keep ? old.venue : '',
      venueLat: keep ? old.venueLat ?? null : null,
      venueLon: keep ? old.venueLon ?? null : null,
      venueUrl: keep ? old.venueUrl ?? '' : ''
    };
  });
}

export function findNextMatch(calendar: CalendarData, now = new Date()): CalendarRound | null {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const upcoming = [...calendar.andata, ...calendar.ritorno]
    .filter(round => round.date && round.date >= today && round.opponent.trim())
    .sort((a, b) => (a.date + (a.time || '99:99')).localeCompare(b.date + (b.time || '99:99')));
  return upcoming[0] ?? null;
}

/** Dates used by more than one round (the team cannot play twice the same day). */
export function duplicateDates(calendar: CalendarData): Set<string> {
  const seen = new Map<string, number>();
  for (const round of [...calendar.andata, ...calendar.ritorno]) if (round.date) seen.set(round.date, (seen.get(round.date) ?? 0) + 1);
  return new Set([...seen].filter(([, count]) => count > 1).map(([date]) => date));
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
      groupTeams: Array.isArray(data['groupTeams']) ? (data['groupTeams'] as Record<string, unknown>[]).map(item => this.groupTeam(item)).filter(team => team.name) : [],
      andata: rounds.filter(round => round.leg === 'A').sort((a, b) => a.number - b.number),
      ritorno: rounds.filter(round => round.leg === 'R').sort((a, b) => a.number - b.number)
    };
  }

  async save(workspaceId: string, teamId: string, teamName: string, calendar: CalendarData): Promise<void> {
    const clean = (round: CalendarRound) => ({
      number: round.number, leg: round.leg, opponent: round.opponent.trim().slice(0, 80), home: round.home,
      date: round.date || '', time: round.time || '', venue: (round.venue || '').trim().slice(0, 180),
      venueLat: typeof round.venueLat === 'number' ? round.venueLat : null, venueLon: typeof round.venueLon === 'number' ? round.venueLon : null,
      venueUrl: isMapsLink(round.venueUrl ?? '') ? (round.venueUrl ?? '').trim().slice(0, 400) : ''
    });
    await setDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', teamId), {
      teamId,
      teamName,
      groupName: calendar.groupName.trim().slice(0, 80),
      groupTeams: calendar.groupTeams.slice(0, 40).map(team => ({
        id: team.id, name: team.name.trim().slice(0, 80), city: team.city.trim().slice(0, 80), address: team.address.trim().slice(0, 180),
        mapsUrl: isMapsLink(team.mapsUrl) ? team.mapsUrl.trim().slice(0, 400) : '', contact: team.contact.trim().slice(0, 80),
        phone: team.phone.trim().slice(0, 40), email: team.email.trim().slice(0, 120)
      })),
      rounds: [...calendar.andata, ...calendar.ritorno].map(clean),
      updatedAt: serverTimestamp()
    });
  }

  /** Closest match from now on (today included), or null when nothing is scheduled. */
  async nextMatch(workspaceId: string, teamId: string): Promise<CalendarRound | null> {
    return findNextMatch(await this.load(workspaceId, teamId));
  }

  private groupTeam(item: Record<string, unknown>): GroupTeam {
    const text = (key: string) => String(item[key] ?? '');
    return { id: text('id') || `t-${Math.random().toString(36).slice(2, 9)}`, name: text('name'), city: text('city'), address: text('address'), mapsUrl: text('mapsUrl'), contact: text('contact'), phone: text('phone'), email: text('email') };
  }

  private round(item: Record<string, unknown>): CalendarRound {
    return {
      number: Number(item['number'] ?? 0),
      leg: item['leg'] === 'R' ? 'R' : 'A',
      opponent: String(item['opponent'] ?? ''),
      home: item['home'] !== false,
      date: String(item['date'] ?? ''),
      time: String(item['time'] ?? ''),
      venue: String(item['venue'] ?? ''),
      venueLat: typeof item['venueLat'] === 'number' ? item['venueLat'] as number : null,
      venueLon: typeof item['venueLon'] === 'number' ? item['venueLon'] as number : null,
      venueUrl: String(item['venueUrl'] ?? '')
    };
  }

  private db(): Firestore {
    if (!this.firestore) throw new Error('Firestore non è configurato.');
    return this.firestore;
  }
}
