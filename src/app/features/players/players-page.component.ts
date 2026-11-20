import { ChangeDetectionStrategy,Component,inject,signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { FirebaseAuthService } from '../../core/firebase-auth.service';
import { NotificationService } from '../../core/notifications/notification.service';
import { TeamService,type TeamRecord } from '../teams/team.service';
type PlaceSuggestion={label:string;value:string;postalCode:string};

import { PLAYER_ROLES,PlayerService,type PlayerInput,type PlayerRecord,type PlayerRole,type PlayerStatus } from './player.service';

@Component({selector:'fsm-players-page',standalone:true,imports:[FormsModule],templateUrl:'./players-page.component.html',styleUrl:'./players-page.component.scss',changeDetection:ChangeDetectionStrategy.OnPush})
export class PlayersPageComponent {
 private readonly auth=inject(FirebaseAuthService); private readonly service=inject(PlayerService); private readonly teamService=inject(TeamService); private readonly notifications=inject(NotificationService);
 protected readonly players=signal<PlayerRecord[]>([]); protected readonly teams=signal<TeamRecord[]>([]); protected readonly loading=signal(true); protected readonly saving=signal(false); protected readonly showArchived=signal(false); protected readonly playerSort=signal<'surname-asc'|'surname-desc'|'shirt-asc'>('surname-asc'); protected readonly playerSortDropdownOpen=signal(false); protected readonly error=signal(''); protected readonly notice=signal(''); protected readonly formOpen=signal(false); protected readonly editingId=signal<string|null>(null); protected readonly roles=PLAYER_ROLES; protected readonly residenceSuggestions=signal<PlaceSuggestion[]>([]); protected readonly birthPlaceSuggestions=signal<PlaceSuggestion[]>([]); protected form:PlayerInput=this.emptyForm(); private residenceTimer?:ReturnType<typeof setTimeout>; private birthPlaceTimer?:ReturnType<typeof setTimeout>; private residenceAbort?:AbortController; private birthPlaceAbort?:AbortController;
 constructor(){void this.load();}
 protected get visiblePlayers(){const list=this.players().filter(p=>this.showArchived()||!p.isArchived);return [...list].sort((a,b)=>{if(this.playerSort()==='shirt-asc'){const an=a.shirtNumber??Number.MAX_SAFE_INTEGER,bn=b.shirtNumber??Number.MAX_SAFE_INTEGER;return an-bn||a.lastName.localeCompare(b.lastName,'it',{sensitivity:'base'});}const order=a.lastName.localeCompare(b.lastName,'it',{sensitivity:'base'})||a.firstName.localeCompare(b.firstName,'it',{sensitivity:'base'});return this.playerSort()==='surname-desc'?-order:order;});}
 protected get activeTeams(){return this.teams().filter(t=>!t.isArchived&&t.seasonId);}
 protected openCreate(){this.editingId.set(null);this.form=this.emptyForm();this.form.teamId=this.activeTeams[0]?.id??'';this.applyTeamDefaults(this.form.teamId);this.form.shirtNumber=this.nextAvailableShirtNumber(this.form.teamId);this.formOpen.set(true);this.error.set('');this.notice.set('');}
 protected openEdit(p:PlayerRecord){this.editingId.set(p.id);this.form={firstName:p.firstName,lastName:p.lastName,dateOfBirth:p.dateOfBirth,placeOfBirth:p.placeOfBirth,residence:p.residence,postalCode:p.postalCode,identityDocument:p.identityDocument,affiliationCategory:p.affiliationCategory,federationNumber:p.federationNumber,federationCard:p.federationCard,keyContactPhone:p.keyContactPhone,keyContactEmail:p.keyContactEmail,preferredFoot:p.preferredFoot,primaryRole:p.primaryRole,notes:p.notes,teamId:p.teamId||this.activeTeams[0]?.id||'',shirtNumber:p.shirtNumber===null?'':String(p.shirtNumber),roles:p.roles.length?[...p.roles]:[p.primaryRole],status:p.status};this.formOpen.set(true);this.error.set('');this.notice.set('');}
 protected cancel(){this.clearPlaceSearches();this.formOpen.set(false);this.editingId.set(null);this.form=this.emptyForm();this.error.set('');}
 
 protected onResidenceInput(value:string){this.form.residence=value;this.form.postalCode='';this.schedulePlaceSearch(value,'residence');}
 protected onBirthPlaceInput(value:string){this.form.placeOfBirth=value;this.schedulePlaceSearch(value,'birth');}
 protected selectPlace(item:PlaceSuggestion,kind:'residence'|'birth'){if(kind==='residence'){this.form.residence=item.value;this.form.postalCode=item.postalCode;this.residenceSuggestions.set([]);this.residenceAbort?.abort();}else{this.form.placeOfBirth=item.value;this.birthPlaceSuggestions.set([]);this.birthPlaceAbort?.abort();}}
 protected onTeamChange(teamId:string){const changed=teamId!==this.form.teamId;const previousCategory=this.activeTeams.find(t=>t.id===this.form.teamId)?.category??'';this.form.teamId=teamId;if(changed){if(!this.form.affiliationCategory.trim()||this.form.affiliationCategory===previousCategory)this.form.affiliationCategory=this.activeTeams.find(t=>t.id===teamId)?.category??'';this.form.shirtNumber=this.nextAvailableShirtNumber(teamId);}}
 private applyTeamDefaults(teamId:string){const team=this.activeTeams.find(t=>t.id===teamId);if(team?.category&&!this.form.affiliationCategory.trim())this.form.affiliationCategory=team.category;}
 private nextAvailableShirtNumber(teamId:string):string{const occupied=new Set(this.players().filter(p=>p.teamId===teamId&&p.id!==this.editingId()&&!p.isArchived).map(p=>p.shirtNumber).filter((n):n is number=>n!==null));const next=Array.from({length:99},(_,i)=>i+1).find(n=>!occupied.has(n));return next?String(next):'';}
 private schedulePlaceSearch(query:string,kind:'residence'|'birth'){const isResidence=kind==='residence';const timer=isResidence?this.residenceTimer:this.birthPlaceTimer;if(timer)clearTimeout(timer);const abort=isResidence?this.residenceAbort:this.birthPlaceAbort;abort?.abort();if(query.trim().length<3){if(isResidence)this.residenceSuggestions.set([]);else this.birthPlaceSuggestions.set([]);return;}const next=setTimeout(()=>void this.searchPlaces(query.trim(),kind),350);if(isResidence)this.residenceTimer=next;else this.birthPlaceTimer=next;}
 private async searchPlaces(query:string,kind:'residence'|'birth'){
  const controller=new AbortController();
  if(kind==='residence')this.residenceAbort=controller;else this.birthPlaceAbort=controller;
  const publish=(items:PlaceSuggestion[])=>{if(kind==='residence')this.residenceSuggestions.set(items);else this.birthPlaceSuggestions.set(items);};
  try{
   const params=new URLSearchParams({q:query,limit:'6',lang:'it'});
   const response=await fetch('https://photon.komoot.io/api?'+params.toString(),{signal:controller.signal,headers:{Accept:'application/geo+json'}});
   if(!response.ok)throw new Error('Photon geocoding unavailable');
   const data=await response.json() as {features?:Array<{properties?:Record<string,unknown>}>};
   const suggestions=(data.features??[]).map(feature=>{
    const p=feature.properties??{};
    const get=(key:string)=>typeof p[key]==='string'?String(p[key]).trim():'';
    const city=get('city')||get('district')||get('locality')||get('name');
    const county=get('county');const street=get('street')||get('name');const house=get('housenumber');const postcode=get('postcode');
    const province=county&&city&&county.toLocaleLowerCase('it')!==city.toLocaleLowerCase('it')?county:'';
    const cityValue=city+(province?' ('+province+')':'');
    const streetLine=get('street')?(house?street+', '+house:street):'';
    const address=[streetLine,cityValue].filter(Boolean).join(', ');
    const value=kind==='residence'?(address||cityValue):cityValue;
    return {label:[value,postcode].filter(Boolean).join(' · '),value,postalCode:postcode};
   }).filter(item=>item.value).filter((item,index,all)=>all.findIndex(other=>other.value===item.value&&other.postalCode===item.postalCode)===index).slice(0,6);
   if(suggestions.length){publish(suggestions);return;}
  }catch(error){if(error instanceof DOMException&&error.name==='AbortError')return;}
  // Photon è utile per vie e indirizzi completi, ma non sempre trova prefissi
  // parziali di comuni (ad esempio "Fire" per "Firenze"). In quel caso
  // usiamo la ricerca per prefisso di Open-Meteo/GeoNames.
  try{
   const params=new URLSearchParams({name:query,count:'8',language:'it',format:'json',countryCode:'IT'});
   const response=await fetch('https://geocoding-api.open-meteo.com/v1/search?'+params.toString(),{signal:controller.signal,headers:{Accept:'application/json'}});
   if(!response.ok)throw new Error('Place search unavailable');
   const data=await response.json() as {results?:Array<{name?:string;admin2?:string;admin1?:string;country_code?:string;postcodes?:string[]}>};
   const suggestions=(data.results??[]).filter(place=>place.country_code==='IT').map(place=>{
    const name=String(place.name??'').trim();
    const area=String(place.admin2??place.admin1??'').trim();
    const value=name+(area&&area.toLocaleLowerCase('it')!==name.toLocaleLowerCase('it')?' ('+area+')':'');
    const postalCodes=Array.isArray(place.postcodes)?place.postcodes:[];
    const postalCode=postalCodes.length===1?postalCodes[0]:'';
    return {label:[value,postalCode].filter(Boolean).join(' · '),value,postalCode};
   }).filter(item=>item.value).filter((item,index,all)=>all.findIndex(other=>other.value===item.value&&other.postalCode===item.postalCode)===index).slice(0,6);
   publish(suggestions);
  }catch(error){if(!(error instanceof DOMException&&error.name==='AbortError'))publish([]);}
 }
 private clearPlaceSearches(){if(this.residenceTimer)clearTimeout(this.residenceTimer);if(this.birthPlaceTimer)clearTimeout(this.birthPlaceTimer);this.residenceAbort?.abort();this.birthPlaceAbort?.abort();this.residenceSuggestions.set([]);this.birthPlaceSuggestions.set([]);}
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
