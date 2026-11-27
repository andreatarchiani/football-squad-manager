import { Injectable, inject } from '@angular/core';
import { collection, deleteDoc, doc, getDoc, getDocs, serverTimestamp, setDoc, type Firestore } from 'firebase/firestore';
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
  icon: string;        // logo: emoji or small image (data URL)
  city: string;
  facilityName: string;
  address: string;     // address of the pitch
  mapsUrl: string;     // optional link copied from Maps
  headquarters: string; // club headquarters address
  terrain: string;      // Erba naturale / Erba sintetica / Mista sintetico-naturale
  kitsField: string[];
  kitsKeeper: string[];
  federation: string;   // federal number
  contact: string;     // contact person
  phone: string;
  email: string;
}

export function emptyGroupTeam(): GroupTeam { return { id: '', name: '', icon: '', city: '', facilityName: '', address: '', mapsUrl: '', headquarters: '', terrain: 'Erba naturale', kitsField: [], kitsKeeper: [], federation: '', contact: '', phone: '', email: '' }; }

/** Call-up ("convocazione") details of one match, saved with the calendar. */
export interface CallupInfo {
  meetingTime: string;     // HH:mm
  meetingPlace: string;
  kit: string;             // e.g. "Divisa blu, calzettoni bianchi"
  notes: string;
  excluded: string[];      // player ids not called up
}
export function emptyCallup(): CallupInfo { return { meetingTime: '', meetingPlace: '', kit: '', notes: '', excluded: [] }; }


/* ------------------------------------------------------------------ events */
export const SEASON_TABS = [
  { key: 'senior', label: 'Prima Squadra', hint: 'Senior' },
  { key: 'youth', label: 'Settore Giovanile', hint: 'Agonistico' },
  { key: 'base', label: 'Attività di Base', hint: 'Settore Giovanile' },
  { key: 'other', label: 'Altre Categorie', hint: 'Speciali' }
] as const;
export type SeasonTab = typeof SEASON_TABS[number]['key'];

export const SEASON_CATEGORIES: Record<SeasonTab, string[]> = {
  senior: ['Serie D', 'Eccellenza', 'Promozione', 'Prima Categoria', 'Seconda Categoria', 'Terza Categoria'],
  youth: ['Under 17 Regionale (U17)', 'Under 18 Regionale (U18)', 'Allievi Nazionali (U17)', 'Allievi Regionali (U17)', 'Allievi Provinciali (U17)', 'Allievi Under 16 (U16)', 'Giovanissimi Nazionali (U15)', 'Giovanissimi Regionali (U15)', 'Giovanissimi Provinciali (U15)', 'Giovanissimi Under 14 (U14)', 'Esordienti (U13)', 'Pulcini (U11)', 'Primi Calci (U9)', 'Piccoli Amici (U7)'],
  base: ['Scuola Calcio Élite', 'Scuola Calcio', 'Centro Calcio Giovanile'],
  other: ['Calcio a 5', 'Calcio femminile', 'Amatori / Over', 'Torneo / Evento speciale']
};

export interface EventDetails {
  name: string;                 // e.g. "Stagione 2026/2027"
  seasonLabel: string;          // "2026/2027"
  tab: SeasonTab;
  category: string;
  organization: string;         // e.g. "FIGC / LND"
  groupMode: 'select' | 'manual';
  group: string;                // girone
  logo: string;                 // emoji or small image (data URL)
  kitsField: string[];          // colours of the outfield kits
  kitsKeeper: string[];         // colours of the goalkeeper kits
  activity: string;             // Campionato / Torneo / Amichevole / Altra attività
  nature: string;               // Professionistico / Dilettantistico / Scolastico
  scope: string;                // Nazionale / Élite / Regionale / Provinciale
  format: string;               // "11 vs 11"
  playersOnField: number | null;
  playersOnList: number | null;
  periods: number | null;
  periodMinutes: number | null;
  interval: number | null;
  maxSubstitutions: number | null;
  flyingSubstitutions: boolean;
  reentry: boolean;
  extraTime: boolean;
  penalties: boolean;
  fieldLength: string;          // "100 - 110"
  fieldWidth: string;
  goalWidth: string;
  goalHeight: string;
  ballSize: string;             // "N° 5"
  ballWeight: string;           // "410 - 450"
  extraReport: boolean;
}

export const ORGANIZATIONS = ['FIGC / LND', 'FIGC / SGS', 'CSI', 'UISP', 'AICS', 'Altro ente'];
export const GROUP_OPTIONS = ['Unico', 'A', 'B', 'C', 'D', 'E', 'F'];
export const ACTIVITIES = ['Campionato', 'Torneo', 'Amichevole', 'Altra attività'];
export const NATURES = ['Professionistico', 'Dilettantistico', 'Scolastico'];
export const SCOPES = ['Nazionale', 'Élite', 'Regionale', 'Provinciale'];
export const FORMATS = ['11 vs 11', '9 vs 9', '7 vs 7', '5 vs 5', '3 vs 3', '2 vs 2'];
export const BALL_SIZES = ['N° 5', 'N° 4', 'N° 3'];

export function emptyEvent(): EventDetails {
  return {
    name: '', seasonLabel: '', tab: 'youth', category: '', organization: 'FIGC / LND', groupMode: 'select', group: 'Unico', logo: '',
    kitsField: ['#1f5fff', '#ffffff', '#e0283f'], kitsKeeper: ['#ffd21a', '#17a34a', '#ff7a00'],
    activity: 'Campionato', nature: 'Dilettantistico', scope: 'Provinciale',
    format: '11 vs 11', playersOnField: 11, playersOnList: 20, periods: 2, periodMinutes: 45, interval: 15, maxSubstitutions: 5,
    flyingSubstitutions: true, reentry: false, extraTime: false, penalties: true,
    fieldLength: '100 - 110', fieldWidth: '64 - 75', goalWidth: '7,32', goalHeight: '2,44', ballSize: 'N° 5', ballWeight: '410 - 450', extraReport: false
  };
}

export function tabOfCategory(category: string): SeasonTab {
  return (Object.keys(SEASON_CATEGORIES) as SeasonTab[]).find(tab => SEASON_CATEGORIES[tab].includes(category)) ?? 'youth';
}

/** Typical rules for a category (a starting point: every value can be edited). */
export function categoryRules(category: string): Partial<EventDetails> {
  const c = category.toLowerCase();
  const adult = { format: '11 vs 11', playersOnField: 11, playersOnList: 20, periods: 2, periodMinutes: 45, interval: 15, maxSubstitutions: 5, flyingSubstitutions: true, reentry: false, extraTime: false, penalties: true, fieldLength: '100 - 110', fieldWidth: '64 - 75', goalWidth: '7,32', goalHeight: '2,44', ballSize: 'N° 5', ballWeight: '410 - 450' };
  if (c.includes('(u7)') || c.includes('(u9)') || c.includes('scuola calcio') || c.includes('centro calcio')) return { ...adult, format: '5 vs 5', playersOnField: 5, playersOnList: 12, periods: 4, periodMinutes: 10, interval: 5, maxSubstitutions: null, reentry: true, flyingSubstitutions: true, penalties: false, fieldLength: '35 - 40', fieldWidth: '20 - 25', goalWidth: '3,00', goalHeight: '2,00', ballSize: 'N° 3', ballWeight: '290 - 320' };
  if (c.includes('(u11)')) return { ...adult, format: '7 vs 7', playersOnField: 7, playersOnList: 14, periods: 3, periodMinutes: 20, interval: 5, maxSubstitutions: null, reentry: true, penalties: false, fieldLength: '50 - 60', fieldWidth: '30 - 40', goalWidth: '5,00', goalHeight: '2,00', ballSize: 'N° 4', ballWeight: '350 - 390' };
  if (c.includes('(u13)')) return { ...adult, format: '9 vs 9', playersOnField: 9, playersOnList: 16, periods: 3, periodMinutes: 25, interval: 5, maxSubstitutions: null, reentry: true, penalties: false, fieldLength: '65 - 75', fieldWidth: '45 - 55', goalWidth: '6,00', goalHeight: '2,00', ballSize: 'N° 4', ballWeight: '350 - 390' };
  if (c.includes('calcio a 5')) return { ...adult, format: '5 vs 5', playersOnField: 5, playersOnList: 12, periods: 2, periodMinutes: 20, interval: 10, maxSubstitutions: null, reentry: true, fieldLength: '25 - 42', fieldWidth: '16 - 25', goalWidth: '3,00', goalHeight: '2,00', ballSize: 'N° 4', ballWeight: '400 - 440' };
  if (c.includes('(u14)') || c.includes('(u15)') || c.includes('(u16)')) return { ...adult, periodMinutes: c.includes('(u16)') ? 40 : 35, interval: 10 };
  return adult;
}

export function eventTitle(calendar: Pick<CalendarData, 'event' | 'teamName' | 'groupName'>): string {
  return calendar.event.name.trim() || `${calendar.teamName || 'Campionato'}${calendar.groupName ? ' · ' + calendar.groupName : ''}`;
}

export interface CalendarData {
  id: string;              // event id (old calendars keep the team id)
  teamId: string;
  teamName: string;
  event: EventDetails;
  callups: Record<string, CallupInfo>; // by round number

  groupName: string;       // e.g. "Girone unico Arezzo"
  groupTeams: GroupTeam[]; // teams of the group, chosen from a list in each round
  andata: CalendarRound[];
  ritorno: CalendarRound[];
}

export function emptyCalendar(): CalendarData { return { id: '', teamId: '', teamName: '', event: emptyEvent(), callups: {}, groupName: '', groupTeams: [], andata: [], ritorno: [] }; }

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

  /** One event (season / championship) with its calendar. Old calendars use the team id as event id. */
  async load(workspaceId: string, eventId: string): Promise<CalendarData> {
    const snapshot = await getDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', eventId));
    if (!snapshot.exists()) return { ...emptyCalendar(), id: eventId };
    return this.parse(snapshot.id, snapshot.data());
  }

  /** Every event of the workspace. */
  async loadAll(workspaceId: string): Promise<CalendarData[]> {
    const snapshot = await getDocs(collection(this.db(), 'workspaces', workspaceId, 'calendars'));
    return snapshot.docs.map(item => this.parse(item.id, item.data())).sort((a, b) => eventTitle(a).localeCompare(eventTitle(b), 'it'));
  }

  /** Creates (no id) or updates the details of an event; the calendar rounds are not touched. Returns the id. */
  async saveEvent(workspaceId: string, id: string | null, details: EventDetails): Promise<string> {
    const eventId = id ?? doc(collection(this.db(), 'workspaces', workspaceId, 'calendars')).id;
    const clean = this.cleanEvent(details);
    const payload: Record<string, unknown> = { groupName: clean.group, event: clean, updatedAt: serverTimestamp() };
    if (!id) payload['rounds'] = [];
    await setDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', eventId), payload, { merge: true });
    return eventId;
  }

  async deleteEvent(workspaceId: string, eventId: string): Promise<void> {
    await deleteDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', eventId));
  }

  /** Closest match from now on in one event, with the event it belongs to. */
  async nextMatchEvent(workspaceId: string, eventId: string): Promise<{ round: CalendarRound; calendar: CalendarData } | null> {
    if (!eventId) return null;
    const calendar = await this.load(workspaceId, eventId);
    const round = findNextMatch(calendar);
    return round ? { round, calendar } : null;
  }

  private parse(id: string, data: Record<string, unknown>): CalendarData {
    const rounds = Array.isArray(data['rounds']) ? (data['rounds'] as Record<string, unknown>[]).map(item => this.round(item)) : [];
    return {
      id,
      teamId: String(data['teamId'] ?? id),
      teamName: String(data['teamName'] ?? ''),
      event: this.event(data['event']),
      callups: this.callups(data['callups']),
      groupName: String(data['groupName'] ?? ''),
      groupTeams: Array.isArray(data['groupTeams']) ? (data['groupTeams'] as Record<string, unknown>[]).map(item => this.groupTeam(item)).filter(team => team.name) : [],
      andata: rounds.filter(round => round.leg === 'A').sort((a, b) => a.number - b.number),
      ritorno: rounds.filter(round => round.leg === 'R').sort((a, b) => a.number - b.number)
    };
  }

  private event(value: unknown): EventDetails {
    const base = emptyEvent();
    if (!value || typeof value !== 'object') return base;
    const raw = value as Record<string, unknown>;
    const text = (key: keyof EventDetails, fallback: string) => typeof raw[key] === 'string' ? raw[key] as string : fallback;
    const num = (key: keyof EventDetails, fallback: number | null) => raw[key] === null ? null : typeof raw[key] === 'number' ? raw[key] as number : fallback;
    const flag = (key: keyof EventDetails, fallback: boolean) => typeof raw[key] === 'boolean' ? raw[key] as boolean : fallback;
    const list = (key: keyof EventDetails, fallback: string[]) => Array.isArray(raw[key]) ? (raw[key] as unknown[]).map(String) : fallback;
    return {
      name: text('name', ''), seasonLabel: text('seasonLabel', ''), tab: (['senior', 'youth', 'base', 'other'].includes(String(raw['tab'])) ? raw['tab'] : base.tab) as SeasonTab,
      category: text('category', ''), organization: text('organization', base.organization), groupMode: raw['groupMode'] === 'manual' ? 'manual' : 'select', group: text('group', base.group),
      logo: text('logo', ''), kitsField: list('kitsField', base.kitsField), kitsKeeper: list('kitsKeeper', base.kitsKeeper),
      activity: text('activity', base.activity), nature: text('nature', base.nature), scope: text('scope', base.scope),
      format: text('format', base.format), playersOnField: num('playersOnField', base.playersOnField), playersOnList: num('playersOnList', base.playersOnList),
      periods: num('periods', base.periods), periodMinutes: num('periodMinutes', base.periodMinutes), interval: num('interval', base.interval), maxSubstitutions: num('maxSubstitutions', base.maxSubstitutions),
      flyingSubstitutions: flag('flyingSubstitutions', base.flyingSubstitutions), reentry: flag('reentry', base.reentry), extraTime: flag('extraTime', base.extraTime), penalties: flag('penalties', base.penalties),
      fieldLength: text('fieldLength', base.fieldLength), fieldWidth: text('fieldWidth', base.fieldWidth), goalWidth: text('goalWidth', base.goalWidth), goalHeight: text('goalHeight', base.goalHeight),
      ballSize: text('ballSize', base.ballSize), ballWeight: text('ballWeight', base.ballWeight), extraReport: flag('extraReport', base.extraReport)
    };
  }

  private cleanEvent(e: EventDetails): EventDetails {
    const t = (value: string, max: number) => String(value ?? '').trim().slice(0, max);
    const n = (value: number | null) => typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(999, Math.round(value))) : null;
    const colors = (list: string[]) => (list ?? []).filter(color => /^#[0-9a-f]{6}$/i.test(color)).slice(0, 6);
    return {
      name: t(e.name, 80), seasonLabel: t(e.seasonLabel, 9), tab: e.tab, category: t(e.category, 80), organization: t(e.organization, 40),
      groupMode: e.groupMode, group: t(e.group, 80), logo: String(e.logo ?? '').slice(0, 60000), kitsField: colors(e.kitsField), kitsKeeper: colors(e.kitsKeeper),
      activity: t(e.activity, 30), nature: t(e.nature, 30), scope: t(e.scope, 30), format: t(e.format, 12),
      playersOnField: n(e.playersOnField), playersOnList: n(e.playersOnList), periods: n(e.periods), periodMinutes: n(e.periodMinutes), interval: n(e.interval), maxSubstitutions: n(e.maxSubstitutions),
      flyingSubstitutions: !!e.flyingSubstitutions, reentry: !!e.reentry, extraTime: !!e.extraTime, penalties: !!e.penalties,
      fieldLength: t(e.fieldLength, 20), fieldWidth: t(e.fieldWidth, 20), goalWidth: t(e.goalWidth, 12), goalHeight: t(e.goalHeight, 12), ballSize: t(e.ballSize, 12), ballWeight: t(e.ballWeight, 20), extraReport: !!e.extraReport
    };
  }

  async save(workspaceId: string, calendar: CalendarData): Promise<void> {
    const clean = (round: CalendarRound) => ({
      number: round.number, leg: round.leg, opponent: round.opponent.trim().slice(0, 80), home: round.home,
      date: round.date || '', time: round.time || '', venue: (round.venue || '').trim().slice(0, 180),
      venueLat: typeof round.venueLat === 'number' ? round.venueLat : null, venueLon: typeof round.venueLon === 'number' ? round.venueLon : null,
      venueUrl: isMapsLink(round.venueUrl ?? '') ? (round.venueUrl ?? '').trim().slice(0, 400) : ''
    });
    await setDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', calendar.id), {
      teamId: calendar.teamId,
      teamName: calendar.teamName,
      event: this.cleanEvent(calendar.event),
      groupName: calendar.groupName.trim().slice(0, 80),
      callups: Object.fromEntries(Object.entries(calendar.callups ?? {}).map(([number, info]) => [number, this.cleanCallup(info)])),
      groupTeams: calendar.groupTeams.slice(0, 40).map(team => ({
        id: team.id, name: team.name.trim().slice(0, 80), icon: (team.icon || '').slice(0, 60000), facilityName: (team.facilityName || '').trim().slice(0, 100), headquarters: (team.headquarters || '').trim().slice(0, 180), terrain: (team.terrain || '').slice(0, 40), kitsField: (team.kitsField || []).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6), kitsKeeper: (team.kitsKeeper || []).filter(c => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6), federation: (team.federation || '').trim().slice(0, 60), city: team.city.trim().slice(0, 80), address: team.address.trim().slice(0, 180),
        mapsUrl: isMapsLink(team.mapsUrl) ? team.mapsUrl.trim().slice(0, 400) : '', contact: team.contact.trim().slice(0, 80),
        phone: team.phone.trim().slice(0, 40), email: team.email.trim().slice(0, 120)
      })),
      rounds: [...calendar.andata, ...calendar.ritorno].map(clean),
      updatedAt: serverTimestamp()
    });
  }

  /** Saves only the call-up of one match (other fields of the calendar stay untouched). */
  async saveCallup(workspaceId: string, eventId: string, roundNumber: number, info: CallupInfo): Promise<void> {
    await setDoc(doc(this.db(), 'workspaces', workspaceId, 'calendars', eventId), { callups: { [String(roundNumber)]: this.cleanCallup(info) } }, { merge: true });
  }

  private cleanCallup(info: CallupInfo): CallupInfo {
    return {
      meetingTime: String(info.meetingTime ?? '').slice(0, 5), meetingPlace: String(info.meetingPlace ?? '').trim().slice(0, 180),
      kit: String(info.kit ?? '').trim().slice(0, 180), notes: String(info.notes ?? '').trim().slice(0, 600),
      excluded: (info.excluded ?? []).slice(0, 80).map(id => String(id).slice(0, 80))
    };
  }

  private callups(value: unknown): Record<string, CallupInfo> {
    const result: Record<string, CallupInfo> = {};
    if (value && typeof value === 'object') {
      for (const [key, raw] of Object.entries(value as Record<string, Record<string, unknown>>)) {
        result[key] = { meetingTime: String(raw?.['meetingTime'] ?? ''), meetingPlace: String(raw?.['meetingPlace'] ?? ''), kit: String(raw?.['kit'] ?? ''), notes: String(raw?.['notes'] ?? ''), excluded: Array.isArray(raw?.['excluded']) ? (raw['excluded'] as unknown[]).map(String) : [] };
      }
    }
    return result;
  }

  /** Closest match from now on (today included) across the events of the team, or null. */
  async nextMatch(workspaceId: string, eventId: string): Promise<CalendarRound | null> {
    return (await this.nextMatchEvent(workspaceId, eventId))?.round ?? null;
  }

  private groupTeam(item: Record<string, unknown>): GroupTeam {
    const text = (key: string) => String(item[key] ?? '');
    return { id: text('id') || `t-${Math.random().toString(36).slice(2, 9)}`, name: text('name'), icon: text('icon'), city: text('city'), facilityName: text('facilityName'), headquarters: text('headquarters'), terrain: text('terrain') || 'Erba naturale', kitsField: Array.isArray(item['kitsField']) ? (item['kitsField'] as unknown[]).map(String) : [], kitsKeeper: Array.isArray(item['kitsKeeper']) ? (item['kitsKeeper'] as unknown[]).map(String) : [], federation: text('federation'), address: text('address'), mapsUrl: text('mapsUrl'), contact: text('contact'), phone: text('phone'), email: text('email') };
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
