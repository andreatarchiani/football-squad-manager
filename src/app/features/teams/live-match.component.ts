import { ChangeDetectionStrategy, Component, inject, input, OnDestroy, signal } from '@angular/core';
import type { PlayerRecord } from '../players/player.service';
import { VoiceRecognitionService } from '../../core/voice/voice-recognition.service';

type MatchEventType = 'goal' | 'red-card' | 'substitution';
interface MatchEvent { type: MatchEventType; minute: number; description: string; playerId?: string; outgoingId?: string; incomingId?: string; }
interface PendingAction { type: MatchEventType; playerId?: string; outgoingId?: string; incomingId?: string; description: string; }

@Component({
  selector: 'fsm-live-match',
  standalone: true,
  templateUrl: './live-match.component.html',
  styleUrl: './live-match.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class LiveMatchComponent implements OnDestroy {
  readonly teamName = input.required<string>();
  readonly players = input.required<PlayerRecord[]>();
  readonly initialLineup = input.required<Record<string, string>>();
  readonly formation = input.required<string>();
  private readonly voice = inject(VoiceRecognitionService);
  protected readonly elapsedSeconds = signal(0);
  protected readonly running = signal(false);
  protected readonly finished = signal(false);
  protected readonly benchOpen = signal(false);
  protected readonly selectedOutgoingId = signal<string | null>(null);
  protected readonly pending = signal<PendingAction | null>(null);
  protected readonly events = signal<MatchEvent[]>([]);
  protected readonly goals = signal<Record<string, number>>({});
  protected readonly redCards = signal<string[]>([]);
  protected readonly lineup = signal<Record<string, string>>({});
  protected readonly voiceListening = signal(false);
  protected readonly voiceMessage = signal('');
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

  constructor() { this.lineup.set({...this.initialLineup()}); }
  ngOnDestroy(): void { this.pause(); this.voice.stop(); }

  protected slots() { return this.formations[this.formation()] ?? this.formations['4-3-3']; }
  protected player(id: string | undefined): PlayerRecord | undefined { return this.players().find(p => p.id === id); }
  protected playerInSlot(slotId: string): PlayerRecord | undefined { return this.player(this.lineup()[slotId]); }
  protected onField(): PlayerRecord[] { return Object.values(this.lineup()).filter(Boolean).map(id => this.player(id)).filter((p): p is PlayerRecord => !!p && !this.redCards().includes(p.id)); }
  protected bench(): PlayerRecord[] { const ids=new Set(Object.values(this.lineup())); return this.players().filter(p=>!ids.has(p.id)&&!this.redCards().includes(p.id)); }
  protected get minute(): number { return Math.min(90, Math.floor(this.elapsedSeconds()/60)); }
  protected get clock(): string { const m=Math.floor(this.elapsedSeconds()/60),s=this.elapsedSeconds()%60; return `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`; }
  protected get score(): string { return String(Object.values(this.goals()).reduce((a,b)=>a+b,0)); }
  protected start(): void { if(this.finished()||this.running()) return; this.running.set(true); this.timer=setInterval(()=>{this.elapsedSeconds.update(v=>Math.min(5400,v+1));if(this.elapsedSeconds()>=5400){this.pause();this.finished.set(true);}},1000); }
  protected pause(): void { if(this.timer){clearInterval(this.timer);this.timer=null;} this.running.set(false); }
  protected close(): void { this.pause(); this.voice.stop(); this.voiceListening.set(false); this.dispatchEvent(new CustomEvent('closematch',{bubbles:true})); }
  protected startVoice(): void {
    if(this.voiceListening()) { this.voice.stop(); this.voiceListening.set(false); return; }
    this.voiceMessage.set('Ti ascolto…');
    this.voiceListening.set(true);
    this.voice.start(text=>this.parseCommand(text),message=>this.voiceMessage.set(message),()=>this.voiceListening.set(false));
  }
  private parseCommand(raw: string): void {
    const text=raw.toLocaleLowerCase('it-IT');
    const numbers=[...text.matchAll(/\b(?:numero\s*)?(\d{1,2})\b/g)].map(m=>Number(m[1]));
    const byNumber=(n:number)=>this.players().find(p=>p.shirtNumber===n);
    if(/gol|ha segnato|rete/.test(text)){
      const p=numbers.length?byNumber(numbers[0]):undefined;
      if(!p){this.voiceMessage.set('Non ho identificato il numero di maglia. Riprova.');return;}
      this.pending.set({type:'goal',playerId:p.id,description:`Gol di #${p.shirtNumber} ${p.firstName} ${p.lastName}`});
    } else if(/espuls|rosso|cartellino rosso/.test(text)){
      const p=numbers.length?byNumber(numbers[0]):undefined;
      if(!p){this.voiceMessage.set('Non ho identificato il giocatore da espellere.');return;}
      this.pending.set({type:'red-card',playerId:p.id,description:`Espulsione di #${p.shirtNumber} ${p.firstName} ${p.lastName}`});
    } else if(/cambio|sostituz/.test(text)){
      const outgoing=numbers.length>0?byNumber(numbers[0]):undefined;
      const incoming=numbers.length>1?byNumber(numbers[1]):undefined;
      if(!outgoing||!incoming){this.voiceMessage.set('Dimmi: cambio numero 7 con numero 9.');return;}
      this.pending.set({type:'substitution',outgoingId:outgoing.id,incomingId:incoming.id,description:`Cambio: esce #${outgoing.shirtNumber} ${outgoing.lastName}, entra #${incoming.shirtNumber} ${incoming.lastName}`});
    } else { this.voiceMessage.set('Comando non riconosciuto. Per ora puoi segnalare gol, espulsioni e cambi.');return; }
    this.voiceMessage.set('Controlla l’evento e conferma per registrarlo.');
  }
  protected confirmAction(): void {
    const action=this.pending();if(!action)return;
    const minute=this.minute;
    if(action.type==='goal'&&action.playerId){this.goals.update(g=>({...g,[action.playerId!]: (g[action.playerId!]??0)+1}));this.events.update(e=>[{type:'goal',minute,description:action.description,playerId:action.playerId},...e]);}
    if(action.type==='red-card'&&action.playerId){this.redCards.update(ids=>[...ids,action.playerId!]);this.lineup.update(l=>Object.fromEntries(Object.entries(l).filter(([,id])=>id!==action.playerId)));this.events.update(e=>[{type:'red-card',minute,description:action.description,playerId:action.playerId},...e]);}
    if(action.type==='substitution'&&action.outgoingId&&action.incomingId){
      const slot=Object.entries(this.lineup()).find(([,id])=>id===action.outgoingId)?.[0];
      if(slot&&this.changesUsed()<this.maxChanges){this.lineup.update(l=>({...l,[slot]:action.incomingId!}));this.changesUsed.update(v=>v+1);this.events.update(e=>[{type:'substitution',minute,description:action.description,outgoingId:action.outgoingId,incomingId:action.incomingId},...e]);}
      else {this.voiceMessage.set(this.changesUsed()>=this.maxChanges?'Hai esaurito i cambi disponibili.':'Il giocatore da sostituire non è in campo.');this.pending.set(null);return;}
    }
    this.pending.set(null);this.voiceMessage.set('Evento registrato.');
  }
  protected cancelAction(): void { this.pending.set(null); this.voiceMessage.set('Evento annullato.'); }
  protected chooseOutgoing(player:PlayerRecord): void { this.selectedOutgoingId.set(player.id);this.voiceMessage.set(`Selezionato ${player.lastName}. Ora scegli chi entra dalla panchina.`); }
  protected chooseIncoming(player:PlayerRecord): void {
    const outgoing=this.selectedOutgoingId();if(!outgoing)return;
    const action:PendingAction={type:'substitution',outgoingId:outgoing,incomingId:player.id,description:`Cambio: esce #${this.player(outgoing)?.shirtNumber} ${this.player(outgoing)?.lastName}, entra #${player.shirtNumber} ${player.lastName}`};
    this.pending.set(action);this.selectedOutgoingId.set(null);this.voiceMessage.set('Conferma il cambio.');
  }
  protected goalsFor(player:PlayerRecord):number{return this.goals()[player.id]??0;}
  protected playerHasRedCard(player:PlayerRecord):boolean{return this.redCards().includes(player.id);}
}
