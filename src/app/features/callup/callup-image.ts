/** Draws the call-up as a picture (PNG) that the coach can send to the players. */
export interface CallupImagePlayer { tag: string; number: string; name: string; badge: string; }
export interface CallupImageData {
  teamName: string; category: string; icon: string; eventTitle: string; roundLabel: string;
  home: string; away: string; teamIsHome: boolean; date: string; time: string;
  meetingTime: string; meetingPlace: string; venue: string; kit: string; notes: string;
  formation: string; starters: CallupImagePlayer[]; bench: CallupImagePlayer[]; calledCount: number;
}

const W = 1080;
const PAD = 48;
const FONT = '"Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const TAG_COLORS: Record<string, string> = { POR: '#f5a400', DIF: '#3b82f6', CEN: '#22c55e', ATT: '#ef4444' };

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

function wrap(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []; let line = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const test = line ? `${line} ${word}` : word;
    if (ctx.measureText(test).width <= maxWidth || !line) line = test; else { lines.push(line); line = word; }
  }
  if (line) lines.push(line);
  return lines.length ? lines : [''];
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise(resolve => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => resolve(null); image.src = src; });
}

function paint(ctx: CanvasRenderingContext2D, data: CallupImageData, logo: HTMLImageElement | null, height: number): number {
  const bg = ctx.createLinearGradient(0, 0, 0, height);
  bg.addColorStop(0, '#12326b'); bg.addColorStop(0.35, '#0b1f40'); bg.addColorStop(1, '#06101f');
  ctx.fillStyle = bg; ctx.fillRect(0, 0, W, height);
  ctx.fillStyle = '#ffd21a'; ctx.fillRect(0, 0, W, 10);

  let y = 56;
  // Header: logo + title
  const logoSize = 120;
  ctx.fillStyle = 'rgba(255,255,255,0.1)'; roundRect(ctx, PAD, y, logoSize, logoSize, 28); ctx.fill();
  if (logo) { ctx.save(); roundRect(ctx, PAD, y, logoSize, logoSize, 28); ctx.clip(); ctx.drawImage(logo, PAD, y, logoSize, logoSize); ctx.restore(); }
  else if (data.icon) { ctx.font = `72px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText(data.icon, PAD + logoSize / 2, y + logoSize / 2 + 4); }
  ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
  const tx = PAD + logoSize + 28;
  ctx.fillStyle = '#ffd21a'; ctx.font = `800 26px ${FONT}`;
  ctx.save(); (ctx as unknown as { letterSpacing: string }).letterSpacing = '6px'; ctx.fillText('CONVOCAZIONE', tx, y + 34); ctx.restore();
  ctx.fillStyle = '#fff'; ctx.font = `800 52px ${FONT}`;
  const nameLines = wrap(ctx, data.teamName, W - tx - PAD).slice(0, 2);
  nameLines.forEach((line, i) => ctx.fillText(line, tx, y + 88 + i * 56));
  y += Math.max(logoSize, 70 + nameLines.length * 56) + 10;
  ctx.fillStyle = '#b8c7e6'; ctx.font = `500 26px ${FONT}`;
  const sub = [data.category, data.eventTitle, data.roundLabel].filter(Boolean).join(' · ');
  for (const line of wrap(ctx, sub, W - PAD * 2)) { ctx.fillText(line, PAD, y + 26); y += 34; }
  y += 22;

  // Match card
  const cardH = 150;
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, PAD, y, W - PAD * 2, cardH, 28); ctx.fill();
  ctx.strokeStyle = 'rgba(255,210,26,0.55)'; ctx.lineWidth = 2; roundRect(ctx, PAD, y, W - PAD * 2, cardH, 28); ctx.stroke();
  const sideW = (W - PAD * 2 - 130) / 2;
  const drawSide = (text: string, cx: number, mine: boolean): void => {
    ctx.fillStyle = mine ? '#ffd21a' : '#fff'; ctx.font = `800 36px ${FONT}`; ctx.textAlign = 'center';
    const lines = wrap(ctx, text, sideW - 20).slice(0, 2);
    lines.forEach((line, i) => ctx.fillText(line, cx, y + cardH / 2 + 12 - (lines.length - 1) * 22 + i * 44));
  };
  drawSide(data.home, PAD + sideW / 2 + 10, data.teamIsHome);
  drawSide(data.away, W - PAD - sideW / 2 - 10, !data.teamIsHome);
  ctx.fillStyle = '#ffd21a'; ctx.beginPath(); ctx.arc(W / 2, y + cardH / 2, 34, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#1a1300'; ctx.font = `900 28px ${FONT}`; ctx.fillText('VS', W / 2, y + cardH / 2 + 10);
  ctx.textAlign = 'left';
  y += cardH + 26;

  // Info grid
  const info: [string, string][] = [
    ['DATA E ORA GARA', [data.date, data.time ? `ore ${data.time}` : ''].filter(Boolean).join(' · ')],
    ['RITROVO', [data.meetingTime ? `ore ${data.meetingTime}` : '', data.meetingPlace].filter(Boolean).join(' · ')],
    ['CAMPO', data.venue],
    ['DIVISA', data.kit]
  ].filter(([, value]) => !!value) as [string, string][];
  const colW = (W - PAD * 2 - 24) / 2;
  for (let i = 0; i < info.length; i += 2) {
    const row = info.slice(i, i + 2);
    ctx.font = `700 30px ${FONT}`;
    const lineSets = row.map(([, value]) => wrap(ctx, value, colW - 32).slice(0, 3));
    const h = 52 + Math.max(...lineSets.map(lines => lines.length)) * 38 + 8;
    row.forEach(([label], c) => {
      const x = PAD + c * (colW + 24);
      ctx.fillStyle = 'rgba(255,255,255,0.06)'; roundRect(ctx, x, y, colW, h, 20); ctx.fill();
      ctx.fillStyle = '#ffd21a'; ctx.font = `800 20px ${FONT}`; ctx.save(); (ctx as unknown as { letterSpacing: string }).letterSpacing = '3px'; ctx.fillText(label, x + 18, y + 34); ctx.restore();
      ctx.fillStyle = '#fff'; ctx.font = `700 30px ${FONT}`;
      lineSets[c].forEach((line, k) => ctx.fillText(line, x + 18, y + 72 + k * 38));
    });
    y += h + 16;
  }
  y += 10;

  // Players
  const listW = (W - PAD * 2 - 24) / 2;
  const rowH = 62;
  const drawList = (x: number, title: string, items: CallupImagePlayer[], top: number): number => {
    ctx.fillStyle = '#ffd21a'; roundRect(ctx, x, top, listW, 50, 14); ctx.fill();
    ctx.fillStyle = '#1a1300'; ctx.font = `900 26px ${FONT}`; ctx.fillText(title, x + 18, top + 35);
    let yy = top + 62;
    if (!items.length) { ctx.fillStyle = '#b8c7e6'; ctx.font = `500 26px ${FONT}`; ctx.fillText('Da definire', x + 18, yy + 38); yy += rowH; }
    items.forEach((item, i) => {
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.08)'; roundRect(ctx, x, yy, listW, rowH - 6, 14); ctx.fill();
      ctx.fillStyle = TAG_COLORS[item.tag] ?? '#64748b'; roundRect(ctx, x + 10, yy + 12, 62, 34, 10); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = `800 20px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(item.tag, x + 41, yy + 36); ctx.textAlign = 'left';
      ctx.font = `800 26px ${FONT}`; ctx.fillStyle = '#ffd21a'; ctx.fillText(item.number ? `#${item.number}` : '', x + 84, yy + 38);
      ctx.fillStyle = '#fff'; ctx.font = `600 26px ${FONT}`;
      let name = item.name; const maxName = listW - 84 - 70 - (item.badge ? 50 : 0);
      while (ctx.measureText(name).width > maxName && name.length > 4) name = name.slice(0, -2);
      if (name !== item.name) name += '…';
      ctx.fillText(name, x + 84 + 70, yy + 38);
      if (item.badge) { ctx.fillStyle = '#ffd21a'; ctx.beginPath(); ctx.arc(x + listW - 28, yy + 25, 17, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#1a1300'; ctx.font = `900 ${item.badge.length > 1 ? 15 : 20}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(item.badge, x + listW - 28, yy + 32); ctx.textAlign = 'left'; }
      yy += rowH;
    });
    return yy;
  };
  const a = drawList(PAD, `TITOLARI${data.formation ? ' · ' + data.formation : ''}`, data.starters, y);
  const b = drawList(PAD + listW + 24, 'PANCHINA', data.bench, y);
  y = Math.max(a, b) + 14;

  if (data.notes) {
    ctx.font = `500 26px ${FONT}`;
    const lines = wrap(ctx, data.notes, W - PAD * 2 - 40).slice(0, 6);
    const h = 44 + lines.length * 34;
    ctx.fillStyle = 'rgba(255,255,255,0.08)'; roundRect(ctx, PAD, y, W - PAD * 2, h, 20); ctx.fill();
    ctx.fillStyle = '#ffd21a'; ctx.font = `800 20px ${FONT}`; ctx.fillText('NOTE', PAD + 20, y + 32);
    ctx.fillStyle = '#fff'; ctx.font = `500 26px ${FONT}`; lines.forEach((line, i) => ctx.fillText(line, PAD + 20, y + 68 + i * 34));
    y += h + 18;
  }

  ctx.fillStyle = '#b8c7e6'; ctx.font = `600 24px ${FONT}`; ctx.fillText(`Convocati: ${data.calledCount}`, PAD, y + 30);
  ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.font = `600 22px ${FONT}`; ctx.fillText('Football Squad Manager', W - PAD, y + 30); ctx.textAlign = 'left';
  return y + 70;
}

export async function renderCallupImage(data: CallupImageData): Promise<Blob> {
  const logo = data.icon.startsWith('data:image/') ? await loadImage(data.icon) : null;
  const scratch = document.createElement('canvas'); scratch.width = W; scratch.height = 3000;
  const height = Math.ceil(paint(scratch.getContext('2d')!, data, logo, 3000));
  const canvas = document.createElement('canvas'); canvas.width = W; canvas.height = height;
  paint(canvas.getContext('2d')!, data, logo, height);
  return new Promise((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Immagine non creata')), 'image/png'));
}
