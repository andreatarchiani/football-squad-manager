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
