import { ChangeDetectionStrategy, Component, inject, input, OnDestroy, OnInit, output, signal } from '@angular/core';
import type { PlayerRecord } from '../players/player.service';
import { VoiceRecognitionService } from '../../core/voice/voice-recognition.service';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { PlayerService } from '../players/player.service';
import { TeamService } from './team.service';

type MatchEventType = 'goal' | 'yellow-card' | 'red-card' | 'substitution' | 'formation';
interface MatchEvent { type: MatchEventType; minute: number; description: string; playerId?: string; assistPlayerId?: string; outgoingId?: string; incomingId?: string; }
interface PendingAction { type: MatchEventType; playerId?: string; assistPlayerId?: string; outgoingId?: string; incomingId?: string; description: string; }
interface MatchAnimation { type: 'goal' | 'yellow-card' | 'red-card' | 'substitution'; title: string; detail: string; outgoingNumber?: number | null; incomingNumber?: number | null; playerNumber?: number | null; }

@Component({
  selector: 'fsm-live-match',
  standalone: true,
  templateUrl: './live-match.component.html',
  styleUrl: './live-match.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveMatchComponent implements OnDestroy, OnInit {
  readonly teamName = input.required<string>();
  readonly workspaceId = input.required<string>();
  readonly teamId = input.required<string>();
  readonly seasonId = input.required<string>();
  readonly players = input.required<PlayerRecord[]>();
  readonly initialLineup = input.required<Record<string, string>>();
  readonly formation = input.required<string>();
  readonly initialPositions = input.required<Record<string, { x: number; y: number }>>();
  readonly autoStart = input(false);
  readonly closematch = output<void>();
  private readonly voice = inject(VoiceRecognitionService);
  private readonly auth = inject(FirebaseAuthService);
  private readonly playerService = inject(PlayerService);
  private readonly teamService = inject(TeamService);
  protected readonly elapsedSeconds = signal(0);
  protected readonly running = signal(false);
  protected readonly finished = signal(false);
  protected readonly finishReportOpen = signal(false);
  protected readonly editingEvent = signal<MatchEvent | null>(null);
  protected readonly editMinute = signal('0');
  protected readonly editPlayerId = signal('');
  protected readonly editAssistPlayerId = signal('');
  protected readonly editOutgoingId = signal('');
  protected readonly editIncomingId = signal('');
  protected readonly editDescription = signal('');
  protected readonly benchOpen = signal(false);
  protected readonly selectedOutgoingId = signal<string | null>(null);
  protected readonly pending = signal<PendingAction | null>(null);
  protected readonly events = signal<MatchEvent[]>([]);
  protected readonly goals = signal<Record<string, number>>({});
  protected readonly assists = signal<Record<string, number>>({});
  protected readonly yellowCards = signal<Record<string, number>>({});
  protected readonly redCards = signal<string[]>([]);
  protected readonly lineup = signal<Record<string, string>>({});
  protected readonly matchFormation = signal('4-3-3');
  protected readonly matchFormationDropdownOpen = signal(false);
  protected readonly matchPositions = signal<Record<string, { x: number; y: number }>>({});
  private draggingPlayerId: string | null = null;
  private draggingElement: HTMLElement | null = null;
  private dragStartPosition: { x: number; y: number } | null = null;
  private dragCurrentPosition: { x: number; y: number } | null = null;
  protected readonly voiceListening = signal(false);
  protected readonly voiceMessage = signal('');
  protected readonly voiceDraft = signal('');
  private readonly voiceHelpStorageKey = 'fsm-voice-command-guide-open';
  protected readonly voiceHelpOpen = signal(this.readVoiceHelpPreference());
  protected readonly matchAnimation = signal<MatchAnimation | null>(null);
  private animationTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly changesUsed = signal(0);
  protected readonly maxChanges = 5;
  private timer: ReturnType<typeof setInterval> | null = null;
  private exitingMatch = false;
  private persistQueue: Promise<void> = Promise.resolve();
  private runStartedAtMs: number | null = null;
  private runBaseSeconds = 0;
  private lastPersistedElapsed = 0;
  private formationPlayerOrder: string[] = [];
  private voicePointerId: number | null = null;
  private voiceStartFailed = false;

  readonly formations: Record<string, { id: string; label: string; x: number; y: number }[]> = {
    '4-3-3': [
      {id:'por',label:'POR',x:50,y:91},{id:'ts',label:'TS',x:13,y:72},{id:'dc1',label:'DC',x:38,y:75},{id:'dc2',label:'DC',x:62,y:75},{id:'td',label:'TD',x:87,y:72},
      {id:'mezz1',label:'CC',x:28,y:49},{id:'med',label:'MED',x:50,y:56},{id:'mezz2',label:'CC',x:72,y:49},{id:'ala1',label:'AS',x:17,y:27},{id:'punta',label:'ATT',x:50,y:19},{id:'ala2',label:'AD',x:83,y:27}
    ],
    '4-4-2': [
      {id:'por',label:'POR',x:50,y:91},{id:'ts',label:'TS',x:13,y:72},{id:'dc1',label:'DC',x:38,y:75},{id:'dc2',label:'DC',x:62,y:75},{id:'td',label:'TD',x:87,y:72},
      {id:'est1',label:'ES',x:13,y:49},{id:'cc1',label:'CC',x:38,y:53},{id:'cc2',label:'CC',x:62,y:53},{id:'est2',label:'ED',x:87,y:49},{id:'att1',label:'ATT',x:37,y:24},{id:'att2',label:'ATT',x:63,y:24}
    ],
    '3-5-2': [
      {id:'por',label:'POR',x:50,y:91},{id:'dc1',label:'DC',x:25,y:75},{id:'dc2',label:'DC',x:50,y:78},{id:'dc3',label:'DC',x:75,y:75},
      {id:'est1',label:'EST',x:10,y:49},{id:'cc1',label:'CC',x:30,y:53},{id:'reg',label:'REG',x:50,y:47},{id:'cc2',label:'CC',x:70,y:53},{id:'est2',label:'EST',x:90,y:49},{id:'att1',label:'ATT',x:36,y:24},{id:'att2',label:'ATT',x:64,y:24}
    ]
  };

  async ngOnInit(): Promise<void> {
    this.lineup.set({...this.initialLineup()});
    const f = this.formations[this.formation()] ? this.formation() : '4-3-3'; this.matchFormation.set(f);
    this.formationPlayerOrder = this.formations[f].map(slot => this.initialLineup()[slot.id]).filter((id): id is string => !!id);
    const p: Record<string, {x:number;y:number}> = {};
    for (const slot of this.formations[f]) { const id=this.initialLineup()[slot.id]; if(id) p[id]=this.initialPositions()[id] ?? {x:slot.x,y:slot.y}; }
    this.matchPositions.set(p);
    if (this.autoStart()) { this.start(); return; }
    try {
      const saved = await this.teamService.loadLiveMatch(this.workspaceId(), this.teamId(), this.seasonId());
      if (saved) {
        const restoredElapsed = saved.running && !saved.finished ? saved.elapsedSeconds + Math.max(0, Math.floor((Date.now() - saved.savedAtMs) / 1000)) : saved.elapsedSeconds;
        this.elapsedSeconds.set(Math.max(0, Math.min(5400, restoredElapsed)));
        const restoredFinished = saved.finished || restoredElapsed >= 5400;
        this.finished.set(restoredFinished); this.finishReportOpen.set(restoredFinished); this.events.set(saved.events); this.goals.set(saved.goals); this.assists.set(saved.assists);
        this.yellowCards.set(saved.yellowCards); this.redCards.set(saved.redCards); this.lineup.set(saved.lineup);
        this.matchFormation.set(this.formations[saved.formation] ? saved.formation : f); this.matchPositions.set(saved.positions);
        this.formationPlayerOrder = this.formations[this.matchFormation()].map(slot => saved.lineup[slot.id]).filter((id): id is string => !!id);
        this.changesUsed.set(Math.max(0, Math.min(this.maxChanges, saved.changesUsed)));
        if (saved.running && !this.finished()) this.start();
      }
    } catch (error) { console.error('Unable to restore live match.', error); this.voiceMessage.set('Partita caricata, ma non è stato possibile recuperare gli ultimi dati salvati.'); }
  }
  ngOnDestroy(): void { if(this.timer){clearInterval(this.timer);this.timer=null;} this.settleRunningClock(); this.voice.cancel(); if(this.animationTimer) clearTimeout(this.animationTimer); if(!this.exitingMatch) void this.persistMatchState(); }
  private async persistMatchState(): Promise<void> {
    if(this.exitingMatch) return;
    const snapshot = {
      elapsedSeconds:this.currentElapsedSeconds(), savedAtMs:Date.now(), running:this.running(), finished:this.finished(), events:this.events(), goals:this.goals(), assists:this.assists(),
      yellowCards:this.yellowCards(), redCards:this.redCards(), lineup:this.lineup(), formation:this.matchFormation(), positions:this.matchPositions(), changesUsed:this.changesUsed()
    };
    this.lastPersistedElapsed = snapshot.elapsedSeconds;
    this.persistQueue = this.persistQueue.then(async () => {
      if(this.exitingMatch) return;
      try { await this.teamService.saveLiveMatch(this.workspaceId(), this.teamId(), this.seasonId(), snapshot); }
      catch(error) { console.error('Unable to save live match.', error); }
    });
    await this.persistQueue;
  }
  private showMatchAnimation(animation: MatchAnimation): void { if(this.animationTimer) clearTimeout(this.animationTimer); this.matchAnimation.set(animation); this.animationTimer=setTimeout(()=>{this.matchAnimation.set(null);this.animationTimer=null;},2600); }

  protected slots() {
    const formationSlots = this.formations[this.matchFormation()] ?? this.formations['4-3-3'];
    const currentLineup = this.lineup(); const positions = this.matchPositions();
    return formationSlots.map(slot => { const playerId = currentLineup[slot.id]; const saved = playerId ? positions[playerId] : undefined; return saved ? { ...slot, x: Math.max(9, Math.min(91, saved.x)), y: Math.max(9, Math.min(91, saved.y)) } : slot; });
  }
  protected formationOptions(): string[] { return Object.keys(this.formations); }
  protected changeMatchFormation(next: string): void { if (!this.formations[next] || next === this.matchFormation()) return; const previous=this.matchFormation(); const ids=this.formationPlayerOrder.length ? this.formationPlayerOrder : this.formations[previous].map(slot=>this.lineup()[slot.id]).filter((id): id is string => !!id); this.formationPlayerOrder=[...ids]; const lineup: Record<string,string>={}; const positions: Record<string,{x:number;y:number}>={}; this.formations[next].forEach((slot,i)=>{const id=ids[i];if(id){lineup[slot.id]=id;positions[id]={x:slot.x,y:slot.y};}}); this.lineup.set(lineup);this.matchPositions.set(positions);this.matchFormation.set(next);this.selectedOutgoingId.set(null);this.events.update(items=>[{type:'formation',minute:this.minute,description:'Cambio modulo: '+previous+' → '+next},...items]);this.voiceMessage.set('');this.voiceDraft.set(''); void this.persistMatchState(); }
  protected startShirtDrag(event: PointerEvent, id: string): void {
    if (event.button !== 0) return;
    event.preventDefault();
    const element = event.currentTarget as HTMLElement;
    this.draggingPlayerId = id;
    this.draggingElement = element;
    const saved = this.matchPositions()[id] ?? { x: Number.parseFloat(element.style.left) || 50, y: Number.parseFloat(element.style.top) || 50 };
    this.dragStartPosition = { ...saved };
    this.dragCurrentPosition = { ...saved };
    element.setPointerCapture(event.pointerId);
  }
  protected moveShirtDrag(event: PointerEvent): void {
    if (!this.draggingPlayerId || !this.draggingElement || !this.dragStartPosition) return;
    const pitch = event.currentTarget as HTMLElement;
    const rect = pitch.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    const x = Math.max(9, Math.min(91, ((event.clientX - rect.left) / rect.width) * 100));
    const y = Math.max(9, Math.min(91, ((event.clientY - rect.top) / rect.height) * 100));
    this.dragCurrentPosition = { x, y };
    const dx = (x - this.dragStartPosition.x) * rect.width / 100;
    const dy = (y - this.dragStartPosition.y) * rect.height / 100;
    // Move only the dragged DOM node during pointer movement; avoid triggering Angular change detection.
    this.draggingElement.style.transform = `translate3d(calc(-50% + ${dx}px), calc(-50% + ${dy}px), 0)`;
  }
  protected endShirtDrag(): void {
    const id = this.draggingPlayerId;
    const position = this.dragCurrentPosition;
    if (id && position) this.matchPositions.update(current => ({ ...current, [id]: position }));
    if (this.draggingElement) this.draggingElement.style.transform = '';
    this.draggingPlayerId = null;
    this.draggingElement = null;
    this.dragStartPosition = null;
    this.dragCurrentPosition = null;
    void this.persistMatchState();
  }
  protected player(id: string | undefined): PlayerRecord | undefined { return this.players().find(p => p.id === id); }
  protected playerInSlot(slotId: string): PlayerRecord | undefined { return this.player(this.lineup()[slotId]); }
  private sortByShirtNumber(players: PlayerRecord[]): PlayerRecord[] {
    return [...players].sort((a, b) => {
      const aNumber = a.shirtNumber ?? Number.POSITIVE_INFINITY;
      const bNumber = b.shirtNumber ?? Number.POSITIVE_INFINITY;
      return aNumber - bNumber || a.lastName.localeCompare(b.lastName, 'it') || a.firstName.localeCompare(b.firstName, 'it');
    });
  }
  protected onField(): PlayerRecord[] {
    return this.sortByShirtNumber(Object.values(this.lineup()).filter(Boolean).map(id => this.player(id)).filter((p): p is PlayerRecord => !!p));
  }
  protected bench(): PlayerRecord[] {
    const ids = new Set(Object.values(this.lineup()));
    return this.sortByShirtNumber(this.players().filter(p => !ids.has(p.id) && !this.redCards().includes(p.id)));
  }
  protected get minute(): number { this.elapsedSeconds(); return Math.min(90, Math.floor(this.currentElapsedSeconds()/60)); }
  protected get clock(): string { this.elapsedSeconds(); const elapsed=this.currentElapsedSeconds(),m=Math.floor(elapsed/60),s=elapsed%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
  private currentElapsedSeconds(): number { return this.running() && this.runStartedAtMs !== null ? Math.min(5400, this.runBaseSeconds + Math.floor((Date.now() - this.runStartedAtMs) / 1000)) : this.elapsedSeconds(); }
  private settleRunningClock(): void { const elapsed=this.currentElapsedSeconds(); this.elapsedSeconds.set(elapsed); this.runBaseSeconds=elapsed; this.runStartedAtMs=null; }
  protected get score(): string { return String(Object.values(this.goals()).reduce((a,b)=>a+b,0)); }
  protected start(): void {
    if(this.finished()||this.running()) return;
    this.runBaseSeconds=this.elapsedSeconds(); this.runStartedAtMs=Date.now(); this.running.set(true); this.lastPersistedElapsed=this.runBaseSeconds;
    this.timer=setInterval(()=>{
      const elapsed=this.currentElapsedSeconds(); this.elapsedSeconds.set(elapsed);
      if(elapsed>=5400){if(this.timer){clearInterval(this.timer);this.timer=null;}this.elapsedSeconds.set(5400);this.runBaseSeconds=5400;this.runStartedAtMs=null;this.running.set(false);this.finished.set(true);this.finishReportOpen.set(true);void this.persistMatchState();}
      else if(elapsed-this.lastPersistedElapsed>=15) void this.persistMatchState();
    },1000);
    void this.persistMatchState();
  }
  protected pause(): void { this.settleRunningClock(); if(this.timer){clearInterval(this.timer);this.timer=null;} this.running.set(false); void this.persistMatchState(); }

  protected finishMatch(): void {
    if (this.finished()) { this.finishReportOpen.set(true); return; }
    this.settleRunningClock();
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    this.running.set(false);
    this.finished.set(true);
    this.finishReportOpen.set(true);
    this.voice.cancel();
    this.voiceListening.set(false);
    this.voiceMessage.set('');
    void this.persistMatchState();
  }

  protected beginEditEvent(event: MatchEvent): void {
    this.editingEvent.set(event);
    this.editMinute.set(String(event.minute));
    this.editPlayerId.set(event.playerId ?? '');
    this.editAssistPlayerId.set(event.assistPlayerId ?? '');
    this.editOutgoingId.set(event.outgoingId ?? '');
    this.editIncomingId.set(event.incomingId ?? '');
    this.editDescription.set(event.description);
  }

  protected cancelEditEvent(): void { this.editingEvent.set(null); }

  protected async saveEditedEvent(): Promise<void> {
    const current = this.editingEvent();
    if (!current) return;
    const minute = Math.max(0, Math.min(90, Math.floor(Number(this.editMinute()) || 0)));
    const updated: MatchEvent = { ...current, minute };
    if (current.type === 'goal') {
      const scorer = this.player(this.editPlayerId());
      const assister = this.player(this.editAssistPlayerId());
      if (!scorer || (this.editAssistPlayerId() && !assister) || scorer.id === assister?.id) {
        this.voiceMessage.set('Seleziona un marcatore valido e un assistente diverso.'); return;
      }
      updated.playerId = scorer.id;
      updated.assistPlayerId = assister?.id;
      updated.description = `Gol di #${scorer.shirtNumber} ${scorer.firstName} ${scorer.lastName}${assister ? ` · assist di #${assister.shirtNumber} ${assister.lastName}` : ''}`;
    } else if (current.type === 'yellow-card' || current.type === 'red-card') {
      const booked = this.player(this.editPlayerId());
      if (!booked) { this.voiceMessage.set('Seleziona il giocatore dell’evento.'); return; }
      updated.playerId = booked.id;
      updated.description = current.type === 'yellow-card'
        ? `Ammonizione a #${booked.shirtNumber} ${booked.firstName} ${booked.lastName}${/seconda ammonizione/i.test(current.description) ? ' (seconda ammonizione)' : ''}`
        : `Espulsione di #${booked.shirtNumber} ${booked.firstName} ${booked.lastName}`;
    } else if (current.type === 'substitution') {
      const outgoing = this.player(this.editOutgoingId()), incoming = this.player(this.editIncomingId());
      if (!outgoing || !incoming || outgoing.id === incoming.id) { this.voiceMessage.set('Seleziona due giocatori diversi per la sostituzione.'); return; }
      updated.outgoingId = outgoing.id; updated.incomingId = incoming.id;
      updated.description = `Cambio: esce #${outgoing.shirtNumber} ${outgoing.lastName}, entra #${incoming.shirtNumber} ${incoming.lastName}`;
    } else {
      updated.description = this.editDescription().trim() || 'Cambio modulo';
    }
    const previous = this.events();
    const next = previous.map(event => event === current ? updated : event);
    this.editingEvent.set(null);
    await this.applyEventChanges(previous, next);
    this.voiceMessage.set('Evento modificato.');
  }

  protected async deleteMatchEvent(event: MatchEvent): Promise<void> {
    const previous = this.events();
    let next = previous.filter(item => item !== event);
    if (event.type === 'yellow-card' && /seconda ammonizione/i.test(event.description)) {
      next = next.filter(item => !(item.type === 'red-card' && item.playerId === event.playerId && item.minute === event.minute));
    }
    if (event.type === 'red-card' && /seconda ammonizione/i.test(event.description)) {
      next = next.filter(item => !(item.type === 'yellow-card' && item.playerId === event.playerId && item.minute === event.minute && /seconda ammonizione/i.test(item.description)));
    }
    await this.applyEventChanges(previous, next);
    this.voiceMessage.set('Evento eliminato.');
  }

  private async applyEventChanges(previous: MatchEvent[], next: MatchEvent[]): Promise<void> {
    const count = (items: MatchEvent[], type: MatchEventType, field: 'playerId' | 'assistPlayerId') => {
      const result: Record<string, number> = {};
      for (const item of items) if (item.type === type && item[field]) {
        const id = item[field]!;
        result[id] = (result[id] ?? 0) + 1;
      }
      return result;
    };
    const oldGoals = count(previous, 'goal', 'playerId'), newGoals = count(next, 'goal', 'playerId');
    const oldAssists = count(previous, 'goal', 'assistPlayerId'), newAssists = count(next, 'goal', 'assistPlayerId');
    const oldYellows = count(previous, 'yellow-card', 'playerId'), newYellows = count(next, 'yellow-card', 'playerId');
    const oldReds = [...new Set(previous.filter(e => e.type === 'red-card' && e.playerId).map(e => e.playerId!))];
    const newReds = [...new Set(next.filter(e => e.type === 'red-card' && e.playerId).map(e => e.playerId!))];
    const workspaceId = this.auth.workspaceId();
    if (workspaceId) {
      const changes: Promise<void>[] = [];
      for (const id of new Set([...Object.keys(oldGoals), ...Object.keys(newGoals)])) {
        const delta = (newGoals[id] ?? 0) - (oldGoals[id] ?? 0);
        for (let i = 0; i < Math.abs(delta); i++) changes.push(delta > 0 ? this.playerService.recordGoal(workspaceId, id) : this.playerService.removeGoal(workspaceId, id));
      }
      for (const id of new Set([...Object.keys(oldAssists), ...Object.keys(newAssists)])) {
        const delta = (newAssists[id] ?? 0) - (oldAssists[id] ?? 0);
        for (let i = 0; i < Math.abs(delta); i++) changes.push(delta > 0 ? this.playerService.recordAssist(workspaceId, id) : this.playerService.removeAssist(workspaceId, id));
      }
      await Promise.all(changes);
    }
    this.events.set(next);
    this.goals.set(newGoals); this.assists.set(newAssists); this.yellowCards.set(newYellows); this.redCards.set(newReds);
    this.changesUsed.set(Math.min(this.maxChanges, next.filter(e => e.type === 'substitution').length));
    await this.persistMatchState();
  }

  protected async shareMatchReport(): Promise<void> {
    const chronological = [...this.events()].sort((a, b) => a.minute - b.minute);
    try {
      const pdf = await this.createMatchReportPdf(chronological);
      const file = new File([pdf], `Report-partita-${this.teamName().replace(/[^a-z0-9-_]/gi, '-')}.pdf`, { type: 'application/pdf' });
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function'
        && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })) {
        await navigator.share({ title: `Report partita · ${this.teamName()}`, files: [file] });
        this.voiceMessage.set('PDF del resoconto condiviso.');
      } else {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.name;
        anchor.click();
        URL.revokeObjectURL(url);
        this.voiceMessage.set('PDF del resoconto pronto e scaricato. Puoi allegarlo alla chat che preferisci.');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      console.error('Unable to create or share match report PDF.', error);
      this.voiceMessage.set('Non è stato possibile creare o condividere il PDF del resoconto.');
    }
  }

  private async createMatchReportPdf(events: MatchEvent[]): Promise<Blob> {
    const width = 1240, height = 1754;
    const pages = Math.max(1, Math.ceil(events.length / 14));
    const images: Uint8Array[] = [];
    const encoder = new TextEncoder();
    const toBytes = (value: string) => encoder.encode(value);
    const wrap = (ctx: CanvasRenderingContext2D, value: string, maxWidth: number): string[] => {
      const words = value.split(/\s+/);
      const lines: string[] = [];
      let line = '';
      for (const word of words) {
        const candidate = line ? line + ' ' + word : word;
        if (line && ctx.measureText(candidate).width > maxWidth) { lines.push(line); line = word; }
        else line = candidate;
      }
      if (line) lines.push(line);
      return lines.length ? lines : [''];
    };

    for (let page = 0; page < pages; page++) {
      const canvas = document.createElement('canvas');
      canvas.width = width; canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas non disponibile');
      ctx.fillStyle = '#f3f6f3'; ctx.fillRect(0, 0, width, height);
      const header = ctx.createLinearGradient(0, 0, width, 460);
      header.addColorStop(0, '#102d20'); header.addColorStop(1, '#245b3a');
      ctx.fillStyle = header; ctx.fillRect(0, 0, width, 440);
      ctx.fillStyle = '#b8edc8'; ctx.font = '800 23px Arial'; ctx.fillText('FOOTBALL SQUAD MANAGER', 78, 82);
      ctx.fillStyle = '#ffffff'; ctx.font = '800 54px Arial'; ctx.fillText(page === 0 ? 'RESOCONTO PARTITA' : 'CRONACA · CONTINUA', 78, 174);
      ctx.font = '600 30px Arial'; ctx.fillStyle = '#d7e9dc'; ctx.fillText(this.teamName(), 78, 230);
      ctx.font = '22px Arial'; ctx.fillStyle = '#b9d2c0'; ctx.fillText(new Intl.DateTimeFormat('it-IT', { dateStyle: 'long' }).format(new Date()), 78, 278);

      let listTop = 500;
      if (page === 0) {
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(68, 330, 1104, 220, 26); ctx.fill();
        ctx.fillStyle = '#163d29'; ctx.font = '800 22px Arial'; ctx.fillText('RISULTATO', 105, 385);
        ctx.fillStyle = '#153b28'; ctx.font = '800 88px Arial'; ctx.fillText(this.score, 105, 485);
        ctx.fillStyle = '#738579'; ctx.font = '700 20px Arial'; ctx.fillText('GOL SEGNATI', 360, 428);
        ctx.fillStyle = '#183e2b'; ctx.font = '800 38px Arial'; ctx.fillText(this.score, 360, 480);
        ctx.fillStyle = '#738579'; ctx.font = '700 20px Arial'; ctx.fillText('DURATA', 690, 428);
        ctx.fillStyle = '#183e2b'; ctx.font = '800 38px Arial'; ctx.fillText(this.clock, 690, 480);
        listTop = 620;
      }
      ctx.fillStyle = '#183e2b'; ctx.font = '800 27px Arial'; ctx.fillText(page === 0 ? 'CRONACA DELLA PARTITA' : 'EVENTI', 78, listTop);
      const chunk = events.slice(page * 14, page * 14 + 14);
      if (!chunk.length) {
        ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.roundRect(68, listTop + 28, 1104, 94, 18); ctx.fill();
        ctx.fillStyle = '#64766a'; ctx.font = '26px Arial'; ctx.fillText('Nessun evento registrato durante la partita.', 100, listTop + 86);
      }
      chunk.forEach((event, index) => {
        const y = listTop + 28 + index * 75;
        ctx.fillStyle = index % 2 === 0 ? '#ffffff' : '#e8eee9';
        ctx.beginPath(); ctx.roundRect(68, y, 1104, 62, 14); ctx.fill();
        ctx.fillStyle = '#287447'; ctx.font = '800 23px Arial'; ctx.fillText(`${event.minute}′`, 98, y + 39);
        ctx.fillStyle = '#24382b'; ctx.font = '600 21px Arial';
        const lines = wrap(ctx, event.description, 930);
        ctx.fillText(lines[0].slice(0, 105), 190, y + (lines.length > 1 ? 27 : 39));
        if (lines.length > 1) { ctx.font = '18px Arial'; ctx.fillStyle = '#607267'; ctx.fillText(lines[1].slice(0, 110), 190, y + 49); }
      });
      ctx.fillStyle = '#839187'; ctx.font = '18px Arial';
      ctx.fillText('Football Squad Manager · Report generato dall’app', 78, 1688);
      ctx.textAlign = 'right'; ctx.fillText(`Pagina ${page + 1} / ${pages}`, 1160, 1688); ctx.textAlign = 'left';
      const jpeg = await new Promise<Blob>((resolve, reject) => canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Esportazione pagina non riuscita')), 'image/jpeg', .92));
      images.push(new Uint8Array(await jpeg.arrayBuffer()));
    }

    const parts: Uint8Array[] = [toBytes('%PDF-1.4\n')];
    const offsets: number[] = [0];
    let offset = parts[0].length;
    const addObject = (id: number, body: Uint8Array[]) => {
      offsets[id] = offset;
      const begin = toBytes(`${id} 0 obj\n`);
      const finish = toBytes('\nendobj\n');
      for (const part of [begin, ...body, finish]) { parts.push(part); offset += part.length; }
    };
    addObject(1, [toBytes('<< /Type /Catalog /Pages 2 0 R >>')]);
    const kids = images.map((_, i) => `${3 + i * 3} 0 R`).join(' ');
    addObject(2, [toBytes(`<< /Type /Pages /Kids [${kids}] /Count ${images.length} >>`)]);
    images.forEach((jpeg, i) => {
      const pageId = 3 + i * 3, imageId = pageId + 1, contentId = pageId + 2;
      addObject(pageId, [toBytes(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)]);
      addObject(imageId, [toBytes(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, toBytes('\nendstream')]);
      const stream = toBytes('q 595 0 0 842 0 0 cm /Im0 Do Q');
      addObject(contentId, [toBytes(`<< /Length ${stream.length} >>\nstream\n`), stream, toBytes('\nendstream')]);
    });
    const xrefOffset = offset;
    let xref = `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
    for (let id = 1; id < offsets.length; id++) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
    xref += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
    parts.push(toBytes(xref)); offset += parts[parts.length - 1].length;
    const total = parts.reduce((sum, part) => sum + part.length, 0);
    const output = new Uint8Array(total);
    let cursor = 0; for (const part of parts) { output.set(part, cursor); cursor += part.length; }
    return new Blob([output.buffer as ArrayBuffer], { type: 'application/pdf' });
  }

  protected updateEditMinute(value: string): void { this.editMinute.set(value); }
  protected updateEditPlayer(value: string): void { this.editPlayerId.set(value); }
  protected updateEditAssist(value: string): void { this.editAssistPlayerId.set(value); }
  protected updateEditOutgoing(value: string): void { this.editOutgoingId.set(value); }
  protected updateEditIncoming(value: string): void { this.editIncomingId.set(value); }
  protected updateEditDescription(value: string): void { this.editDescription.set(value); }
  protected chronologicalEvents(): MatchEvent[] { return [...this.events()].sort((a, b) => a.minute - b.minute); }
  protected async close(): Promise<void> {
    if(this.exitingMatch) return;
    this.settleRunningClock();
    if(this.timer){clearInterval(this.timer);this.timer=null;}
    this.running.set(false);
    this.voice.cancel();
    this.voiceListening.set(false);
    this.exitingMatch = true;
    try {
      await this.persistQueue;
      await this.teamService.clearLiveMatch(this.workspaceId(), this.teamId(), this.seasonId());
    } catch(error) {
      this.exitingMatch = false;
      console.error('Unable to reset live match on exit.', error);
      this.voiceMessage.set('Non è stato possibile azzerare la partita. Riprova a uscire.');
      return;
    }
    this.closematch.emit();
  }
  protected beginVoiceHold(event: PointerEvent): void {
    if (this.finished() || this.voiceListening()) return;
    event.preventDefault();
    this.voicePointerId = event.pointerId;
    try { (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId); } catch { /* Pointer capture is not available in every embedded browser. */ }
    this.startVoiceCapture();
  }

  protected endVoiceHold(event: PointerEvent): void {
    if (this.voicePointerId !== event.pointerId) return;
    this.voicePointerId = null;
    event.preventDefault();
    this.finishVoiceCapture();
  }

  protected cancelVoiceHold(): void {
    if (this.voicePointerId === null) return;
    this.voicePointerId = null;
    this.voice.cancel();
    this.voiceListening.set(false);
    this.voiceMessage.set('Ascolto annullato.');
  }

  protected beginVoiceKeyboard(event: KeyboardEvent): void {
    if ((event.code !== 'Space' && event.code !== 'Enter') || event.repeat) return;
    event.preventDefault();
    if (!this.voiceListening()) this.startVoiceCapture();
  }

  protected endVoiceKeyboard(event: KeyboardEvent): void {
    if (event.code !== 'Space' && event.code !== 'Enter') return;
    event.preventDefault();
    if (this.voiceListening()) this.finishVoiceCapture();
  }

  private startVoiceCapture(): void {
    this.voiceStartFailed = false;
    this.voiceDraft.set('');
    this.voiceMessage.set('Ti ascolto. Rilascia il pulsante per eseguire il comando.');
    this.voiceListening.set(true);
    this.voice.start(
      transcript => { if (this.voiceListening()) this.voiceDraft.set(transcript); },
      message => {
        this.voiceStartFailed = true;
        this.voiceListening.set(false);
        this.voiceMessage.set(message);
      },
      transcript => {
        this.voiceListening.set(false);
        this.voicePointerId = null;
        if (this.voiceStartFailed) return;
        this.executeVoiceCommand(transcript || this.voiceDraft());
      }
    );
  }

  private finishVoiceCapture(): void {
    if (!this.voiceListening()) return;
    this.voiceMessage.set('Elaboro il comando…');
    this.voice.stop();
  }

  private executeVoiceCommand(raw: string): void {
    const transcript = raw.trim();
    if (!transcript) {
      this.voiceMessage.set('Non ho riconosciuto parole. Tieni premuto e riprova parlando chiaramente.');
      return;
    }
    this.voiceDraft.set(transcript);
    this.parseCommand(transcript);
    if (this.pending()) this.confirmAction();
  }
  private readVoiceHelpPreference(): boolean {
    try { return typeof window !== 'undefined' && window.localStorage.getItem(this.voiceHelpStorageKey) === 'open'; }
    catch { return false; }
  }
  protected toggleVoiceHelp(): void {
    const next = !this.voiceHelpOpen();
    this.voiceHelpOpen.set(next);
    try { window.localStorage.setItem(this.voiceHelpStorageKey, next ? 'open' : 'closed'); }
    catch { /* Keep the control usable when browser storage is unavailable. */ }
  }
  private normalizeVoiceCommand(raw: string): string {
    const normalized = raw.toLocaleLowerCase('it-IT')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const smallNumbers: Record<string, string> = {
      zero: '0', uno: '1', due: '2', tre: '3', quattro: '4',
      cinque: '5', sei: '6', sette: '7', otto: '8', nove: '9', dieci: '10',
      undici: '11', dodici: '12', tredici: '13', quattordici: '14', quindici: '15',
      sedici: '16', diciassette: '17', diciotto: '18', diciannove: '19', venti: '20'
    };
    const tens: Record<string, number> = {
      venti: 20, trenta: 30, quaranta: 40, cinquanta: 50, sessanta: 60,
      settanta: 70, ottanta: 80, novanta: 90
    };
    const units: Record<string, number> = {
      uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5,
      sei: 6, sette: 7, otto: 8, nove: 9
    };
    return normalized.split(' ').map(token => {
      if (smallNumbers[token]) return smallNumbers[token];
      for (const [prefix, value] of Object.entries(tens)) {
        if (token.startsWith(prefix) && token.length > prefix.length) {
          const suffix = token.slice(prefix.length);
          if (units[suffix]) return String(value + units[suffix]);
        }
      }
      return token;
    }).join(' ');
  }

  private rejectVoiceCommand(message: string): void {
    this.voice.cancel();
    this.voiceListening.set(false);
    this.pending.set(null);
    this.voiceMessage.set(message);
  }

  private parseCommand(raw: string): void {
    this.voiceDraft.set(raw);
    const text = this.normalizeVoiceCommand(raw);
    if (this.finished()) {
      this.rejectVoiceCommand('La partita è terminata: non puoi aggiungere o modificare eventi.');
      return;
    }
    const undoMatch = text.match(/annulla\s+(?:(?:il|la|lo)\s+)?(goal|gol|ammonizione|giallo|espulsione|rosso)\s+(?:del\s+)?(?:numero\s*)?(\d{1,2})/);
    if (undoMatch) { this.undoMatchEvent(undoMatch[1], Number(undoMatch[2])); return; }
    const numbers = [...text.matchAll(/\b(?:numero\s*)?(\d{1,2})\b/g)].map(match => Number(match[1]));
    const byNumber = (number: number) => this.players().filter(player => player.shirtNumber === number);
    const findUnique = (number: number) => {
      const matches = byNumber(number);
      return matches.length === 1 ? matches[0] : undefined;
    };
    const onField = (id: string) => Object.values(this.lineup()).includes(id);
    const assistMatch = text.match(/assist(?:ito)?\s+(?:di\s+)?(?:numero\s*)?(\d{1,2})/);
    const assistNumber = assistMatch ? Number(assistMatch[1]) : undefined;

    if (/\b(goal|gol|ha segnato|segnato|rete)\b/.test(text)) {
      const scorerNumber = numbers.find(number => number !== assistNumber);
      if (scorerNumber === undefined) {
        this.rejectVoiceCommand('Per registrare un gol devi indicare il numero di maglia del marcatore.');
        return;
      }
      const scorerMatches = byNumber(scorerNumber), scorer = findUnique(scorerNumber);
      if (!scorerMatches.length) { this.rejectVoiceCommand('Il numero ' + scorerNumber + ' non è presente nella rosa.'); return; }
      if (!scorer) { this.rejectVoiceCommand('Ci sono più giocatori con la maglia ' + scorerNumber + ': assegna numeri distinti prima di usare il comando.'); return; }
      const assister = assistNumber === undefined ? undefined : findUnique(assistNumber);
      if (assistNumber !== undefined && !byNumber(assistNumber).length) { this.rejectVoiceCommand('Il numero ' + assistNumber + ' indicato per l’assist non è presente nella rosa.'); return; }
      if (assistNumber !== undefined && !assister) { this.rejectVoiceCommand('Il numero ' + assistNumber + ' per l’assist non identifica un solo giocatore.'); return; }
      if (!onField(scorer.id)) { this.rejectVoiceCommand('#' + scorerNumber + ' è in rosa ma non è attualmente in campo: non può essere registrato come marcatore.'); return; }
      if (assister && !onField(assister.id)) { this.rejectVoiceCommand('#' + assistNumber + ' è in rosa ma non è attualmente in campo: non può essere registrato come autore dell’assist.'); return; }
      if (assister && scorer.id === assister.id) { this.rejectVoiceCommand('Il marcatore e l’autore dell’assist devono essere due giocatori diversi.'); return; }
      const description = 'Gol di #' + scorer.shirtNumber + ' ' + scorer.firstName + ' ' + scorer.lastName + (assister ? ' · assist di #' + assister.shirtNumber + ' ' + assister.lastName : '');
      this.pending.set({ type: 'goal', playerId: scorer.id, assistPlayerId: assister?.id, description });
    } else if (/\b(ammon|ammonito|ammonizione|cartellino giallo|giallo)\b/.test(text)) {
      if (!numbers.length) { this.rejectVoiceCommand('Dimmi il numero di maglia da ammonire, per esempio: ammonito numero 5.'); return; }
      const player = findUnique(numbers[0]);
      if (!byNumber(numbers[0]).length) { this.rejectVoiceCommand('Il numero ' + numbers[0] + ' non è presente nella rosa.'); return; }
      if (!player) { this.rejectVoiceCommand('Il numero ' + numbers[0] + ' non identifica un solo giocatore.'); return; }
      if (this.redCards().includes(player.id)) { this.rejectVoiceCommand(player.firstName + ' ' + player.lastName + ' è già stato espulso.'); return; }
      const next = (this.yellowCards()[player.id] ?? 0) + 1;
      this.pending.set({
        type: 'yellow-card',
        playerId: player.id,
        description: next >= 2
          ? 'Seconda ammonizione: #' + player.shirtNumber + ' ' + player.firstName + ' ' + player.lastName + ' · espulsione automatica'
          : 'Ammonizione a #' + player.shirtNumber + ' ' + player.firstName + ' ' + player.lastName + ' (prima ammonizione)'
      });
    } else if (/\b(espuls|espulso|espell|cartellino rosso|rosso)\b/.test(text)) {
      if (!numbers.length) { this.rejectVoiceCommand('Indica il numero di maglia del giocatore da espellere.'); return; }
      const player = findUnique(numbers[0]);
      if (!byNumber(numbers[0]).length) { this.rejectVoiceCommand('Il numero ' + numbers[0] + ' non è presente nella rosa.'); return; }
      if (!player) { this.rejectVoiceCommand('Il numero ' + numbers[0] + ' non identifica un solo giocatore.'); return; }
      if (this.redCards().includes(player.id)) { this.rejectVoiceCommand(player.firstName + ' ' + player.lastName + ' è già stato espulso.'); return; }
      this.pending.set({ type: 'red-card', playerId: player.id, description: 'Espulsione di #' + player.shirtNumber + ' ' + player.firstName + ' ' + player.lastName });
    } else if (/\b(cambio|cambiare|sostituz|sostituisc|esce|entra)\b/.test(text)) {
      if (numbers.length < 2) {
        this.rejectVoiceCommand('Indica chi esce e chi entra: «cambio del numero 7 con il numero 9».');
        return;
      }
      const [outNumber, inNumber] = numbers;
      const outMatches = byNumber(outNumber), inMatches = byNumber(inNumber);
      const outgoing = findUnique(outNumber), incoming = findUnique(inNumber);
      if (!outMatches.length) { this.rejectVoiceCommand('Il numero ' + outNumber + ' che deve uscire non è presente nella rosa.'); return; }
      if (!inMatches.length) { this.rejectVoiceCommand('Il numero ' + inNumber + ' che deve entrare non è presente nella rosa.'); return; }
      if (!outgoing || !incoming) { this.rejectVoiceCommand('Uno dei numeri indicati è assegnato a più giocatori.'); return; }
      if (outgoing.id === incoming.id) { this.rejectVoiceCommand('Non puoi sostituire un giocatore con sé stesso.'); return; }
      if (!onField(outgoing.id)) { this.rejectVoiceCommand('#' + outNumber + ' non è in campo e quindi non può uscire.'); return; }
      if (onField(incoming.id)) { this.rejectVoiceCommand('#' + inNumber + ' è già in campo e non può entrare dalla panchina.'); return; }
      if (this.redCards().includes(incoming.id)) { this.rejectVoiceCommand('#' + inNumber + ' è stato espulso e non può entrare.'); return; }
      if (this.redCards().includes(outgoing.id)) { this.rejectVoiceCommand('#' + outNumber + ' è già stato espulso e non può essere sostituito.'); return; }
      if (this.changesUsed() >= this.maxChanges) { this.rejectVoiceCommand('Hai esaurito i 5 cambi disponibili.'); return; }
      this.pending.set({
        type: 'substitution',
        outgoingId: outgoing.id,
        incomingId: incoming.id,
        description: 'Cambio: esce #' + outgoing.shirtNumber + ' ' + outgoing.lastName + ', entra #' + incoming.shirtNumber + ' ' + incoming.lastName
      });
    } else {
      this.rejectVoiceCommand('Comando non riconosciuto. Puoi segnalare gol, ammonizioni, espulsioni e cambi.');
      return;
    }
    this.voiceMessage.set('Comando riconosciuto. Eseguo…');
  }

  protected dismissVoiceFeedback(): void {
    this.voice.cancel();
    this.voiceListening.set(false);
    this.voiceMessage.set('');
    this.voiceDraft.set('');
  }

  private undoMatchEvent(kind: string, shirtNumber: number): void {
    const player=this.players().find(p=>p.shirtNumber===shirtNumber);
    if(!player){this.voiceMessage.set('Non trovo il giocatore numero '+shirtNumber+'.');return;}
    const type=/goal|gol/.test(kind)?'goal':/ammonizione|giallo/.test(kind)?'yellow-card':'red-card';
    const current=this.events(); const index=current.findIndex(event=>event.type===type&&event.playerId===player.id);
    if(index<0){this.voiceMessage.set('Non trovo un evento da annullare per il numero '+shirtNumber+'.');return;}
    const target=current[index]; let next=current.filter((_,i)=>i!==index);
    if(type==='yellow-card'&&/seconda ammonizione/i.test(target.description)) next=next.filter(event=>!(event.type==='red-card'&&event.playerId===player.id&&event.minute===target.minute));
    if(type==='red-card'&&/seconda ammonizione/i.test(target.description)) next=next.filter(event=>!(event.type==='yellow-card'&&event.playerId===player.id&&event.minute===target.minute&&/seconda ammonizione/i.test(event.description)));
    this.events.set(next);
    const goals:Record<string,number>={}, assists:Record<string,number>={}, yellows:Record<string,number>={}, reds:string[]=[];
    for(const event of next){
      if(event.type==='goal'&&event.playerId){goals[event.playerId]=(goals[event.playerId]??0)+1;const assistId=event.assistPlayerId??this.players().find(p=>p.shirtNumber===Number(event.description.match(/assist di #?(\d+)/i)?.[1]))?.id;if(assistId)assists[assistId]=(assists[assistId]??0)+1;}
      if(event.type==='yellow-card'&&event.playerId)yellows[event.playerId]=(yellows[event.playerId]??0)+1;
      if(event.type==='red-card'&&event.playerId&&!reds.includes(event.playerId))reds.push(event.playerId);
    }
    this.goals.set(goals);this.assists.set(assists);this.yellowCards.set(yellows);this.redCards.set(reds);
    const workspaceId=this.auth.workspaceId();
    if(type==='goal'&&workspaceId&&target.playerId)void this.playerService.removeGoal(workspaceId,target.playerId).catch(error=>{console.error('Unable to reverse player goal.',error);this.voiceMessage.set('Gol annullato nella partita, ma non nel totale giocatore.');});
    const targetAssistId=target.assistPlayerId??this.players().find(p=>p.shirtNumber===Number(target.description.match(/assist di #?(\d+)/i)?.[1]))?.id;
    if(type==='goal'&&workspaceId&&targetAssistId)void this.playerService.removeAssist(workspaceId,targetAssistId).catch(error=>{console.error('Unable to reverse player assist.',error);this.voiceMessage.set('Gol annullato, ma non è stato possibile aggiornare gli assist.');});
    this.voiceMessage.set((type==='goal'?'Gol':type==='yellow-card'?'Ammonizione':'Espulsione')+' del numero '+shirtNumber+' annullata.'); void this.persistMatchState();
  }
  protected confirmAction(): void {
    const action=this.pending();if(!action)return;
    this.voice.cancel(); this.voiceListening.set(false);
    const minute=this.minute;
    if(action.type==='goal'&&action.playerId){
      const scorer=this.player(action.playerId); this.showMatchAnimation({type:'goal',title:'GOOOL!',detail:scorer?`#${scorer.shirtNumber} ${scorer.lastName}`:'Rete della squadra'});
      this.goals.update(g=>({...g,[action.playerId!]: (g[action.playerId!]??0)+1}));
      if(action.assistPlayerId)this.assists.update(v=>({...v,[action.assistPlayerId!]: (v[action.assistPlayerId!]??0)+1}));
      this.events.update(e=>[{type:'goal',minute,description:action.description,playerId:action.playerId,assistPlayerId:action.assistPlayerId},...e]);
      const workspaceId=this.auth.workspaceId();
      if(workspaceId)void this.playerService.recordGoal(workspaceId,action.playerId).catch(error=>{console.error('Unable to save player goal.',error);this.voiceMessage.set('Gol registrato nella partita, ma non è stato possibile aggiornare il totale del giocatore.');});
      if(workspaceId&&action.assistPlayerId)void this.playerService.recordAssist(workspaceId,action.assistPlayerId).catch(error=>{console.error('Unable to save player assist.',error);this.voiceMessage.set('Gol registrato, ma non è stato possibile aggiornare il totale degli assist.');});
    }
    if(action.type==='yellow-card'&&action.playerId){
      const booked=this.player(action.playerId); const count=(this.yellowCards()[action.playerId]??0)+1;
      this.yellowCards.update(cards=>({...cards,[action.playerId!]:count}));
      this.showMatchAnimation({type:count>=2?'red-card':'yellow-card',title:count>=2?'SECONDO GIALLO · ROSSO':'AMMONIZIONE',detail:booked?`#${booked.shirtNumber} ${booked.lastName}`:'Cartellino'});
      if(count>=2){
        this.redCards.update(ids=>ids.includes(action.playerId!)?ids:[...ids,action.playerId!]);
        this.events.update(e=>[{type:'red-card',minute,description:action.description,playerId:action.playerId},{type:'yellow-card',minute,description:`Seconda ammonizione per #${this.player(action.playerId)?.shirtNumber} ${this.player(action.playerId)?.lastName}`,playerId:action.playerId},...e]);
      } else this.events.update(e=>[{type:'yellow-card',minute,description:action.description,playerId:action.playerId},...e]);
    }
    if(action.type==='red-card'&&action.playerId){const sentOff=this.player(action.playerId);this.showMatchAnimation({type:'red-card',title:'ESPULSO!',detail:sentOff?`#${sentOff.shirtNumber} ${sentOff.lastName}`:'Cartellino rosso'});this.redCards.update(ids=>ids.includes(action.playerId!)?ids:[...ids,action.playerId!]);this.events.update(e=>[{type:'red-card',minute,description:action.description,playerId:action.playerId},...e]);}
    if(action.type==='substitution'&&action.outgoingId&&action.incomingId){
      if(this.redCards().includes(action.outgoingId)){this.voiceMessage.set('Un giocatore espulso non può essere sostituito. La squadra continua in inferiorità numerica.');this.pending.set(null);return;}
      const slot=Object.entries(this.lineup()).find(([,id])=>id===action.outgoingId)?.[0];
      if(slot&&this.changesUsed()<this.maxChanges){const outgoing=this.player(action.outgoingId), incoming=this.player(action.incomingId);this.showMatchAnimation({type:'substitution',title:'SOSTITUZIONE',detail:`${outgoing?.lastName ?? 'Esce'}  →  ${incoming?.lastName ?? 'Entra'}`,outgoingNumber:outgoing?.shirtNumber,incomingNumber:incoming?.shirtNumber});const pos=this.matchPositions()[action.outgoingId];this.lineup.update(l=>({...l,[slot]:action.incomingId!}));if(pos)this.matchPositions.update(p=>({...p,[action.incomingId!]:pos}));this.formationPlayerOrder=this.formationPlayerOrder.map(id=>id===action.outgoingId?action.incomingId!:id);this.changesUsed.update(v=>v+1);this.events.update(e=>[{type:'substitution',minute,description:action.description,outgoingId:action.outgoingId,incomingId:action.incomingId},...e]);}
      else {this.voiceMessage.set(this.changesUsed()>=this.maxChanges?'Hai esaurito i cambi disponibili.':'Il giocatore da sostituire non è in campo.');this.pending.set(null);return;}
    }
    this.pending.set(null);
    this.voiceMessage.set(action.type === 'goal' ? 'Gol registrato.' : action.type === 'yellow-card' ? 'Ammonizione registrata.' : action.type === 'red-card' ? 'Espulsione registrata.' : 'Sostituzione eseguita.');
    void this.persistMatchState();
  }
  protected cancelAction(): void { this.voice.cancel(); this.voiceListening.set(false); this.pending.set(null); this.voiceDraft.set(''); this.voiceMessage.set('Evento annullato.'); }
  protected chooseOutgoing(player:PlayerRecord): void { if(this.playerHasRedCard(player)){this.voiceMessage.set('Un giocatore espulso non può essere sostituito. La squadra continua in inferiorità numerica.');return;} this.selectedOutgoingId.set(player.id);this.voiceMessage.set(`Selezionato ${player.lastName}. Ora scegli chi entra dalla panchina.`); }
  protected chooseIncoming(player:PlayerRecord): void {
    const outgoing=this.selectedOutgoingId();if(!outgoing)return;
    const action:PendingAction={type:'substitution',outgoingId:outgoing,incomingId:player.id,description:`Cambio: esce #${this.player(outgoing)?.shirtNumber} ${this.player(outgoing)?.lastName}, entra #${player.shirtNumber} ${player.lastName}`};
    this.pending.set(action);this.selectedOutgoingId.set(null);this.voiceMessage.set('Conferma il cambio.');
  }
  protected goalsFor(player:PlayerRecord):number{return this.goals()[player.id]??0;}
  protected assistsFor(player:PlayerRecord):number{return this.assists()[player.id]??0;}
  protected yellowCardsFor(player:PlayerRecord):number{return this.yellowCards()[player.id]??0;}
  protected playerHasRedCard(player:PlayerRecord):boolean{return this.redCards().includes(player.id);}
}
