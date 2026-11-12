import { Injectable, inject } from '@angular/core';
import { collection, doc, getDocs, increment, runTransaction, serverTimestamp, updateDoc, type Firestore } from 'firebase/firestore';
import { FIRESTORE_DB } from '../../core/firebase.tokens';
import type { TeamRecord } from '../teams/team.service';

export const PLAYER_ROLES = ['Portiere', 'Difensore', 'Centrocampista', 'Attaccante'] as const;
export type PlayerRole = typeof PLAYER_ROLES[number];
export type PlayerStatus = 'active' | 'injured' | 'suspended' | 'left';
export interface PlayerRecord {
  id: string; firstName: string; lastName: string; dateOfBirth: string; preferredFoot: string;
  primaryRole: PlayerRole; notes: string; isArchived: boolean; teamId: string; seasonId: string;
  teamName: string; seasonLabel: string; shirtNumber: number | null; roles: PlayerRole[]; status: PlayerStatus; goals?: number;
}
export interface PlayerInput {
  firstName: string; lastName: string; dateOfBirth: string; preferredFoot: string; primaryRole: PlayerRole;
  notes: string; teamId: string; shirtNumber: string; roles: PlayerRole[]; status: PlayerStatus;
}

@Injectable({ providedIn: 'root' })
export class PlayerService {
  private readonly firestore = inject(FIRESTORE_DB, { optional: true });

  async list(workspaceId: string, teams: TeamRecord[]): Promise<PlayerRecord[]> {
    const db = this.requireFirestore();
    const snapshots = await getDocs(collection(db, 'workspaces', workspaceId, 'players'));
    const assignments = new Map<string, { teamId: string; seasonId: string; shirtNumber: number | null; roles: PlayerRole[]; status: PlayerStatus }>();
    await Promise.all(teams.filter(t => t.seasonId).map(async team => {
      const members = await getDocs(collection(db, 'workspaces', workspaceId, 'teams', team.id, 'seasons', team.seasonId!, 'squadMembers'));
      members.docs.forEach(member => {
        const d = member.data();
        assignments.set(member.id, { teamId: team.id, seasonId: team.seasonId!, shirtNumber: typeof d['shirtNumber'] === 'number' ? d['shirtNumber'] : null, roles: Array.isArray(d['roles']) ? d['roles'] as PlayerRole[] : [], status: this.status(d['status']) });
      });
    }));
    const teamMap = new Map(teams.map(t => [t.id, t]));
    return snapshots.docs.map(s => {
      const d = s.data(); const a = assignments.get(s.id); const t = a ? teamMap.get(a.teamId) : undefined;
      return { id:s.id, firstName:String(d['firstName']??''), lastName:String(d['lastName']??''), dateOfBirth:String(d['dateOfBirth']??''), preferredFoot:String(d['preferredFoot']??''), primaryRole:this.role(d['primaryRole']), notes:String(d['notes']??''), isArchived:d['isArchived']===true, teamId:a?.teamId??'', seasonId:a?.seasonId??'', teamName:t?.name??'', seasonLabel:t?.seasonLabel??'', shirtNumber:a?.shirtNumber??null, roles:a?.roles??[], status:a?.status??'active', goals: typeof d['goals']==='number' ? d['goals'] : 0 };
    }).sort((a,b)=>Number(a.isArchived)-Number(b.isArchived)||a.lastName.localeCompare(b.lastName,'it')||a.firstName.localeCompare(b.firstName,'it'));
  }

  async save(workspaceId: string, input: PlayerInput, teams: TeamRecord[], existing?: PlayerRecord): Promise<void> {
    const db = this.requireFirestore();
    const team = teams.find(t => t.id===input.teamId && t.seasonId && !t.isArchived);
    if (!team?.seasonId) throw new Error('Seleziona una squadra con una stagione attiva.');
    const shirtNumber = String(input.shirtNumber ?? '').trim();
    const number = shirtNumber ? Number(shirtNumber) : null;
    if (number === null) throw new Error('Il numero di maglia è obbligatorio.');
    if (!Number.isInteger(number)||number<1||number>99) throw new Error('Il numero di maglia deve essere compreso tra 1 e 99.');
    const playerRef = existing ? doc(db,'workspaces',workspaceId,'players',existing.id) : doc(collection(db,'workspaces',workspaceId,'players'));
    const memberRef = doc(db,'workspaces',workspaceId,'teams',team.id,'seasons',team.seasonId,'squadMembers',playerRef.id);
    const reservationRef = number===null ? null : doc(db,'workspaces',workspaceId,'teams',team.id,'seasons',team.seasonId,'jerseyReservations',String(number));
    const oldMemberRef = existing?.teamId&&existing.seasonId ? doc(db,'workspaces',workspaceId,'teams',existing.teamId,'seasons',existing.seasonId,'squadMembers',playerRef.id) : null;
    const oldReservationRef = existing?.teamId&&existing.seasonId&&existing.shirtNumber!==null ? doc(db,'workspaces',workspaceId,'teams',existing.teamId,'seasons',existing.seasonId,'jerseyReservations',String(existing.shirtNumber)) : null;

    await runTransaction(db, async tx => {
      const [targetReservation, oldReservation, oldPlayer] = await Promise.all([
        reservationRef ? tx.get(reservationRef) : Promise.resolve(null),
        oldReservationRef ? tx.get(oldReservationRef) : Promise.resolve(null),
        existing ? tx.get(playerRef) : Promise.resolve(null)
      ]);
      if (targetReservation?.exists() && targetReservation.data()['playerId']!==playerRef.id) throw new Error('Il numero di maglia è già assegnato in questa squadra.');
      const now=serverTimestamp();
      if (oldReservationRef && oldReservationRef.path!==reservationRef?.path && oldReservation?.exists() && oldReservation.data()['playerId']===playerRef.id) tx.delete(oldReservationRef);
      if (oldMemberRef && oldMemberRef.path!==memberRef.path) tx.delete(oldMemberRef);
      if (reservationRef) tx.set(reservationRef,{playerId:playerRef.id,createdAt:now,updatedAt:now});
      tx.set(memberRef,{playerId:playerRef.id,shirtNumber:number,roles:input.roles.length?input.roles:[input.primaryRole],status:input.status,updatedAt:now,...(existing?.teamId===team.id&&existing.seasonId===team.seasonId?{}:{joinedAt:now,createdAt:now})});
      tx.set(playerRef,{firstName:input.firstName.trim(),lastName:input.lastName.trim(),dateOfBirth:input.dateOfBirth,preferredFoot:input.preferredFoot,primaryRole:input.primaryRole,notes:input.notes.trim(),isArchived:false,createdAt:oldPlayer?.data()?.['createdAt']??now,updatedAt:now},{merge:true});
    });
  }

  async recordGoal(workspaceId: string, playerId: string): Promise<void> {
    await updateDoc(doc(this.requireFirestore(), 'workspaces', workspaceId, 'players', playerId), { goals: increment(1), updatedAt: serverTimestamp() });
  }

  async setArchived(workspaceId:string, player:PlayerRecord, archived:boolean):Promise<void> {
    const db=this.requireFirestore();
    await runTransaction(db,async tx=>{
      const p=doc(db,'workspaces',workspaceId,'players',player.id);
      const m=player.teamId&&player.seasonId?doc(db,'workspaces',workspaceId,'teams',player.teamId,'seasons',player.seasonId,'squadMembers',player.id):null;
      const r=m&&player.shirtNumber!==null?doc(db,'workspaces',workspaceId,'teams',player.teamId,'seasons',player.seasonId,'jerseyReservations',String(player.shirtNumber)):null;
      const reservation=r?await tx.get(r):null;
      if (!archived && reservation?.exists() && reservation.data()['playerId']!==player.id) {
        throw new Error('Impossibile ripristinare il numero: è già stato assegnato a un altro giocatore.');
      }
      tx.update(p,{isArchived:archived,updatedAt:serverTimestamp()});
      if (r && archived && reservation?.exists() && reservation.data()['playerId']===player.id) tx.delete(r);
      if (r && !archived) tx.set(r,{playerId:player.id,createdAt:serverTimestamp(),updatedAt:serverTimestamp()});
      if (m) tx.set(m,{playerId:player.id,shirtNumber:player.shirtNumber,roles:player.roles,status:player.status,updatedAt:serverTimestamp()},{merge:true});
    });
  }

  private role(v:unknown):PlayerRole { return PLAYER_ROLES.includes(v as PlayerRole)?v as PlayerRole:'Centrocampista'; }
  private status(v:unknown):PlayerStatus { return ['active','injured','suspended','left'].includes(String(v))?v as PlayerStatus:'active'; }
  private requireFirestore():Firestore { if(!this.firestore) throw new Error('Firestore non è configurato.'); return this.firestore; }
}
