import { ActiveEventService } from '../../core/active-event.service';
import { Injectable, inject } from '@angular/core';
import { addDoc, collection, deleteDoc, doc, getDocs, serverTimestamp, updateDoc, type Firestore } from 'firebase/firestore';
import { FIRESTORE_DB } from '../../core/firebase.tokens';

/** Anagrafe Dirigente: a club official. */
export interface StaffInput {
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  placeOfBirth: string;
  residence: string;
  postalCode: string;
  identityDocument: string;
  affiliationCategory: string;
  federationNumber: string;
  federationCard: string;
}
export interface StaffRecord extends StaffInput { id: string; }

const FIELDS: (keyof StaffInput)[] = [
  'firstName', 'lastName', 'dateOfBirth', 'placeOfBirth', 'residence', 'postalCode',
  'identityDocument', 'affiliationCategory', 'federationNumber', 'federationCard'
];

export function emptyStaff(): StaffInput {
  return { firstName: '', lastName: '', dateOfBirth: '', placeOfBirth: '', residence: '', postalCode: '', identityDocument: '', affiliationCategory: '', federationNumber: '', federationCard: '' };
}

@Injectable({ providedIn: 'root' })
export class StaffService {
  private readonly firestore = inject(FIRESTORE_DB, { optional: true });
  private readonly events = inject(ActiveEventService);

  async list(workspaceId: string): Promise<StaffRecord[]> {
    await this.events.whenReady();
    const eventId = this.events.activeId();
    const firstId = this.events.firstId();
    const snapshots = await getDocs(collection(this.db(), 'workspaces', workspaceId, 'staff'));
    return snapshots.docs
      // Officials made before events existed belong to the first event.
      .filter(snapshot => !eventId || String(snapshot.data()['eventId'] || firstId) === eventId)
      .map(snapshot => {
        const data = snapshot.data();
        const record = { id: snapshot.id, ...emptyStaff() } as StaffRecord;
        for (const field of FIELDS) record[field] = String(data[field] ?? '');
        return record;
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'it', { sensitivity: 'base' }) || a.firstName.localeCompare(b.firstName, 'it', { sensitivity: 'base' }));
  }

  /** Officials of the other events, to copy into the selected one ("Carica da archivio"). */
  async listArchive(workspaceId: string): Promise<(StaffRecord & { eventTitle: string })[]> {
    await this.events.whenReady();
    const eventId = this.events.activeId();
    const firstId = this.events.firstId();
    const snapshots = await getDocs(collection(this.db(), 'workspaces', workspaceId, 'staff'));
    const titles = new Map(this.events.events().map(event => [event.id, this.events.activeTitleOf(event)]));
    const toRecord = (data: Record<string, unknown>, id: string) => { const record = { id, ...emptyStaff() } as StaffRecord; for (const field of FIELDS) record[field] = String(data[field] ?? ''); return record; };
    const key = (r: StaffRecord) => `${r.lastName}|${r.firstName}|${r.dateOfBirth}`.toLowerCase();
    const mine = new Set(snapshots.docs.filter(item => String(item.data()['eventId'] || firstId) === eventId).map(item => key(toRecord(item.data(), item.id))));
    const seen = new Set<string>();
    return snapshots.docs.filter(item => String(item.data()['eventId'] || firstId) !== eventId).map(item => ({ ...toRecord(item.data(), item.id), eventTitle: titles.get(String(item.data()['eventId'] || firstId)) ?? '' }))
      .filter(record => { const k = key(record); if (mine.has(k) || seen.has(k)) return false; seen.add(k); return true; })
      .sort((a, b) => a.lastName.localeCompare(b.lastName, 'it') || a.firstName.localeCompare(b.firstName, 'it'));
  }

  async save(workspaceId: string, input: StaffInput, id?: string | null): Promise<void> {
    const data: Record<string, unknown> = {};
    for (const field of FIELDS) data[field] = String(input[field] ?? '').trim();
    data['updatedAt'] = serverTimestamp();
    if (id) {
      await updateDoc(doc(this.db(), 'workspaces', workspaceId, 'staff', id), data);
    } else {
      data['createdAt'] = serverTimestamp();
      data['eventId'] = this.events.activeId();
      await addDoc(collection(this.db(), 'workspaces', workspaceId, 'staff'), data);
    }
  }

  async delete(workspaceId: string, id: string): Promise<void> {
    await deleteDoc(doc(this.db(), 'workspaces', workspaceId, 'staff', id));
  }

  private db(): Firestore {
    if (!this.firestore) throw new Error('Firestore non è configurato.');
    return this.firestore;
  }
}
