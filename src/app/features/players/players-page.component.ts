import { ChangeDetectionStrategy,Component,inject,signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { TeamService,type TeamRecord } from '../teams/team.service';
import { PLAYER_ROLES,PlayerService,type PlayerInput,type PlayerRecord,type PlayerRole,type PlayerStatus } from './player.service';

@Component({selector:'fsm-players-page',standalone:true,imports:[FormsModule],templateUrl:'./players-page.component.html',styleUrl:'./players-page.component.scss',changeDetection:ChangeDetectionStrategy.OnPush})
export class PlayersPageComponent {
 private readonly auth=inject(FirebaseAuthService); private readonly service=inject(PlayerService); private readonly teamService=inject(TeamService); private readonly notifications=inject(NotificationService);
 protected readonly players=signal<PlayerRecord[]>([]); protected readonly teams=signal<TeamRecord[]>([]); protected readonly loading=signal(true); protected readonly saving=signal(false); protected readonly showArchived=signal(false); protected readonly playerSort=signal<'surname-asc'|'surname-desc'|'shirt-asc'>('surname-asc'); protected readonly playerSortDropdownOpen=signal(false); protected readonly formDropdownOpen=signal<string|null>(null); protected readonly playerCategories=['Juniores Under 19','Under 18','Allievi Under 17','Allievi B Under 16','Giovanissimi Under 15','Giovanissimi B Under 14','Esordienti II anno Under 13','Esordienti I anno Under 12','Pulcini II anno Under 11','Pulcini I anno Under 10','Primi Calci II anno Under 9','Primi Calci I anno Under 8','Piccoli Amici II anno Under 7','Piccoli Amici I anno Under 6']; protected readonly error=signal(''); protected readonly notice=signal(''); protected readonly formOpen=signal(false); protected readonly editingId=signal<string|null>(null); protected readonly roles=PLAYER_ROLES; protected form:PlayerInput=this.emptyForm();
 constructor(){void this.load();}
 protected get visiblePlayers(){const list=this.players().filter(p=>this.showArchived()||!p.isArchived);return [...list].sort((a,b)=>{if(this.playerSort()==='shirt-asc'){const an=a.shirtNumber??Number.MAX_SAFE_INTEGER,bn=b.shirtNumber??Number.MAX_SAFE_INTEGER;return an-bn||a.lastName.localeCompare(b.lastName,'it',{sensitivity:'base'});}const order=a.lastName.localeCompare(b.lastName,'it',{sensitivity:'base'})||a.firstName.localeCompare(b.firstName,'it',{sensitivity:'base'});return this.playerSort()==='surname-desc'?-order:order;});}
 protected get activeTeams(){return this.teams().filter(t=>!t.isArchived&&t.seasonId);}
 protected openCreate(){this.editingId.set(null);this.form=this.emptyForm();this.form.teamId=this.activeTeams[0]?.id??'';this.formOpen.set(true);this.error.set('');this.notice.set('');}
 protected openEdit(p:PlayerRecord){this.editingId.set(p.id);this.form={firstName:p.firstName,lastName:p.lastName,dateOfBirth:p.dateOfBirth,placeOfBirth:p.placeOfBirth,residence:p.residence,postalCode:p.postalCode,identityDocument:p.identityDocument,affiliationCategory:p.affiliationCategory,federationNumber:p.federationNumber,federationCard:p.federationCard,keyContactPhone:p.keyContactPhone,keyContactEmail:p.keyContactEmail,preferredFoot:p.preferredFoot,primaryRole:p.primaryRole,notes:p.notes,teamId:p.teamId||this.activeTeams[0]?.id||'',shirtNumber:p.shirtNumber===null?'':String(p.shirtNumber),roles:p.roles.length?[...p.roles]:[p.primaryRole],status:p.status};this.formOpen.set(true);this.error.set('');this.notice.set('');}
 protected cancel(){this.formOpen.set(false);this.editingId.set(null);this.form=this.emptyForm();this.error.set('');}
 
 protected toggleFormDropdown(name:string){this.formDropdownOpen.update(open=>open===name?null:name);}
 protected setAffiliationCategory(value:string){this.form.affiliationCategory=value;this.formDropdownOpen.set(null);}
 protected setPrimaryRole(value:PlayerRole){this.form.primaryRole=value;this.form.roles=[...new Set([...this.form.roles,value])];this.formDropdownOpen.set(null);}
 protected setPreferredFoot(value:string){this.form.preferredFoot=value;this.formDropdownOpen.set(null);}
 protected setTeam(teamId:string){this.form.teamId=teamId;this.formDropdownOpen.set(null);}
 protected setStatus(value:PlayerStatus){this.form.status=value;this.formDropdownOpen.set(null);}
 protected onTeamChange(teamId:string){this.form.teamId=teamId;}
 protected toggleRole(role:PlayerRole,checked:boolean){this.form.roles=checked?[...new Set([...this.form.roles,role])]:this.form.roles.filter(r=>r!==role);if(!this.form.roles.length)this.form.roles=[this.form.primaryRole];}
 protected async save(){const id=this.auth.workspaceId();if(!id||!this.form.firstName.trim()||!this.form.lastName.trim()||!this.form.teamId||!String(this.form.shirtNumber??'').trim()){this.error.set('Inserisci nome, cognome, squadra e numero di maglia.');return;}this.saving.set(true);this.error.set('');this.notice.set('');try{const old=this.players().find(p=>p.id===this.editingId());await this.service.save(id,this.form,this.teams(),old);this.notice.set(old?'Giocatore aggiornato.':'Giocatore inserito nella rosa.');this.formOpen.set(false);this.editingId.set(null);await this.load();}catch(e){console.error('Unable to save player.',e);this.error.set(e instanceof Error?e.message:'Non è stato possibile salvare il giocatore. Verifica i permessi Firestore.');}finally{this.saving.set(false);}}
 protected async deletePlayer(p:PlayerRecord){
  const yes=await this.notifications.confirm({title:'Eliminare definitivamente il giocatore?',message:`"${p.firstName} ${p.lastName}" verrà eliminato dall'anagrafica e dalla rosa. L'operazione non è reversibile.`,confirmText:'Elimina giocatore',cancelText:'Annulla',tone:'danger'});
  if(!yes)return;
  const id=this.auth.workspaceId();if(!id)return;
  this.saving.set(true);this.error.set('');this.notice.set('');
  try{await this.service.delete(id,p);this.notice.set('Giocatore eliminato definitivamente.');if(this.editingId()===p.id)this.cancel();await this.load();}
  catch(e){console.error('Unable to delete player.',e);this.error.set('Non è stato possibile eliminare il giocatore. Riprova.');}
  finally{this.saving.set(false);}
 }
 protected async toggleArchive(p:PlayerRecord){const yes=await this.notifications.confirm({title:p.isArchived?'Ripristinare il giocatore?':'Archiviare il giocatore?',message:p.isArchived?'Il giocatore tornerà nella rosa attiva.':'Il giocatore verrà rimosso dalla rosa attiva ma i suoi dati resteranno conservati.',confirmText:p.isArchived?'Ripristina':'Archivia',cancelText:'Annulla',tone:p.isArchived?'default':'danger',icon:p.isArchived?undefined:'archive'});if(!yes)return;const id=this.auth.workspaceId();if(!id)return;try{await this.service.setArchived(id,p,!p.isArchived);this.notice.set(p.isArchived?'Giocatore ripristinato.':'Giocatore archiviato.');await this.load();}catch(e){console.error(e);this.error.set('Non è stato possibile aggiornare il giocatore.');}}
 protected statusLabel(s:PlayerStatus){return ({active:'In rosa',injured:'Infortunato',suspended:'Squalificato',left:'Fuori rosa'})[s];}
 private async load(){const id=this.auth.workspaceId();if(!id){this.loading.set(false);return;}this.loading.set(true);try{const teams=await this.teamService.list(id);this.teams.set(teams);this.players.set(await this.service.list(id,teams));}catch(e){console.error('Unable to load players.',e);this.error.set('Non è stato possibile caricare i giocatori. Controlla i permessi Firestore.');}finally{this.loading.set(false);}}
 private emptyForm():PlayerInput{return{firstName:'',lastName:'',dateOfBirth:'',placeOfBirth:'',residence:'',postalCode:'',identityDocument:'',affiliationCategory:'',federationNumber:'',federationCard:'',keyContactPhone:'',keyContactEmail:'',preferredFoot:'',primaryRole:'Centrocampista',notes:'',teamId:'',shirtNumber:'',roles:['Centrocampista'],status:'active'};}
}
