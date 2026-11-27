/**
 * Formations and field positions (all names in Italian), shared by Home, Formazione and Panchina Live.
 * A formation is a list of slots on the pitch; the saved lineup maps slot id → player.
 */
export type PitchRole = 'Portiere' | 'Difensore' | 'Centrocampista' | 'Attaccante';
export interface PitchSlot { id: string; label: string; role: PitchRole; x: number; y: number; }

/** Positions a player can cover: code (shown on the pitch), Italian name and the role family. */
export const POSITIONS: { code: string; name: string; role: PitchRole }[] = [
  { code: 'POR', name: 'Portiere', role: 'Portiere' },
  { code: 'TD', name: 'Terzino destro', role: 'Difensore' },
  { code: 'TS', name: 'Terzino sinistro', role: 'Difensore' },
  { code: 'DC', name: 'Difensore centrale', role: 'Difensore' },
  { code: 'LIB', name: 'Libero', role: 'Difensore' },
  { code: 'ED', name: 'Esterno destro', role: 'Centrocampista' },
  { code: 'ES', name: 'Esterno sinistro', role: 'Centrocampista' },
  { code: 'MED', name: 'Mediano', role: 'Centrocampista' },
  { code: 'CC', name: 'Centrocampista centrale', role: 'Centrocampista' },
  { code: 'REG', name: 'Regista', role: 'Centrocampista' },
  { code: 'TRQ', name: 'Trequartista', role: 'Centrocampista' },
  { code: 'AD', name: 'Ala destra', role: 'Attaccante' },
  { code: 'AS', name: 'Ala sinistra', role: 'Attaccante' },
  { code: 'SP', name: 'Seconda punta', role: 'Attaccante' },
  { code: 'PC', name: 'Punta centrale', role: 'Attaccante' },
  { code: 'ATT', name: 'Attaccante', role: 'Attaccante' }
];
export const POSITION_CODES = POSITIONS.map(item => item.code);
export function positionName(code: string): string { return POSITIONS.find(item => item.code === code)?.name ?? code; }

interface Row { labels: string[]; role: PitchRole; wide?: boolean; }
const half = (n: number, wide?: boolean): number => n <= 1 ? 0 : n === 2 ? 13 : n === 3 ? (wide ? 33 : 25) : n === 4 ? 38 : 40;

/** Builds the slots of a formation from its lines, goalkeeper first. */
function build(rows: Row[]): PitchSlot[] {
  const slots: PitchSlot[] = [{ id: 'por', label: 'POR', role: 'Portiere', x: 50, y: 91 }];
  rows.forEach((row, r) => {
    const n = row.labels.length;
    const y = rows.length === 1 ? 47 : Math.round(75 - r * (56 / (rows.length - 1)));
    row.labels.forEach((label, c) => {
      const x = n === 1 ? 50 : Math.round(50 - half(n, row.wide) + c * (2 * half(n, row.wide)) / (n - 1));
      slots.push({ id: `r${r}c${c}`, label, role: row.role, x, y });
    });
  });
  return slots;
}
const D = (labels: string[]): Row => ({ labels, role: 'Difensore' });
const M = (labels: string[], wide = false): Row => ({ labels, role: 'Centrocampista', wide });
const A = (labels: string[], wide = false): Row => ({ labels, role: 'Attaccante', wide });
const BACK4 = ['TS', 'DC', 'DC', 'TD'];

/** The three original formations keep their slot ids, so lineups saved before stay valid. */
const legacy: Record<string, PitchSlot[]> = {
  '4-3-3': [
    { id: 'por', label: 'POR', role: 'Portiere', x: 50, y: 91 },
    { id: 'ts', label: 'TS', role: 'Difensore', x: 13, y: 72 }, { id: 'dc1', label: 'DC', role: 'Difensore', x: 38, y: 75 }, { id: 'dc2', label: 'DC', role: 'Difensore', x: 62, y: 75 }, { id: 'td', label: 'TD', role: 'Difensore', x: 87, y: 72 },
    { id: 'mezz1', label: 'CC', role: 'Centrocampista', x: 28, y: 49 }, { id: 'med', label: 'MED', role: 'Centrocampista', x: 50, y: 56 }, { id: 'mezz2', label: 'CC', role: 'Centrocampista', x: 72, y: 49 },
    { id: 'ala1', label: 'AS', role: 'Attaccante', x: 17, y: 27 }, { id: 'punta', label: 'ATT', role: 'Attaccante', x: 50, y: 19 }, { id: 'ala2', label: 'AD', role: 'Attaccante', x: 83, y: 27 }
  ],
  '4-4-2': [
    { id: 'por', label: 'POR', role: 'Portiere', x: 50, y: 91 },
    { id: 'ts', label: 'TS', role: 'Difensore', x: 13, y: 72 }, { id: 'dc1', label: 'DC', role: 'Difensore', x: 38, y: 75 }, { id: 'dc2', label: 'DC', role: 'Difensore', x: 62, y: 75 }, { id: 'td', label: 'TD', role: 'Difensore', x: 87, y: 72 },
    { id: 'est1', label: 'ES', role: 'Centrocampista', x: 13, y: 49 }, { id: 'cc1', label: 'CC', role: 'Centrocampista', x: 38, y: 53 }, { id: 'cc2', label: 'CC', role: 'Centrocampista', x: 62, y: 53 }, { id: 'est2', label: 'ED', role: 'Centrocampista', x: 87, y: 49 },
    { id: 'att1', label: 'ATT', role: 'Attaccante', x: 37, y: 24 }, { id: 'att2', label: 'ATT', role: 'Attaccante', x: 63, y: 24 }
  ],
  '3-5-2': [
    { id: 'por', label: 'POR', role: 'Portiere', x: 50, y: 91 },
    { id: 'dc1', label: 'DC', role: 'Difensore', x: 25, y: 75 }, { id: 'dc2', label: 'DC', role: 'Difensore', x: 50, y: 78 }, { id: 'dc3', label: 'DC', role: 'Difensore', x: 75, y: 75 },
    { id: 'est1', label: 'ES', role: 'Centrocampista', x: 10, y: 49 }, { id: 'cc1', label: 'CC', role: 'Centrocampista', x: 30, y: 53 }, { id: 'reg', label: 'REG', role: 'Centrocampista', x: 50, y: 47 }, { id: 'cc2', label: 'CC', role: 'Centrocampista', x: 70, y: 53 }, { id: 'est2', label: 'ED', role: 'Centrocampista', x: 90, y: 49 },
    { id: 'att1', label: 'ATT', role: 'Attaccante', x: 36, y: 24 }, { id: 'att2', label: 'ATT', role: 'Attaccante', x: 64, y: 24 }
  ]
};

export interface FormationGroup { label: string; names: string[]; }
const defs: { group: string; name: string; rows?: Row[] }[] = [
  { group: 'Calcio a 11', name: '4-3-3' }, { group: 'Calcio a 11', name: '4-4-2' }, { group: 'Calcio a 11', name: '3-5-2' },
  { group: 'Calcio a 11', name: '4-2-3-1', rows: [D(BACK4), M(['MED', 'MED']), M(['ES', 'TRQ', 'ED'], true), A(['PC'])] },
  { group: 'Calcio a 11', name: '4-1-4-1', rows: [D(BACK4), M(['MED']), M(['ES', 'CC', 'CC', 'ED']), A(['PC'])] },
  { group: 'Calcio a 11', name: '4-4-1-1', rows: [D(BACK4), M(['ES', 'CC', 'CC', 'ED']), A(['SP']), A(['PC'])] },
  { group: 'Calcio a 11', name: '4-3-2-1', rows: [D(BACK4), M(['CC', 'MED', 'CC'], true), M(['TRQ', 'TRQ']), A(['PC'])] },
  { group: 'Calcio a 11', name: '4-5-1', rows: [D(BACK4), M(['ES', 'CC', 'MED', 'CC', 'ED']), A(['PC'])] },
  { group: 'Calcio a 11', name: '4-1-2-3', rows: [D(BACK4), M(['MED']), M(['CC', 'CC']), A(['AS', 'PC', 'AD'], true)] },
  { group: 'Calcio a 11', name: '4-3-1-2', rows: [D(BACK4), M(['CC', 'MED', 'CC'], true), M(['TRQ']), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 11', name: '4-1-2-1-2', rows: [D(BACK4), M(['MED']), M(['CC', 'CC']), M(['TRQ']), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 11', name: '4-2-2-2', rows: [D(BACK4), M(['MED', 'MED']), M(['TRQ', 'TRQ']), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 11', name: '3-4-3', rows: [D(['DC', 'DC', 'DC']), M(['ES', 'CC', 'CC', 'ED']), A(['AS', 'PC', 'AD'], true)] },
  { group: 'Calcio a 11', name: '3-4-1-2', rows: [D(['DC', 'DC', 'DC']), M(['ES', 'CC', 'CC', 'ED']), M(['TRQ']), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 11', name: '3-4-2-1', rows: [D(['DC', 'DC', 'DC']), M(['ES', 'CC', 'CC', 'ED']), M(['TRQ', 'TRQ']), A(['PC'])] },
  { group: 'Calcio a 11', name: '5-3-2', rows: [D(['TS', 'DC', 'LIB', 'DC', 'TD']), M(['CC', 'MED', 'CC'], true), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 11', name: '5-4-1', rows: [D(['TS', 'DC', 'LIB', 'DC', 'TD']), M(['ES', 'CC', 'CC', 'ED']), A(['PC'])] },
  { group: 'Calcio a 9', name: '3-3-2', rows: [D(['TS', 'DC', 'TD']), M(['ES', 'CC', 'ED'], true), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 9', name: '3-2-3', rows: [D(['TS', 'DC', 'TD']), M(['CC', 'CC']), A(['AS', 'PC', 'AD'], true)] },
  { group: 'Calcio a 9', name: '2-3-3', rows: [D(['DC', 'DC']), M(['ES', 'CC', 'ED'], true), A(['AS', 'PC', 'AD'], true)] },
  { group: 'Calcio a 9', name: '3-4-1', rows: [D(['TS', 'DC', 'TD']), M(['ES', 'CC', 'CC', 'ED']), A(['PC'])] },
  { group: 'Calcio a 9', name: '4-3-1', rows: [D(BACK4), M(['ES', 'CC', 'ED'], true), A(['PC'])] },
  { group: 'Calcio a 7', name: '2-3-1', rows: [D(['DC', 'DC']), M(['ES', 'CC', 'ED'], true), A(['PC'])] },
  { group: 'Calcio a 7', name: '3-2-1', rows: [D(['TS', 'DC', 'TD']), M(['CC', 'CC']), A(['PC'])] },
  { group: 'Calcio a 7', name: '2-2-2', rows: [D(['DC', 'DC']), M(['CC', 'CC']), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 7', name: '3-1-2', rows: [D(['TS', 'DC', 'TD']), M(['CC']), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 5', name: '1-2-1', rows: [D(['DC']), M(['ES', 'ED']), A(['PC'])] },
  { group: 'Calcio a 5', name: '2-2', rows: [D(['DC', 'DC']), A(['ATT', 'ATT'])] },
  { group: 'Calcio a 5', name: '2-1-1', rows: [D(['DC', 'DC']), M(['CC']), A(['PC'])] },
  { group: 'Calcio a 5', name: '1-1-2', rows: [D(['DC']), M(['CC']), A(['ATT', 'ATT'])] }
];

export const PITCH_SLOTS: Record<string, PitchSlot[]> = Object.fromEntries(defs.map(def => [def.name, legacy[def.name] ?? build(def.rows ?? [])]));
export const FORMATION_NAMES: string[] = defs.map(def => def.name);
export const FORMATION_GROUPS: FormationGroup[] = [...new Set(defs.map(def => def.group))].map(label => ({ label, names: defs.filter(def => def.group === label).map(def => def.name) }));
export const DEFAULT_FORMATION = '4-3-3';
