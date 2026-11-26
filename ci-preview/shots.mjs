// CI-only UI preview: seeds the Firebase emulators with a demo club, serves the
// built app and captures desktop + mobile screenshots of every screen.
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { extname, join } from 'node:path';
import { chromium } from 'playwright';

const PROJECT = 'demo-fsm';
const DIST = process.env.DIST_DIR || 'dist/football-squad-manager/browser';
const OUT = process.env.OUT_DIR || 'ui-shots';
const EMAIL = 'nico@example.test';
const PASSWORD = 'password123';
const steps = JSON.parse(await readFile(new URL('./steps.json', import.meta.url), 'utf8'));

// ---------- Firestore REST helpers (emulator, owner token bypasses rules) ----------
const enc = (v) => {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(enc) } };
  return { mapValue: { fields: Object.fromEntries(Object.entries(v).map(([k, x]) => [k, enc(x)])) } };
};
async function put(path, data) {
  const res = await fetch(`http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents/${path}`, {
    method: 'PATCH', headers: { Authorization: 'Bearer owner', 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: Object.fromEntries(Object.entries(data).map(([k, v]) => [k, enc(v)])) })
  });
  if (!res.ok) throw new Error(`seed ${path}: ${res.status} ${await res.text()}`);
}

async function seed() {
  const signUp = await fetch('http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo-key', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, displayName: 'Nico Pernici', returnSecureToken: true })
  });
  const { localId: uid } = await signUp.json();
  if (!uid) throw new Error('signUp failed');
  const ws = 'ws1', team = 'team1', season = 'season1';
  await put(`userProfiles/${uid}`, { defaultWorkspaceId: ws, displayName: 'Nico Pernici', email: EMAIL });
  await put(`workspaces/${ws}`, { name: 'Olmoponte', ownerId: uid });
  await put(`workspaces/${ws}/members/${uid}`, { role: 'owner', status: 'active', displayName: 'Nico Pernici' });
  await put(`workspaces/${ws}/teams/${team}`, {
    name: 'Olmoponte S. Firmina', category: 'Juniores Under 19 Provinciale', facilityName: 'Campo Sportivo Santa Firmina',
    facilityAddress: 'Via Santa Firmina 111, Arezzo', headquartersAddress: 'Via del Verrocchio 10, Arezzo', federationNumber: '922670',
    outfieldPlayersCount: 10, goalkeeperCount: 1, periodCount: 2, periodMinutes: 45, playersOnField: 11, playersOnRoster: 20,
    maxSubstitutions: 5, reentryAllowed: false, federationReportRequired: true, fixedPlayerCount: null, allPlayersMustPlay: false,
    icon: '🦁', isArchived: false
  });
  await put(`workspaces/${ws}/teams/team2`, { name: 'Allievi Regionali', category: 'Allievi Regionali U17', facilityName: 'Stadio Comunale', icon: '⚽', isArchived: false });
  await put(`workspaces/${ws}/teams/team2/seasons/s2`, { label: '2026/2027', status: 'active' });
  await put(`workspaces/${ws}/teams/${team}/seasons/${season}`, { label: '2026/2027', status: 'active' });
  const roster = [
    ['Rossi', 'Matteo', 1, 'Portiere'], ['Fontana', 'Lorenzo', 2, 'Difensore'], ['Verdi', 'Marco', 3, 'Difensore'], ['Costa', 'Andrea', 4, 'Difensore'],
    ['Sala', 'Riccardo', 5, 'Difensore'], ['Bianchi', 'Luca', 6, 'Centrocampista'], ['Ferri', 'Alessio', 7, 'Attaccante'], ['Romano', 'Pietro', 8, 'Centrocampista'],
    ['Conti', 'Simone', 9, 'Attaccante'], ['Neri', 'Davide', 10, 'Centrocampista'], ['Galli', 'Andrea', 11, 'Attaccante'], ['Esposito', 'Filippo', 12, 'Portiere'],
    ['Riva', 'Tommaso', 13, 'Difensore'], ['Longo', 'Matteo', 14, 'Difensore'], ['Villa', 'Stefano', 15, 'Centrocampista'], ['Moretti', 'Luca', 16, 'Centrocampista'],
    ['Greco', 'Marco', 19, 'Attaccante'], ['Marinelli', 'Enrico', 20, 'Difensore']
  ];
  const ids = {};
  for (const [lastName, firstName, number, role] of roster) {
    const id = `p${number}`; ids[number] = id;
    await put(`workspaces/${ws}/players/${id}`, { firstName, lastName, dateOfBirth: '2008-03-12', placeOfBirth: 'Arezzo', primaryRole: role, notes: '', isArchived: false, preferredFoot: 'Destro', goals: number % 4, assists: number % 3, yellowCards: number % 2, keyPasses: number % 5 });
    await put(`workspaces/${ws}/teams/${team}/seasons/${season}/squadMembers/${id}`, { playerId: id, shirtNumber: number, roles: [role], status: 'active', isCaptain: number === 8, isViceCaptain: number === 10 });
    await put(`workspaces/${ws}/teams/${team}/seasons/${season}/jerseyReservations/${number}`, { playerId: id });
  }
  const lineup = { por: ids[1], ts: ids[3], dc1: ids[5], dc2: ids[4], td: ids[2], mezz1: ids[10], med: ids[8], mezz2: ids[6], ala1: ids[11], punta: ids[9], ala2: ids[7] };
  await put(`workspaces/${ws}/teams/${team}/seasons/${season}/settings/tactical-layout`, { formation: '4-3-3', lineup, shirtPositions: {} });
  await put(`workspaces/${ws}/teams/${team}/seasons/${season}/settings/captaincy`, { captainId: ids[8], viceCaptainId: ids[10] });
}

// ---------- static server for the built SPA ----------
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon' };
const server = createServer(async (req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0]);
  try {
    const body = await readFile(join(DIST, url === '/' ? 'index.html' : url));
    res.writeHead(200, { 'Content-Type': types[extname(url)] || 'application/octet-stream' }); res.end(body);
  } catch { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(await readFile(join(DIST, 'index.html'))); }
}).listen(4300);

await seed();
await mkdir(OUT, { recursive: true });
const browser = await chromium.launch();
const viewports = { desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } };
const log = [];
for (const [vpName, vp] of Object.entries(viewports)) {
  const { width, height, ...rest } = vp;
  const context = await browser.newContext({ viewport: { width, height }, ...rest });
  const page = await context.newPage();
  page.on('pageerror', (e) => log.push(`[${vpName}] pageerror: ${e.message}`));
  page.on('console', (m) => { if (m.type() === 'error') log.push(`[${vpName}] console: ${m.text().slice(0, 300)}`); });
  await page.goto('http://127.0.0.1:4300/');
  await page.waitForTimeout(3200);
  await page.screenshot({ path: `${OUT}/${vpName}-00-login.png`, fullPage: true });
  await page.fill('#email', EMAIL); await page.fill('#password', PASSWORD);
  await page.click('button[type=submit]');
  await page.waitForTimeout(4500);
  for (const step of steps) {
    if (step.only && step.only !== vpName) continue;
    try {
      for (const a of step.actions || []) {
        if (a.click) await page.locator(a.click).filter({ visible: true }).first().click({ timeout: 6000 });
        if (a.fill) await page.locator(a.fill).filter({ visible: true }).first().fill(a.value, { timeout: 6000 });
        if (a.press) await page.keyboard.press(a.press);
        if (a.wait) await page.waitForTimeout(a.wait);
        if (a.eval) await page.evaluate(a.eval);
      }
      await page.waitForTimeout(step.settle ?? 900);
      await page.screenshot({ path: `${OUT}/${vpName}-${step.name}.png`, fullPage: step.full !== false });
      log.push(`[${vpName}] ok ${step.name}`);
    } catch (e) {
      log.push(`[${vpName}] FAIL ${step.name}: ${String(e.message).split('\n')[0]}`);
      await page.screenshot({ path: `${OUT}/${vpName}-${step.name}-FAIL.png` }).catch(() => {});
    }
  }
  await context.close();
}
await browser.close();
server.close();
await writeFile(`${OUT}/log.txt`, log.join('\n') + '\n');
console.log(log.join('\n'));
