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
  readonly closematch = output<void>();
  private readonly voice = inject(VoiceRecognitionService);
  private readonly auth = inject(FirebaseAuthService);
  private readonly playerService = inject(PlayerService);
  private readonly teamService = inject(TeamService);
  protected readonly elapsedSeconds = signal(0);
  protected readonly running = signal(false);
  protected readonly finished = signal(false);
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
  protected readonly matchPositions = signal<Record<string, { x: number; y: number }>>({});
  private draggingPlayerId: string | null = null;
  private draggingElement: HTMLElement | null = null;
  private dragStartPosition: { x: number; y: number } | null = null;
  private dragCurrentPosition: { x: number; y: number } | null = null;
  protected readonly voiceListening = signal(false);
  protected readonly voiceMessage = signal('');
  protected readonly voiceDraft = signal('');
  protected readonly voiceHelpOpen = signal(false);
  protected readonly matchAnimation = signal<MatchAnimation | null>(null);
  private animationTimer: ReturnType<typeof setTimeout> | null = null;
  protected readonly changesUsed = signal(0);
  protected readonly maxChanges = 5;
  private timer: ReturnType<typeof setInterval> | null = null;

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
    const p: Record<string, {x:number;y:number}> = {};
    for (const slot of this.formations[f]) { const id=this.initialLineup()[slot.id]; if(id) p[id]=this.initialPositions()[id] ?? {x:slot.x,y:slot.y}; }
    this.matchPositions.set(p);
    try {
      const saved = await this.teamService.loadLiveMatch(this.workspaceId(), this.teamId(), this.seasonId());
      if (saved) {
        this.elapsedSeconds.set(Math.max(0, Math.min(5400, saved.elapsedSeconds)));
        this.finished.set(saved.finished); this.events.set(saved.events); this.goals.set(saved.goals); this.assists.set(saved.assists);
        this.yellowCards.set(saved.yellowCards); this.redCards.set(saved.redCards); this.lineup.set(saved.lineup);
        this.matchFormation.set(this.formations[saved.formation] ? saved.formation : f); this.matchPositions.set(saved.positions);
        this.changesUsed.set(Math.max(0, Math.min(this.maxChanges, saved.changesUsed)));
        if (saved.running && !saved.finished) this.start();
      }
    } catch (error) { console.error('Unable to restore live match.', error); this.voiceMessage.set('Partita caricata, ma non è stato possibile recuperare gli ultimi dati salvati.'); }
  }
  ngOnDestroy(): void { if(this.timer){clearInterval(this.timer);this.timer=null;} this.voice.stop(); if(this.animationTimer) clearTimeout(this.animationTimer); void this.persistMatchState(); }
  private async persistMatchState(): Promise<void> {
    try { await this.teamService.saveLiveMatch(this.workspaceId(), this.teamId(), this.seasonId(), {
      elapsedSeconds:this.elapsedSeconds(), running:this.running(), finished:this.finished(), events:this.events(), goals:this.goals(), assists:this.assists(),
      yellowCards:this.yellowCards(), redCards:this.redCards(), lineup:this.lineup(), formation:this.matchFormation(), positions:this.matchPositions(), changesUsed:this.changesUsed()
    }); } catch(error) { console.error('Unable to save live match.', error); this.voiceMessage.set('Attenzione: non è stato possibile salvare la partita.'); }
  }
  private showMatchAnimation(animation: MatchAnimation): void { if(this.animationTimer) clearTimeout(this.animationTimer); this.matchAnimation.set(animation); this.animationTimer=setTimeout(()=>{this.matchAnimation.set(null);this.animationTimer=null;},2600); }

  protected slots() {
    const formationSlots = this.formations[this.matchFormation()] ?? this.formations['4-3-3'];
    const currentLineup = this.lineup(); const positions = this.matchPositions();
    return formationSlots.map(slot => { const playerId = currentLineup[slot.id]; const saved = playerId ? positions[playerId] : undefined; return saved ? { ...slot, x: Math.max(9, Math.min(91, saved.x)), y: Math.max(9, Math.min(91, saved.y)) } : slot; });
  }
  protected formationOptions(): string[] { return Object.keys(this.formations); }
  protected changeMatchFormation(next: string): void { if (!this.formations[next] || next === this.matchFormation()) return; const previous=this.matchFormation(); const ids=this.slots().map(slot=>this.lineup()[slot.id]).filter((id): id is string => !!id); const lineup: Record<string,string>={}; const positions: Record<string,{x:number;y:number}>={}; this.formations[next].forEach((slot,i)=>{const id=ids[i];if(id){lineup[slot.id]=id;positions[id]={x:slot.x,y:slot.y};}}); this.lineup.set(lineup);this.matchPositions.set(positions);this.matchFormation.set(next);this.selectedOutgoingId.set(null);this.events.update(items=>[{type:'formation',minute:this.minute,description:'Cambio modulo: '+previous+' → '+next},...items]);this.voiceMessage.set('Modulo cambiato in '+next+'. Evento registrato al '+this.minute+'′.'); void this.persistMatchState(); }
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
  protected onField(): PlayerRecord[] { return Object.values(this.lineup()).filter(Boolean).map(id => this.player(id)).filter((p): p is PlayerRecord => !!p); }
  protected bench(): PlayerRecord[] { const ids=new Set(Object.values(this.lineup())); return this.players().filter(p=>!ids.has(p.id)&&!this.redCards().includes(p.id)); }
  protected get minute(): number { return Math.min(90, Math.floor(this.elapsedSeconds()/60)); }
  protected get clock(): string { const m=Math.floor(this.elapsedSeconds()/60),s=this.elapsedSeconds()%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
  protected get score(): string { return String(Object.values(this.goals()).reduce((a,b)=>a+b,0)); }
  protected start(): void { if(this.finished()||this.running()) return; this.running.set(true); this.timer=setInterval(()=>{this.elapsedSeconds.update(v=>Math.min(5400,v+1));if(this.elapsedSeconds()>=5400){if(this.timer){clearInterval(this.timer);this.timer=null;}this.running.set(false);this.finished.set(true);void this.persistMatchState();} else void this.persistMatchState();},1000); void this.persistMatchState(); }
  protected pause(): void { if(this.timer){clearInterval(this.timer);this.timer=null;} this.running.set(false); void this.persistMatchState(); }
  protected close(): void { this.pause(); this.voice.stop(); this.voiceListening.set(false); this.closematch.emit(); }
  protected startVoice(): void {
    this.voiceHelpOpen.set(true);
    if(this.voiceListening()) { this.voice.stop(); this.voiceListening.set(false); return; }
    this.voiceMessage.set('Ti ascolto…');
    this.voiceListening.set(true);
    this.voice.start(text=>this.parseCommand(text),message=>this.voiceMessage.set(message),()=>this.voiceListening.set(false));
  }
  protected toggleVoiceHelp(): void { this.voiceHelpOpen.update(open => !open); }
  protected closeVoiceHelp(): void { this.voiceHelpOpen.set(false); }
  private parseCommand(raw: string): void {
    this.voiceDraft.set(raw);
    const text=raw.toLocaleLowerCase('it-IT');
    const undoMatch=text.match(/annulla\s+(goal|gol|ammonizione|giallo|espulsione|rosso)\s+(?:del\s+)?(?:numero\s*)?(\d{1,2})/);
    if(undoMatch){this.undoMatchEvent(undoMatch[1],Number(undoMatch[2]));return;}
    const numbers=[...text.matchAll(/\b(?:numero\s*)?(\d{1,2})\b/g)].map(m=>Number(m[1]));
    const byNumber=(n:number)=>this.players().find(p=>p.shirtNumber===n);
    const assistMatch=text.match(/assist(?:ito)?\s+(?:di\s+)?(?:numero\s*)?(\d{1,2})/);
    const assistNumber=assistMatch?Number(assistMatch[1]):undefined;
    if(/goal|gol|ha segnato|rete/.test(text)){
      const scorerNumber=numbers.find(n=>n!==assistNumber);
      if(scorerNumber===undefined){this.voiceMessage.set('Per registrare un gol devi indicare il numero di maglia del marcatore.');return;}
      const scorer=byNumber(scorerNumber), assister=assistNumber===undefined?undefined:byNumber(assistNumber);
      if(!scorer){this.voiceMessage.set('Non trovo il marcatore con quel numero di maglia.');return;}
      if(assistNumber!==undefined&&!assister){this.voiceMessage.set('Non trovo l’autore dell’assist con quel numero di maglia.');return;}
      if(assister&&scorer.id===assister.id){this.voiceMessage.set('Il marcatore e l’autore dell’assist devono essere due giocatori diversi.');return;}
      const description=`Gol di #${scorer.shirtNumber} ${scorer.firstName} ${scorer.lastName}${assister?` · assist di #${assister.shirtNumber} ${assister.lastName}`:''}`;
      this.pending.set({type:'goal',playerId:scorer.id,assistPlayerId:assister?.id,description});
    } else if(/ammon|cartellino giallo|giallo/.test(text)){
      const p=numbers.length?byNumber(numbers[0]):undefined;
      if(!p){this.voiceMessage.set('Dimmi il numero di maglia da ammonire, per esempio: ammonizione numero 5.');return;}
      const next=(this.yellowCards()[p.id]??0)+1;
      this.pending.set({type:'yellow-card',playerId:p.id,description:next>=2?`Seconda ammonizione: #${p.shirtNumber} ${p.firstName} ${p.lastName} · espulsione automatica`:`Ammonizione a #${p.shirtNumber} ${p.firstName} ${p.lastName} (prima ammonizione)`});
    } else if(/espuls|cartellino rosso|rosso/.test(text)){
      const p=numbers.length?byNumber(numbers[0]):undefined;
      if(!p){this.voiceMessage.set('Non ho identificato il giocatore da espellere.');return;}
      this.pending.set({type:'red-card',playerId:p.id,description:`Espulsione di #${p.shirtNumber} ${p.firstName} ${p.lastName}`});
    } else if(/cambio|sostituz/.test(text)){
      const outgoing=numbers.length>0?byNumber(numbers[0]):undefined, incoming=numbers.length>1?byNumber(numbers[1]):undefined;
      if(!outgoing||!incoming){this.voiceMessage.set('Dimmi: cambio numero 7 con numero 9.');return;}
      this.pending.set({type:'substitution',outgoingId:outgoing.id,incomingId:incoming.id,description:`Cambio: esce #${outgoing.shirtNumber} ${outgoing.lastName}, entra #${incoming.shirtNumber} ${incoming.lastName}`});
    } else { this.voiceMessage.set('Comando non riconosciuto. Puoi segnalare gol, ammonizioni, espulsioni e cambi.');return; }
    this.voiceMessage.set('Controlla l’evento e conferma per registrarlo.');
  }
  protected updateVoiceDraft(value: string): void { this.voiceDraft.set(value); }
  protected reinterpretDraft(): void {
    const corrected=this.voiceDraft().trim();
    if(!corrected){this.voiceMessage.set('Scrivi o pronuncia il comando corretto prima di continuare.');return;}
    this.pending.set(null); this.parseCommand(corrected);
    if(this.pending()) this.voiceMessage.set('Comando corretto. Controlla i dettagli e conferma.');
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
      if(event.type==='goal'&&event.playerId){goals[event.playerId]=(goals[event.playerId]??0)+1;if(event.assistPlayerId)assists[event.assistPlayerId]=(assists[event.assistPlayerId]??0)+1;}
      if(event.type==='yellow-card'&&event.playerId)yellows[event.playerId]=(yellows[event.playerId]??0)+1;
      if(event.type==='red-card'&&event.playerId&&!reds.includes(event.playerId))reds.push(event.playerId);
    }
    this.goals.set(goals);this.assists.set(assists);this.yellowCards.set(yellows);this.redCards.set(reds);
    const workspaceId=this.auth.workspaceId();
    if(type==='goal'&&workspaceId&&target.playerId)void this.playerService.removeGoal(workspaceId,target.playerId).catch(error=>{console.error('Unable to reverse player goal.',error);this.voiceMessage.set('Gol annullato nella partita, ma non nel totale giocatore.');});
    if(type==='goal'&&workspaceId&&target.assistPlayerId)void this.playerService.removeAssist(workspaceId,target.assistPlayerId).catch(error=>{console.error('Unable to reverse player assist.',error);this.voiceMessage.set('Gol annullato, ma non è stato possibile aggiornare gli assist.');});
    this.voiceMessage.set((type==='goal'?'Gol':type==='yellow-card'?'Ammonizione':'Espulsione')+' del numero '+shirtNumber+' annullata.'); void this.persistMatchState();
  }
  protected confirmAction(): void {
    const action=this.pending();if(!action)return;
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
      if(slot&&this.changesUsed()<this.maxChanges){const outgoing=this.player(action.outgoingId), incoming=this.player(action.incomingId);this.showMatchAnimation({type:'substitution',title:'SOSTITUZIONE',detail:`${outgoing?.lastName ?? 'Esce'}  →  ${incoming?.lastName ?? 'Entra'}`,outgoingNumber:outgoing?.shirtNumber,incomingNumber:incoming?.shirtNumber});const pos=this.matchPositions()[action.outgoingId];this.lineup.update(l=>({...l,[slot]:action.incomingId!}));if(pos)this.matchPositions.update(p=>({...p,[action.incomingId!]:pos}));this.changesUsed.update(v=>v+1);this.events.update(e=>[{type:'substitution',minute,description:action.description,outgoingId:action.outgoingId,incomingId:action.incomingId},...e]);}
      else {this.voiceMessage.set(this.changesUsed()>=this.maxChanges?'Hai esaurito i cambi disponibili.':'Il giocatore da sostituire non è in campo.');this.pending.set(null);return;}
    }
    this.pending.set(null);this.voiceMessage.set('Evento registrato.'); void this.persistMatchState();
  }
  protected cancelAction(): void { this.pending.set(null); this.voiceMessage.set('Evento annullato.'); }
  protected chooseOutgoing(player:PlayerRecord): void { if(this.playerHasRedCard(player)){this.voiceMessage.set('Un giocatore espulso non può essere sostituito. La squadra continua in inferiorità numerica.');return;} this.selectedOutgoingId.set(player.id);this.voiceMessage.set(`Selezionato ${player.lastName}. Ora scegli chi entra dalla panchina.`); }
  protected chooseIncoming(player:PlayerRecord): void {
    const outgoing=this.selectedOutgoingId();if(!outgoing)return;
    const action:PendingAction={type:'substitution',outgoingId:outgoing,incomingId:player.id,description:`Cambio: esce #${this.player(outgoing)?.shirtNumber} ${this.player(outgoing)?.lastName}, entra #${player.shirtNumber} ${player.lastName}`};
    this.pending.set(action);this.selectedOutgoingId.set(null);this.voiceMessage.set('Conferma il cambio.');
  }
  protected goalsFor(player:PlayerRecord):number{return this.goals()[player.id]??0;}
  protected yellowCardsFor(player:PlayerRecord):number{return this.yellowCards()[player.id]??0;}
  protected playerHasRedCard(player:PlayerRecord):boolean{return this.redCards().includes(player.id);}
}
