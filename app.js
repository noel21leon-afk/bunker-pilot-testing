import { calculateVoyage, groupRob, tankCapacity, projectTankDays, consumptionOrder, isConsumableTank, resolveFoActiveFuel, effectiveFuelRates, MAX_LOAD_FRAC, maxFillFrac, rateFor, portRateFor, anchorRateFor, defaultFuelType, fuelTypeNoMixing, normFuelType, fobasChangeover, robFromVolume } from './core.js';

const KEY='bunker-pwa-v16';
const SAVED_VOYAGES_KEY='bunker-saved-voyages-v1';
const APP_VERSION='1.22';
const DEFAULT_PORTS=['Singapore','Port Klang','Tanjung Pelepas','Manila','Batangas','Subic Bay','Cebu','Davao','Iloilo','Bacolod','Kaohsiung','Hong Kong','Shanghai','Ningbo-Zhoushan','Qingdao','Busan','Tokyo','Yokohama','Nagoya','Kobe','Keelung','Xiamen','Shenzhen/Yantian','Ho Chi Minh City','Vung Tau','Laem Chabang','Bangkok','Port Louis','Colombo','Chennai','Mumbai','Mundra','Kandla','Kochi','Dubai','Jebel Ali','Fujairah','Abu Dhabi','Dammam','Ras Tanura','Doha','Sohar','Salalah','Aden','Suez','Port Said','Alexandria','Piraeus','Istanbul','Rotterdam','Antwerp','Hamburg','Bremerhaven','London','Felixstowe','Southampton','Algeciras','Valencia','Barcelona','Genoa','Marseille','Durban','Cape Town','Richards Bay','Lagos','Tema','Mombasa','Dar es Salaam','Maputo','New York','Houston','New Orleans','Los Angeles','Long Beach','San Francisco','Seattle','Vancouver','Montreal','Panama Canal','Cartagena','Balboa','Colon','Santos','Rio de Janeiro','Buenos Aires','Valparaiso','Callao','Melbourne','Sydney','Brisbane','Fremantle','Auckland'];
const $=(s,root=document)=>root.querySelector(s);
const $$=(s,root=document)=>[...root.querySelectorAll(s)];
const uid=(p='id')=>`${p}-${crypto.randomUUID?crypto.randomUUID():Date.now()+Math.random()}`;
const GROUPS={
  fo:{name:'Fuel Oil (VLSFO/HFO)',unit:'MT',defaults:{seaRate:0,portRate:0,reserveDays:3}},
  do:{name:'Diesel Oil (LSMGO/DO)',unit:'MT',defaults:{seaRate:0,portRate:0,reserveDays:3}},
  cyl:{name:'Cylinder Oil',unit:'L',defaults:{seaRate:0,portRate:0,reserveDays:3}},
  mesys:{name:'ME System Oil',unit:'L',defaults:{seaRate:0,portRate:0,reserveDays:7}},
  gesys:{name:'GE System Oil',unit:'L',defaults:{seaRate:0,portRate:0,reserveDays:7}}
};
/* Reserve/day label differs by fuel/lube type (feedback item 1) */
const RESERVE_LABEL={fo:'Reserve Fuel/day',do:'Reserve Fuel/day',cyl:'Reserve Cyl. Oil/day',mesys:'Reserve L.O./day',gesys:'Reserve L.O./day'};
/* Curated default tank-name suggestions per group + role (feedback item: name dropdown) */
const NAME_PRESETS={
  fo:{storage:['No.1 FO Tank (P)','No.1 FO Tank (S)','No.2 FO Tank (P)','No.2 FO Tank (S)','No.3 FO Tank (P)','No.3 FO Tank (S)','FO Overflow Tank'],
      settling:['FO Settling Tank No.1','FO Settling Tank No.2'],
      service:['FO Service Tank No.1','FO Service Tank No.2','Boiler FO Service Tank']},
  do:{storage:['No.1 DO Tank (P)','No.1 DO Tank (S)','No.2 DO Tank (P)','No.2 DO Tank (S)','DO Overflow Tank'],
      settling:['DO Settling Tank'],
      service:['DO Service Tank No.1','DO Service Tank No.2']},
  cyl:{storage:['Cyl Oil Storage Tk 1','Cyl Oil Storage Tk 2','Cylinder Oil Measuring Tank']},
  mesys:{storage:['ME System Oil Tank','ME Sump Tank','ME System Oil Renovating Tank']},
  gesys:{storage:['GE System Oil Tank','GE Sump Tank','GE System Oil Renovating Tank']}
};
const CUSTOM_NAME='__custom__';
/* Fuel sub-type per tank (feedback item: choose HFO/VLSFO for FO tanks, LSMGO/MGO/Biodiesel/Other for DO tanks).
   Drives the bunkering mixing rule (fuelTypeNoMixing in core.js) and which tanks are offered for a given bunker. */
const FUEL_TYPE_OPTIONS={
  fo:[{value:'vlsfo',label:'VLSFO'},{value:'hfo',label:'HFO'}],
  do:[{value:'lsmgo',label:'LSMGO'},{value:'mgo',label:'MGO'},{value:'biodiesel',label:'Biodiesel'}]
};
const FUEL_MANUAL='__manual__';
function fuelTypeOptions(group){return FUEL_TYPE_OPTIONS[group]||null;}
function fuelTypeLabel(group,val){const opts=fuelTypeOptions(group);const hit=opts&&opts.find(o=>o.value===val);return hit?hit.label:((!val||val==='other')?'Other':String(val));}
/* Drop-down of preset grades plus "Other (type manually)"; the typed text is stored as the value itself.
   dataAttrs carries data-mp="tank|bunker|eca" and the target ids (see manualPickApply). */
function manualPickHtml(opts,val,dataAttrs,placeholder){
  const preset=opts.some(o=>o.value===val),txt=(preset||val==='other'||!val)?'':val;
  return `<span class="manual-pick"><select ${dataAttrs}>${opts.map(o=>`<option value="${o.value}" ${preset&&val===o.value?'selected':''}>${esc(o.label)}</option>`).join('')}<option value="${FUEL_MANUAL}" ${preset?'':'selected'}>Other (type manually)</option></select><input type="text" ${dataAttrs} data-mp-text="1" class="manual-name-input" value="${esc(txt)}" placeholder="${esc(placeholder||'Type fuel type')}" autocomplete="off" ${preset?'hidden':''}></span>`;
}
function manualPickApply(el,val){
  const k=el.dataset.mp;
  if(k==='tank'){const x=state.tanks[Number(el.dataset.tankIndex)];if(x)x.fuelType=val;}
  else if(k==='bunker'){const r=state.route[Number(el.dataset.bunkerRoute)];if(r){r.bunkers ||= {};(r.bunkers[el.dataset.bunkerFuel] ||= {quantity:0,autoAllocate:true,allocations:[]}).fuelType=val;}}
  else if(k==='eca'){const r=state.route[Number(el.dataset.eca)];if(r){r.eca ||= {entering:{},leaving:{}};(r.eca[el.dataset.ecaDir] ||= {})[el.dataset.ecaField]=val;}}
}
function manualPickSelector(el){
  const k=el.dataset.mp;
  if(k==='tank')return `[data-mp-text][data-tank-index="${el.dataset.tankIndex}"]`;
  if(k==='bunker')return `[data-mp-text][data-bunker-route="${el.dataset.bunkerRoute}"][data-bunker-fuel="${el.dataset.bunkerFuel}"]`;
  return `[data-mp-text][data-eca="${el.dataset.eca}"][data-eca-dir="${el.dataset.ecaDir}"][data-eca-field="${el.dataset.ecaField}"]`;
}
/* Top-bar icon labels: tapping an icon flashes its name beneath it. */
let iconTipTimer=null;
function showIconLabel(btn){
  let tip=document.getElementById('iconTip');
  if(!tip){tip=document.createElement('div');tip.id='iconTip';tip.className='icon-tip';tip.setAttribute('role','status');document.body.appendChild(tip);}
  tip.textContent=btn.dataset.label;tip.classList.add('show');
  const r=btn.getBoundingClientRect(),w=tip.offsetWidth;
  tip.style.top=(r.bottom+8)+'px';
  tip.style.left=Math.max(8,Math.min(window.innerWidth-w-8,r.left+r.width/2-w/2))+'px';
  clearTimeout(iconTipTimer);iconTipTimer=setTimeout(()=>tip.classList.remove('show'),1800);
}
/* Small safe arithmetic evaluator for the calculator (no eval). Returns a string, 'Error', or null if incomplete. */
function calcEval(src){
  const s=String(src).replace(/×/g,'*').replace(/÷/g,'/').replace(/−/g,'-').replace(/\s+/g,'');
  if(!s)return null;
  let i=0;
  const fail=()=>{throw new Error('x');};
  function primary(){
    if(s[i]==='('){i++;const v=expr();if(s[i]!==')')fail();i++;return v;}
    const m=/^(\d+\.?\d*|\.\d+)/.exec(s.slice(i));if(!m)fail();i+=m[0].length;return parseFloat(m[0]);
  }
  function factor(){
    if(s[i]==='-'){i++;return -factor();}
    if(s[i]==='+'){i++;return factor();}
    let v=primary();while(s[i]==='%'){i++;v/=100;}return v;
  }
  function term(){let v=factor();while(s[i]==='*'||s[i]==='/'){const o=s[i++],r=factor();v=o==='*'?v*r:v/r;}return v;}
  function expr(){let v=term();while(s[i]==='+'||s[i]==='-'){const o=s[i++],r=term();v=o==='+'?v+r:v-r;}return v;}
  try{const v=expr();if(i!==s.length)return null;if(!Number.isFinite(v))return 'Error';return String(Number(v.toPrecision(12)));}catch{return null;}
}
function initCalcModal(){
  const modal=$('#calcModal'),expr=$('#calcExpr'),res=$('#calcResult');
  const update=()=>{const v=expr.value.trim()?calcEval(expr.value):'0';res.textContent=v===null?'':'= '+v;};
  const equals=()=>{const v=calcEval(expr.value);if(v===null||v==='Error'){res.textContent='= Error';return;}expr.value=v;update();};
  const press=k=>{if(k==='C')expr.value='';else if(k==='⌫')expr.value=expr.value.slice(0,-1);else if(k==='=')return equals();else expr.value+=k;update();};
  $('#calcBtn').onclick=()=>{modal.hidden=false;update();try{expr.focus({preventScroll:true});}catch{}};
  expr.addEventListener('input',update);
  expr.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();equals();}});
  $('#calcPane').addEventListener('click',e=>{const b=e.target.closest('[data-k]');if(b)press(b.dataset.k);});
}
const UTC_OFFSETS=[-12,-11,-10,-9,-9.5,-8,-7,-6,-5,-4,-3.5,-3,-2,-1,0,1,2,3,3.5,4,4.5,5,5.5,5.75,6,6.5,7,8,8.75,9,9.5,10,10.5,11,12,12.75,13,14];


/* ---------- v1.8 UI helpers ---------- */
const ico=d=>`<svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
const ICON={
  trash:ico('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  up:ico('<path d="M12 19V5M6 11l6-6 6 6"/>'),
  down:ico('<path d="M12 5v14M6 13l6 6 6-6"/>'),
  plus:ico('<path d="M12 5v14M5 12h14"/>'),
  chev:ico('<path d="M6 9l6 6 6-6"/>').replace('class="ico"','class="ico fold-chev"')
};
const uiOpen=new Set();           // remembers which cards/folds are expanded across re-renders
let tableTouched=false;
const isCons=isConsumableTank;
const isFixedRole=t=>t.category==='settling'||t.category==='service';
/* Settling and service tanks are always treated as in service. */
function tankInService(t){return!!t&&isFixedRole(t);}
const fmtN=(v,unit)=>n(v).toFixed(unit==='L'?0:2);
const TAB_TITLES={dashboard:'Dashboard',setup:'Setup',tanks:'Tanks',voyage:'Ports',bunkering:'Bunkering & Lube Oil',eca:'ECA / SECA Changeover',results:'Results & Export'};
let currentTab=null;const tabScroll={};
function showTab(id,opts={}){
  if(!TAB_TITLES[id])id='dashboard';
  const changed=currentTab!==id;
  if(currentTab)tabScroll[currentTab]=window.scrollY;
  currentTab=id;
  renderTabIfStale(id);
  if(id==='tanks')setTimeout(()=>askMaxFill(false),0);
  $$('.section').forEach(sec=>{const on=sec.id===id;sec.classList.toggle('active',on);sec.hidden=!on;});
  $$('.nav-link').forEach(a=>{const on=a.dataset.tab===id;a.classList.toggle('active',on);if(on)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
  const title=$('#pageTitle');if(title)title.textContent=TAB_TITLES[id];
  try{sessionStorage.setItem('bunker-tab',id);}catch{}
  if(location.hash!=='#'+id)history.replaceState(null,'','#'+id);
  if(changed&&opts.scroll!==false)window.scrollTo({top:tabScroll[id]||0});
}
function applyHints(){
  // Explanation text now appears on demand when a field is focused/tapped (see .field:focus-within>.help),
  // so the global toggle defaults OFF and is only for people who want every hint visible at once.
  let v=null;try{v=localStorage.getItem('bunker-hints');}catch{}
  const on=v==='1';
  document.body.classList.toggle('hints',on);
  const b=$('#hintsBtn');if(b)b.setAttribute('aria-pressed',String(on));
}

function defaultState(){return{
  meta:{vesselName:'',voyageNo:'',startUtc:new Date().toISOString().slice(0,16),currentPosition:'',positionMode:'manual',notes:'',noonRob:{fo:0,do:0,cyl:0,mesys:0,gesys:0},ecaSystemDefaults:{me:{rate:0,qty:0},ae:{rate:0,qty:0},boiler:{rate:0,qty:0}}},
  fuels:[{id:'fo',name:GROUPS.fo.name,seaRate:0,portRate:0,anchorRate:0,unit:'MT',reserveDays:3,reserveRate:0,foMode:'vlsfo',hfo:{seaRate:0,portRate:0,anchorRate:0,reserveDays:3,reserveRate:0}},{id:'do',name:GROUPS.do.name,seaRate:0,portRate:0,anchorRate:0,unit:'MT',reserveDays:3,reserveRate:0,doEcaSplit:false,insideEca:{seaRate:0,portRate:0,anchorRate:0}}],
  lubes:[{id:'cyl',name:GROUPS.cyl.name,seaRate:0,portRate:0,anchorRate:0,unit:'L',reserveDays:3,reserveRate:0},{id:'mesys',name:GROUPS.mesys.name,seaRate:0,portRate:0,anchorRate:0,unit:'L',reserveDays:7,reserveRate:0},{id:'gesys',name:GROUPS.gesys.name,seaRate:0,portRate:0,anchorRate:0,unit:'L',reserveDays:7,reserveRate:0}],
  tanks:[],active:{fo:0,do:0},route:[]
};}

function migrate(s){
  if(!s||typeof s!=='object')return defaultState();
  const d=defaultState();
  s.meta={...d.meta,...(s.meta||{})};
  s.meta.currentPosition=s.meta.currentPosition??'';s.meta.positionMode=s.meta.positionMode??'manual';s.meta.noonRob={fo:0,do:0,cyl:0,mesys:0,gesys:0,...(s.meta.noonRob||{})};
  s.meta.ecaSystemDefaults={me:{rate:0,qty:0,...(s.meta.ecaSystemDefaults?.me||{})},ae:{rate:0,qty:0,...(s.meta.ecaSystemDefaults?.ae||{})},boiler:{rate:0,qty:0,...(s.meta.ecaSystemDefaults?.boiler||{})}};
  s.fuels=(s.fuels||d.fuels).map((x,i)=>({...d.fuels[i%2],...x}));
  s.fuels.forEach(f=>{if(f.id==='fo'){f.foMode=['vlsfo','hfo','both'].includes(f.foMode)?f.foMode:'vlsfo';f.hfo={seaRate:0,portRate:0,anchorRate:0,reserveDays:3,reserveRate:0,...(f.hfo||{})};}else if(f.id==='do'){f.doEcaSplit=f.doEcaSplit===true;f.insideEca={seaRate:0,portRate:0,anchorRate:0,...(f.insideEca||{})};}});
  s.lubes=(s.lubes||d.lubes).map((x,i)=>({...d.lubes[i%3],...x}));
  s.tanks=(s.tanks||[]).map((t,i)=>{
    const hasFuelOpts=!!fuelTypeOptions(t.group),capUnit=hasFuelOpts?(t.capUnit==='weight'?'weight':'volume'):undefined;
    const vol=hasFuelOpts&&capUnit==='volume',density=vol?(Number(t.density)>0?Number(t.density):0.95):undefined;
    const capacityM3=vol?(Number.isFinite(Number(t.capacityM3))?Number(t.capacityM3):(density?Number(t.capacity||0)/density:0)):undefined;
    let robVolumeM3,robTempC,rob=Number(t.rob)||0;
    if(vol){
      robTempC=Number.isFinite(Number(t.robTempC))?Number(t.robTempC):15;
      robVolumeM3=Number.isFinite(Number(t.robVolumeM3))?Number(t.robVolumeM3):
        // Backfill from a previously-entered MT value (older plans / imports) so existing ROB isn't lost
        // when this tank first shows the Corrected GOV field — precise only once volume/temp are re-sounded.
        (density>0?Math.round((rob/density)*100)/100:0);
      rob=Math.max(0,robFromVolume(robVolumeM3,robTempC,density));
    }
    return{...t,sequence:Number.isFinite(Number(t.sequence))?Number(t.sequence):i+1,order:Number.isFinite(Number(t.order))?Number(t.order):i,unpumpable:Number(t.unpumpable)||0,consumable:t.consumable!==false,category:t.category||'storage',inService:t.inService===true,nameCustom:t.nameCustom===true,fuelType:t.fuelType||defaultFuelType(t.group)||null,capUnit,density,capacityM3,robVolumeM3,robTempC,rob};
  });
  s.active={...d.active,...(s.active||{})};
  const ecaDefaults=()=>({entering:{enabled:false},leaving:{enabled:false}});
  s.route=(s.route||[]).map(r=>{
    const base={port:'',distanceNm:0,speedKn:0,anchorStayDays:0,anchorStayHours:0,anchorMode:'anchor',portStayDays:0,portStayHours:0,utcOffset:0,notes:'',eta:'',foActiveFuel:'vlsfo',bunkers:{}};
    const merged={...base,...r};
    const d=ecaDefaults();
    merged.portStayHours=Number(merged.portStayHours)||0;
    merged.anchorStayDays=Number(merged.anchorStayDays)||0;
    merged.anchorStayHours=Number(merged.anchorStayHours)||0;
    merged.eca={entering:{...d.entering,...(r.eca?.entering||{})},leaving:{...d.leaving,...(r.eca?.leaving||{})}};
    return merged;
  });
  return s;
}
function load(){try{return migrate(JSON.parse(localStorage.getItem(KEY)||'null'));}catch{return defaultState();}}
let state=load();let calc=calculateVoyage(state);
function save(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{/* quota or storage unavailable — keep working in-memory; use Save Voyage to keep a named copy */}}
function rerun(){calc=calculateVoyage(state);save();renderAll();}
/* Live recalculation: every input recomputes the whole plan. The tab being edited is updated in place (so typing
   is never interrupted); the other tabs are flagged and redrawn the moment they are opened. */
const staleTabs=new Set();
function renderTabIfStale(id){
  if(!staleTabs.has(id))return;staleTabs.delete(id);
  const fn={tanks:()=>renderTanks(),voyage:()=>renderRoute(),bunkering:()=>renderBunkering(),eca:()=>renderEca()}[id];if(fn)fn();
}
function syncAllCards(){
  state.tanks.forEach((_,i)=>syncTankCard(i));
  state.route.forEach((_,i)=>{syncRouteCard(i);syncBunkerConditions(i);syncEcaResult(i);});
  document.querySelectorAll('[data-open-key^="bunkport:"]').forEach(el=>{const i=Number(el.dataset.openKey.slice(9)),c=calc.results[i],m=el.querySelector('.rs-meta');if(m&&c)m.textContent=`ETA ${fmtDate(c.arrivalUtc,c.utcOffset)}`;});
  ['tanks','voyage','bunkering','eca'].forEach(t=>{if(t!==currentTab)staleTabs.add(t);});
}
function refreshOutputs(){calc=calculateVoyage(state);save();renderDashboard();renderResults();renderSidebar();renderRouteSummary(activePosition().index);syncAllCards();}
function esc(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
function n(v){const x=Number(v);return Number.isFinite(x)?x:0;}
function fmtQty(v,unit='MT'){return `${n(v).toFixed(unit==='L'?0:2)} ${unit}`;}
function fmtDate(iso,offset=0){const d=new Date(iso);if(Number.isNaN(d.getTime()))return'—';const local=new Date(d.getTime()+n(offset)*3600000),pad=x=>String(x).padStart(2,'0');return `${local.getUTCFullYear()}-${pad(local.getUTCMonth()+1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;}
function fmtUTC(iso){const d=new Date(iso);if(Number.isNaN(d.getTime()))return'—';return d.toISOString().slice(0,16).replace('T',' ')+' UTC';}
function pct(x){return`${(n(x)*100).toFixed(1)}%`;}
function days(x){return n(x).toFixed(3);}
/* True when a "fixed once entered" field actually needs a confirm: it held a real (non-zero) value
   and the committed edit actually changes it. undefined `before` means the field was never focused
   through the guard (e.g. set programmatically), so nothing to confirm. */
function lockedFieldNeedsConfirm(before,after){
  if(before===undefined)return false;
  const b=Number(before),a=Number(after);
  return Number.isFinite(b)&&b!==0&&Number.isFinite(a)&&b!==a;
}
function daysHours(x){
  let d=Math.floor(Math.max(0,n(x))),h=Math.round((Math.max(0,n(x))-d)*24);
  if(h>=24){h-=24;d+=1;}
  return `${d} d ${h} h`;
}
function unitFor(id){return[...state.fuels,...state.lubes].find(p=>p.id===id)?.unit||'MT';}
function getProfile(id){return[...state.fuels,...state.lubes].find(p=>p.id===id);}
function groupLabel(id){return getProfile(id)?.name||GROUPS[id]?.name||id;}
function tanksFor(group,onlyConsumable=false){return consumptionOrder(state.tanks.filter(t=>t.group===group&&(!onlyConsumable||isCons(t))));}
function activePosition(){
  if(!calc.results.length)return{kind:'none',label:'No route yet',detail:'Add ports to calculate the voyage.',progress:0,next:'—',index:-1};
  // First honour an explicit present-position match. This makes the dashboard
  // deterministic for stored/historical plans and for offline planning.
  const currentText=String(state.meta.currentPosition||'').trim().toLowerCase();
  if(currentText){
    const exact=calc.results.findIndex(r=>String(r.port||'').trim().toLowerCase()===currentText);
    if(exact>=0){
      const next=calc.results[exact+1];
      return {kind:'at-port',label:`At ${calc.results[exact].port}`,detail:`Present position matches route point ${exact+1}.`,progress:progressAt(calc.results[exact],exact),next:next?.port||'Voyage complete',index:exact};
    }
    const partial=calc.results.findIndex(r=>String(r.port||'').toLowerCase().includes(currentText)||currentText.includes(String(r.port||'').toLowerCase()));
    if(partial>=0){
      const next=calc.results[partial+1];
      return {kind:'at-port',label:`At ${calc.results[partial].port}`,detail:`Present position matches route point ${partial+1}.`,progress:progressAt(calc.results[partial],partial),next:next?.port||'Voyage complete',index:partial};
    }
  }
  const now=Date.now(),start=new Date(state.meta.startUtc||0).getTime();
  if(!Number.isFinite(start))return{kind:'scheduled',label:'Scheduled',detail:'Voyage timeline is available below.',progress:0,next:calc.results[0]?.port||'—',index:0};
  if(now<start)return{kind:'not-started',label:'Not departed',detail:`Planned voyage starts ${fmtUTC(state.meta.startUtc)}.`,progress:0,next:calc.results[0]?.port||'—',index:0};
  for(let i=0;i<calc.results.length;i++){
    const r=calc.results[i],a=new Date(r.arrivalUtc).getTime(),d=new Date(r.departureUtc).getTime();
    if(now>=a&&now<=d){const next=calc.results[i+1];return{kind:'at-port',label:`At ${r.port}`,detail:`Port stay ends ${fmtDate(r.departureUtc,r.utcOffset)} local.`,progress:progressAt(r,i),next:next?.port||'Voyage complete',index:i};}
    const next=calc.results[i+1];
    if(next){const na=new Date(next.arrivalUtc).getTime();if(now>d&&now<na)return{kind:'underway',label:`Underway to ${next.port}`,detail:`ETA ${fmtDate(next.arrivalUtc,next.utcOffset)} local.`,progress:progressAt(r,i,true),next:next.port,index:i+1};}
  }
  const last=calc.results.at(-1);
  if(now>new Date(last.departureUtc).getTime())return{kind:'complete',label:'Voyage complete',detail:`Last planned departure was ${fmtDate(last.departureUtc,last.utcOffset)} local.`,progress:100,next:'—',index:calc.results.length-1};
  return{kind:'scheduled',label:'Scheduled',detail:'Voyage timeline is available below.',progress:progressAt(calc.results[0],0),next:calc.results[0].port,index:0};
}
function progressAt(r,i,underway=false){
  if(!calc.results.length)return 0;
  const start=new Date(state.meta.startUtc).getTime(),end=new Date(calc.results.at(-1).departureUtc).getTime();
  if(end<=start)return 0;
  if(underway){const dep=new Date(r.departureUtc).getTime(),next=calc.results[i],arr=new Date(next.arrivalUtc).getTime();return Math.max(0,Math.min(99,((Date.now()-dep)/(arr-dep))*100+(i-1)/Math.max(1,calc.results.length)*100));}
  const t=new Date(r.departureUtc).getTime();return Math.max(0,Math.min(100,((t-start)/(end-start))*100));
}
function explain(title,text){return `<span class="help"><b>${esc(title)}:</b> ${esc(text)}</span>`;}
function utcOffsetLabel(v){const sign=v<0?'-':'+',abs=Math.abs(v),h=Math.floor(abs),m=Math.round((abs-h)*60);return `UTC${sign}${h}:${String(m).padStart(2,'0')}`;}

let pendingFocus=null;
function renderAll(){
  staleTabs.clear();
  const ver=$('#appVersion');if(ver)ver.textContent=`v${APP_VERSION}`;const dl=$('#defaultPorts');if(dl)dl.innerHTML=DEFAULT_PORTS.map(x=>`<option value="${esc(x)}">`).join('');
  $('#vesselName').value=state.meta.vesselName||'';$('#voyageNo').value=state.meta.voyageNo||'';$('#startUtc').value=state.meta.startUtc||'';$('#currentPosition').value=state.meta.currentPosition||'';
  const nr=state.meta.noonRob||{};$('#noonRobFo').value=nr.fo||'';$('#noonRobDo').value=nr.do||'';$('#noonRobCyl').value=nr.cyl||'';$('#noonRobMesys').value=nr.mesys||'';$('#noonRobGesys').value=nr.gesys||'';
  renderRates();renderTanks();renderRoute();renderBunkering();renderEca();renderDashboard();renderResults();renderSidebar();
  if(pendingFocus){const sel=pendingFocus;pendingFocus=null;requestAnimationFrame(()=>{const el=document.querySelector(sel);if(el){el.scrollIntoView({behavior:'smooth',block:'center'});el.focus();if(el.select&&el.type!=='number')el.select();}});}
}
function renderSidebar(){
  $('#sideVessel').textContent=state.meta.vesselName||'No vessel yet';$('#sideVoyage').textContent=state.meta.voyageNo||'Set up the vessel and voyage';
  const sub=$('#topSub');if(sub)sub.textContent=[state.meta.vesselName,state.meta.voyageNo].filter(Boolean).join(' / ')||'Bunker & ROB Planner';
}
function renderDashboard(){
  const first=calc.results[0],last=calc.results.at(-1),status=activePosition();
  $('#kpiRoute').textContent=calc.results.length;$('#kpiDuration').textContent=calc.results.length?`${calc.totals.totalVoyageDays.toFixed(1)} d`:'—';
  const alertCount=buildAlertItems().length;$('#kpiAlerts').textContent=alertCount;$('#kpiAlerts').classList.toggle('bad',alertCount>0);const navDot=$('#navDot');if(navDot)navDot.hidden=!alertCount;$('#kpiNext').textContent=status.next||first?.port||'—';
  $('#presentPositionView').textContent=state.meta.currentPosition||'Not entered';$('#positionDetail').textContent=status.detail;
  $('#positionStatus').textContent=status.label;$('#progressLabel').textContent=`${Math.round(status.progress)}%`;$('#voyageProgress').style.width=`${Math.max(0,Math.min(100,status.progress))}%`;$('#nextLegLabel').textContent=status.next==='—'?'No succeeding port':`Next: ${status.next}`;
  const statusClass=status.kind==='at-port'?'badge green':status.kind==='underway'?'badge':status.kind==='complete'?'badge green':'badge yellow';$('#positionStatus').className=`status-pill ${statusClass.replace('badge ','')}`;
  renderRouteSummary(status.index);
  const PRODUCTS=[{id:'fo',label:'Fuel Oil'},{id:'do',label:'Diesel Oil'},{id:'cyl',label:'Cylinder Oil'},{id:'mesys',label:'ME System Oil'},{id:'gesys',label:'GE System Oil'}];
  const nr=state.meta.noonRob||{};
  const robCards=PRODUCTS.map(p=>{
    const unit=unitFor(p.id),noon=Math.max(0,n(nr[p.id])),actual=groupRob(state.tanks,p.id),delta=actual-noon,tol=Math.max(unit==='MT'?1:20,noon*0.02);
    const flag=Math.abs(delta)>tol,sign=delta>0?'+':delta<0?'−':'±';
    return `<div class="metric-card rob-compare-card${flag?' warn':''}"${W('robcompare',{g:p.id})}><div class="metric-label">${esc(p.label)}</div>
      <div class="rob-compare-rows"><span>Noon report</span><strong>${fmtQty(noon,unit)}</strong><span>Actual (tanks)</span><strong>${fmtQty(actual,unit)}</strong></div>
      <div class="rob-compare-delta ${flag?'warn':'ok'}">${sign} ${fmtQty(Math.abs(delta),unit)} vs noon report</div></div>`;
  }).join('');
  $('#robCompare').innerHTML=wrapMetricLabel('NOON REPORT ROB vs ACTUAL TANK ROB',robCards);
  $('#bunkerNeeded').innerHTML=bunkerNeededHtml(status.index);
  $('#ecaAhead').innerHTML=ecaAheadHtml(status.index);
  const nextIndex=status.kind==='at-port'||status.kind==='underway'?status.index:(status.kind==='complete'?-1:status.index);const next=nextIndex>=0?calc.results[nextIndex]:null;$('#nextPort').innerHTML=next?`<h3>Next port</h3><div class="next-port"><strong>${esc(next.port)}</strong><span${W('eta',{i:next.index})}>ETA ${fmtDate(next.arrivalUtc,next.utcOffset)} local · ${fmtUTC(next.arrivalUtc)}</span><span${W('etd',{i:next.index})}>ETD ${fmtDate(next.departureUtc,next.utcOffset)} local · ${fmtUTC(next.departureUtc)}</span><span${W('portstay',{i:next.index})}>${Math.floor(n(next.portStayDays))} d ${n(next.portStayHours)} h port stay</span><span${W('distance',{i:next.index})}>${n(next.distanceNm).toFixed(1)} NM from previous point</span></div>`:'<h3>Next port</h3><div class="next-port"><span>No future port in the current plan.</span></div>';
}
/* First port, from the vessel's current position onward, where fuel/diesel is still required to keep
   the reserve intact (fuelStatus.bunkerRequiredNow) or a lube-oil replenishment has been planned. */
function bunkerNeededHtml(fromIndex){
  const from=Math.max(0,fromIndex),FUELS=[{id:'fo',label:'Fuel'},{id:'do',label:'Diesel'}],LUBES=[{id:'cyl',label:'Cylinder oil'},{id:'mesys',label:'ME system oil'},{id:'gesys',label:'GE system oil'}];
  for(let i=from;i<calc.results.length;i++){
    const r=calc.results[i];
    const fuelNeeds=FUELS.map(f=>({...f,qty:Math.max(0,n(r.fuelStatus?.[f.id]?.bunkerRequiredNow))})).filter(x=>x.qty>0.005);
    const lubeNeeds=LUBES.map(l=>({...l,qty:Math.max(0,n(r.bunkerInfo?.[l.id]?.quantity))})).filter(x=>x.qty>0.005);
    if(!fuelNeeds.length&&!lubeNeeds.length)continue;
    const rows=[...fuelNeeds.map(x=>({...x,unit:unitFor(x.id)})),...lubeNeeds.map(x=>({...x,unit:unitFor(x.id)}))]
      .map(x=>`<span${W('req',{i,g:x.id})}><b>${esc(x.label)}</b> ${fmtQty(x.qty,x.unit)}</span>`).join('');
    return `<h3>Bunkering required</h3><div class="next-port"><strong>${esc(r.port)}</strong><small class="muted">ETA ${fmtDate(r.arrivalUtc,r.utcOffset)} local</small><div class="bunker-needed-rows">${rows}</div></div>`;
  }
  return `<h3>Bunkering required</h3><div class="next-port"><span>No fuel, diesel or lube-oil bunkering is required or planned from here to the end of the voyage.</span></div>`;
}
/* First upcoming ECA/SECA direction (entering or leaving), from the vessel's current position onward. */
function ecaAheadHtml(fromIndex){
  const from=Math.max(0,fromIndex);
  for(let i=from;i<state.route.length;i++){
    const r=state.route[i];
    for(const dir of['entering','leaving']){
      const cfg=r.eca?.[dir];if(!cfg?.enabled)continue;
      const c=calc.results[i];if(!c)continue;
      const scrubber=(cfg.method||'fuel')==='scrubber';
      const f=ecaFuels(cfg,dir,i),sr=scrubber?null:ecaSystemResults(dir,cfg);
      const when=dir==='entering'?`Approaching ${esc(r.port)} · ETA ${fmtDate(c.arrivalUtc,c.utcOffset)} local`:`Leaving ${esc(r.port)} · ETD ${fmtDate(c.departureUtc,c.utcOffset)} local`;
      const detail=scrubber?'Scrubber (EGCS) — no fuel changeover planned':`${esc(ecaFuelLabel(f.from))} → ${esc(ecaFuelLabel(f.to))}${sr&&sr.planning!==null?` · planning time ${fmtH(sr.planning)}`:''}`;
      return `<div class="panel next-panel eca-ahead-panel"><h3>ECA/SECA ahead</h3><div class="next-port"><strong>${dir==='entering'?'Entering':'Leaving'} an ECA/SECA</strong><small class="muted">${when}</small><span>${detail}</span><span class="tag" data-goto-tab="eca">See full plan — ECA/SECA tab</span></div></div>`;
    }
  }
  return '';
}
function metricCard(label,value,foot,width,barClass,why){return `<div class="metric-card"${why||''}><div class="metric-label">${esc(label)}</div><div class="metric-value">${value}</div><div class="progress ${barClass||''}"><span style="width:${width||0}%"></span></div><div class="metric-foot">${esc(foot)}</div></div>`;}
function wrapMetricLabel(label,html){return html?`<div class="eyebrow metric-heading">${label}</div><div class="metric-grid-inner">${html}</div>`:'';}
function rtCell(t,unit,group,i,ph){
  if(!t)return `<div class="rt-cell"><div class="hbar ${barColorClass(group)}"><span style="width:0%"></span></div><b>—</b></div>`;
  const cap=Math.max(0,n(t.capacity)),rob=Math.max(0,n(t.rob)),u=cap?Math.min(1,rob/cap):0,over=cap>0&&rob>cap+1e-9,over85=cap>0&&!over&&rob>cap*bunkerFillFrac()+1e-9;
  return `<div class="rt-cell"${i!==undefined?W('rob',{i,g:group,t:t.id,ph}):''}><div class="hbar ${barColorClass(group)} ${over?'over':''} ${over85?'over85':''}"><span style="width:${(u*100).toFixed(1)}%"></span></div><b>${fmtN(rob,unit)}${cap?`/${fmtN(cap,unit)}`:''}</b></div>`;
}
/* Tank display order must match the Tanks tab (drag/move order, i.e. t.order) rather than raw
   insertion order in state.tanks — keeps Dashboard and Bunkering tank lists consistent with
   what the user arranged under Tanks. */
function sortTankIdsByDisplayOrder(ids){
  const orderIndex=new Map(state.tanks.map((t,idx)=>[t.id,n(t.order)]));
  return [...ids].sort((a,b)=>(orderIndex.get(a)??0)-(orderIndex.get(b)??0));
}
/* Tank name with its fuel type printed underneath (fuel groups only). */
function tankNameHtml(name,group,srcTank){
  const ft=fuelTypeOptions(group)?`<small class="rt-ft">${esc(fuelTypeLabel(group,(srcTank&&srcTank.fuelType)||defaultFuelType(group)))}</small>`:'';
  return `<span class="rt-nm"><span>${esc(name)}</span>${ft}</span>`;
}

/* ---------- Tap-to-explain: "where did this value come from and how" ---------- */
function W(kind,o={}){
  const a=Object.entries(o).filter(([,v])=>v!==undefined&&v!==null).map(([k,v])=>` data-${k}="${esc(String(v))}"`).join('');
  return ` data-why="${kind}"${a} role="button" tabindex="0" title="Tap to see how this is calculated"`;
}
function ratesFor(g,i){
  const p=getProfile(g);if(!p)return{sea:0,port:0,anchor:0,basis:0};
  const isFuel=state.fuels.some(f=>f.id===g),ef=isFuel?effectiveFuelRates(p,resolveFoActiveFuel(p,state.route[i])):p;
  return{sea:rateFor(ef,'sea'),port:rateFor(ef,'port'),anchor:Math.max(0,n(ef.anchorRate)),basis:Math.max(0,n(ef.reserveRate))||Math.max(0,n(ef.seaRate))};
}
function whyInfo(d){
  const i=d.i!==undefined?Number(d.i):null,r=i!==null?calc.results[i]:null,g=d.g,gl=g?groupLabel(g):'',u=g?unitFor(g):'MT';
  const q=(v,gg)=>fmtQty(v,gg?unitFor(gg):u),L=[];let title='',value='',src='';
  const stop=i!==null?state.route[i]:null,pname=r?r.port:'';
  const legIn=()=>{if(!r)return;if(i===0)L.push(stop?.eta?`First port: the exact ETA typed in the Voyage tab (${esc(stop.eta.replace('T',' '))}).`:`First port: arrival = voyage start (UTC) from Setup, ${esc(fmtUTC(state.meta.startUtc))}.`);else{const pv=calc.results[i-1];L.push(`Departure from ${esc(pv.port)}: ${esc(fmtUTC(pv.departureUtc))}`);L.push(`+ sea time = ${n(r.distanceNm).toFixed(1)} NM ÷ ${n(r.speedKn)} kn ÷ 24 = ${days(r.seaDays)} d`);}};
  const sumUse=(usage)=>n(usage?.[g]);
  const kpi=r?{sea:sumUse(r.seaUsage),anc:sumUse(r.anchorUsage),port:sumUse(r.portUsage),bunk:n(r.bunkerInfo?.[g]?.allocated),arr:n(r.arrivalFuel?.[g]!==undefined?r.arrivalFuel[g]:r.arrivalLube?.[g]),dep:n(r.departureFuel?.[g]!==undefined?r.departureFuel[g]:r.departureLube?.[g]),prev:g?groupRob(r.tankBefore||[],g):0}:null;
  switch(d.why){
    case 'stops':title='Stops';value=String(calc.results.length);L.push('Counted from the ports entered in the Voyage tab:');L.push(esc(calc.results.map(x=>x.port).join(' → ')||'none yet'));break;
    case 'duration':{title='Duration';const last=calc.results.at(-1);value=last?`${calc.totals.totalVoyageDays.toFixed(2)} d`:'—';if(last){L.push(`Voyage start (Setup): ${esc(fmtUTC(state.meta.startUtc))}`);L.push(`Departure from last port (${esc(last.port)}): ${esc(fmtUTC(last.departureUtc))}`);L.push(`Duration = last departure − voyage start = ${calc.totals.totalVoyageDays.toFixed(2)} days`);L.push('It adds up every sea leg (distance ÷ speed ÷ 24), anchor/drift time and port stay.');}break;}
    case 'alerts':{title='Alerts';const cap=calc.results.reduce((c,x)=>c+x.tankAfter.filter(t=>n(t.capacity)>0&&n(t.rob)>n(t.capacity)+1e-9).length,0),sh=calc.totals.shortages.length,below=calc.results.reduce((c,x)=>c+Object.values(x.fuelStatus).filter(z=>z.belowReserve).length,0);value=String(cap+sh+below);L.push(`Tanks above capacity after a port: ${cap}`);L.push(`Shortages / allocation problems: ${sh}`);L.push(`Fuel departures below reserve: ${below}`);L.push(`Total = ${value}. Tap the bell icon in the top bar to read each alert.`);break;}
    case 'nextport':{const st=activePosition();title='Next port';value=st.next||'—';L.push('The first port in the route that the vessel has not yet departed, judged by the current date/time against each ETA and ETD.');L.push(esc(st.detail||''));break;}
    case 'position':{const st=activePosition();title='Present position';value=state.meta.currentPosition||'Not entered';L.push('The text is what you entered under Setup › Present position.');L.push(`Status “${esc(st.label)}” comes from comparing the current date/time with each port’s ETA/ETD.`);L.push(esc(st.detail||''));break;}
    case 'progress':{const st=activePosition();title='Voyage progress';value=`${Math.round(st.progress)}%`;L.push('Progress = (time of the last completed departure − voyage start) ÷ (final departure − voyage start).');L.push(`Voyage start: ${esc(fmtUTC(state.meta.startUtc))}`);const last=calc.results.at(-1);if(last)L.push(`Final departure: ${esc(fmtUTC(last.departureUtc))}`);L.push('While underway it is interpolated between the two ports using elapsed time.');break;}
    case 'gcard':{title=`${gl} ROB`;const last=calc.results.at(-1),rob=n(last?.departureFuel?.[g]??last?.departureLube?.[g]??groupRob(state.tanks,g)),cap=tankCapacity(calc.finalTanks,g),st=last?.fuelStatus?.[g];value=q(rob);L.push(`ROB = sum of all ${esc(gl)} tanks after the last port’s consumption and bunkering: ${q(rob)}`);L.push(`Capacity = sum of tank capacities: ${q(cap)}`);L.push(`Utilisation = ${q(rob)} ÷ ${q(cap)} = ${pct(cap?rob/cap:0)}`);if(st){const rt=ratesFor(g,calc.results.length-1).basis;L.push(`Margin = (ROB ${q(rob)} − unpumpable ${q(st.unpumpable)} − reserve ${q(st.reserveQty)}) ÷ ${rt.toFixed(2)} ${u}/day = ${Number.isFinite(st.marginDays)?st.marginDays.toFixed(1)+' d':'—'}`);L.push('Reserve = reserve days × daily rate set in Setup.');}break;}
    case 'robcompare':{title=`${gl} — Noon report vs actual`;const noon=Math.max(0,n(state.meta.noonRob?.[g])),actual=groupRob(state.tanks,g),delta=actual-noon;value=q(actual);L.push(`Noon report ROB (Setup): ${q(noon)}`);L.push(`Actual tank ROB (sum of ${esc(gl)} tanks on the Tanks tab): ${q(actual)}`);L.push(`Difference = actual − noon report = ${delta>=0?'+':'−'}${q(Math.abs(delta))}`);L.push('A large difference usually means a tank ROB needs updating, or the noon report figure was entered for a different date.');break;}
    case 'eta':title=`ETA — ${pname}`;value=`${fmtDate(r.arrivalUtc,r.utcOffset)} local`;legIn();L.push(`= ${esc(fmtUTC(r.arrivalUtc))}`);L.push(`Local time = UTC ${esc(utcOffsetLabel(r.utcOffset))} → ${esc(fmtDate(r.arrivalUtc,r.utcOffset))}`);break;
    case 'etd':title=`ETD — ${pname}`;value=`${fmtDate(r.departureUtc,r.utcOffset)} local`;L.push(`ETA: ${esc(fmtUTC(r.arrivalUtc))}`);L.push(`+ anchor/drift stay ${days(r.anchorStayDays)} d`);L.push(`+ port stay ${days(r.portStayDays)} d`);L.push(`= ETD ${esc(fmtUTC(r.departureUtc))}`);L.push(`Local time = UTC ${esc(utcOffsetLabel(r.utcOffset))} → ${esc(fmtDate(r.departureUtc,r.utcOffset))}`);break;
    case 'portstay':title=`Time at ${pname}`;value=`${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h`;L.push('Port stay is entered in the Voyage tab (days + hours).');if(r.anchorStayDays>0)L.push(`Anchor/drift time before berthing: ${days(r.anchorStayDays)} d (also entered there).`);L.push(`Total ETA → ETD = anchor/drift + port stay = ${days(r.anchorStayDays+r.portStayDays)} d`);break;
    case 'distance':title='Distance';value=`${n(r.distanceNm).toFixed(1)} NM`;L.push(i===0?'First port: normally 0 NM (start point).':`Entered in the Voyage tab as the distance from ${esc(calc.results[i-1].port)} to ${esc(pname)}.`);break;
    case 'speed':title='Speed';value=`${n(r.speedKn).toFixed(1)} kn`;L.push('Planning speed entered in the Voyage tab for this leg. It is not measured — it drives the sailing time.');break;
    case 'seadays':title='Steaming days';value=`${days(r.seaDays)} d (${daysHours(r.seaDays)})`;L.push(i===0?'First port: no sailing leg, so 0 days.':`= distance ${n(r.distanceNm).toFixed(1)} NM ÷ speed ${n(r.speedKn)} kn ÷ 24 = ${days(r.seaDays)} days`);break;
    case 'cons':{const ph=d.ph,dd=ph==='sea'?r.seaDays:ph==='port'?r.portStayDays:r.anchorStayDays,usage=ph==='sea'?r.seaUsage:ph==='port'?r.portUsage:r.anchorUsage;title=`${ph==='sea'?'At sea':ph==='port'?'In port':'At anchor/drift'} consumption — ${pname}`;value=formatConsumption(usage);L.push(`Time: ${days(dd)} d ${ph==='sea'?'(distance ÷ speed ÷ 24)':'(from the Voyage tab)'}`);[...state.fuels,...state.lubes].forEach(pf=>{const rt=ratesFor(pf.id,i),rate=ph==='sea'?rt.sea:ph==='port'?rt.port:rt.anchor,v=n(usage?.[pf.id]);if(v>0||rate>0)L.push(`${esc(pf.name)}: ${rate.toFixed(2)} ${pf.unit}/day × ${days(dd)} d = ${fmtQty(v,pf.unit)}`);});L.push('Daily rates come from Setup › Consumption rates.');break;}
    case 'rob':{const id=d.t,b=(r.tankBefore||[]).find(x=>x.id===id),a=(r.tankAtArrival||[]).find(x=>x.id===id),f=(r.tankAfter||[]).find(x=>x.id===id),tn=(a||f||b||{}).name||id,cap=n((a||f||b||{}).capacity);
      const bunk=n((r.bunkerInfo?.[g]?.allocations||[]).find(x=>x.tankId===id)?.quantity);title=`${tn} — ROB at ${d.ph==='eta'?'ETA':'ETD'}`;
      if(d.ph==='eta'){value=q(a?.rob);L.push(`ROB before this leg: ${q(b?.rob)} ${i===0?'(present ROB from the Tanks tab)':'(departure ROB of the previous port)'}`);L.push(`− drawn from this tank during the sea leg: ${q(n(b?.rob)-n(a?.rob))}`);L.push(`= ROB at ETA: ${q(a?.rob)}`);L.push('Consumption is drawn from tanks in the consumption sequence set in the Tanks tab (Sequence 1 first), moving to the next when a tank runs empty.');}
      else{value=q(f?.rob);L.push(`ROB at ETA: ${q(a?.rob)}`);L.push(`− anchor/port consumption drawn from this tank: ${q(n(a?.rob)+bunk-n(f?.rob))}`);L.push(`+ bunker / replenishment received into this tank: ${q(bunk)}`);L.push(`= ROB at ETD: ${q(f?.rob)}`);}
      if(cap>0)L.push(`Tank capacity ${q(cap)} → ${pct(n((d.ph==='eta'?a:f)?.rob)/cap)} full.`);break;}
    case 'gtotal':title=`${gl} total ROB — ${pname}`;value=`${q(kpi.arr)} → ${q(kpi.dep)}`;L.push(`At ETA = previous departure ${q(kpi.prev)} − sea consumption ${q(kpi.sea)} = ${q(kpi.arr)}`);L.push(`At ETD = ETA ${q(kpi.arr)} − anchor ${q(kpi.anc)} − port ${q(kpi.port)} + bunker received ${q(kpi.bunk)} = ${q(kpi.dep)}`);L.push('Both are the sum of every tank in this group (see the tank rows above).');break;
    case 'arr':title=`${gl} ROB on arrival — ${pname}`;value=q(kpi.arr);L.push(`Previous departure ROB: ${q(kpi.prev)}`);L.push(`− sea consumption on this leg: ${q(kpi.sea)}`);L.push(`= ROB on arrival: ${q(kpi.arr)} (never carried below zero — a shortage is flagged instead)`);break;
    case 'dep':{title=`${gl} ROB on departure — ${pname}`;value=q(kpi.dep);L.push(`ROB on arrival: ${q(kpi.arr)}`);L.push(`− anchor/drift consumption: ${q(kpi.anc)}`);L.push(`− port consumption: ${q(kpi.port)}`);L.push(`+ bunker received: ${q(kpi.bunk)}`);L.push(`= ROB on departure: ${q(kpi.dep)}`);const st=r.fuelStatus?.[g];if(st){L.push(`Utilisation = ${q(st.rob)} ÷ capacity ${q(st.capacity)} = ${pct(st.utilization)}`);L.push(`Margin = (ROB − unpumpable ${q(st.unpumpable)} − reserve ${q(st.reserveQty)}) ÷ ${ratesFor(g,i).basis.toFixed(2)} ${u}/day = ${Number.isFinite(st.marginDays)?st.marginDays.toFixed(1)+' d':'—'}`);if(st.belowReserve)L.push('⚠ Usable ROB is below the reserve, so this departure is flagged.');}break;}
    case 'req':{title=`Required bunker — ${pname}`;const st=r.fuelStatus[g];let rem=0,fut=0;calc.results.forEach((x,j)=>{if(j>=i)rem+=n(x.seaUsage[g])+n(x.anchorUsage[g])+n(x.portUsage[g]);if(j>i)fut+=n(x.bunkerInfo?.[g]?.allocated);});value=q(st.bunkerRequiredNow);L.push(`Consumption from this port’s leg to the end of the voyage: ${q(rem)}`);L.push(`+ reserve (${q(st.reserveQty)}) + unpumpable (${q(st.unpumpable)})`);L.push(`− ROB on departure: ${q(kpi.dep)}`);L.push(`− bunkers already planned at later ports: ${q(fut)}`);L.push(`= ${q(st.bunkerRequiredNow)} (never below zero)`);L.push('It is the extra quantity you would still need to bunker here to finish the voyage with the reserve intact.');break;}
    case 'ctotal':{title=`${gl} total consumption`;value=q(calc.totals.consumption[g]);L.push(`At sea: ${q(calc.totals.seaConsumption[g])}`);L.push(`At anchor/drift: ${q(calc.totals.anchorConsumption?.[g])}`);L.push(`In port: ${q(calc.totals.portConsumption[g])}`);L.push('Each leg = daily rate (Setup) × days (Voyage tab); the totals add up all legs.');break;}
    case 'alert':{if(d.a==='cap'){const t=(r.tankAfter||[]).find(x=>x.id===d.t);title='Tank over capacity';value=t?t.name:'';L.push(`Tank ROB after ${esc(pname)}: ${q(t?.rob,t?.group)}`);L.push(`Tank capacity: ${q(t?.capacity,t?.group)}`);L.push('The alert appears when ROB (including any bunker allocated) is above the capacity entered in the Tanks tab.');}
      else if(d.a==='over85'){const t=(r.tankAfter||[]).find(x=>x.id===d.t),maxf=bunkerFillFrac();title='Above maximum fill';value=t?t.name:'';L.push(`Tank ROB after ${esc(pname)}: ${q(t?.rob,t?.group)}`);L.push(`Tank capacity: ${q(t?.capacity,t?.group)}`);L.push(`Company maximum fill: ${Math.round(maxf*100)}% = ${q(n(t?.capacity)*maxf,t?.group)}`);L.push('Set in Setup / the Bunkering tab. This does not stop the plan — it flags a tank you may want to load less into.');}
      else if(d.a==='short'){const sh=calc.totals.shortages[Number(d.x)]||{};title='Shortage';value=esc(sh.item||'');L.push(`Location / phase: ${esc(sh.location||'route')} / ${esc(sh.phase||'—')}`);L.push(`Quantity that could not be supplied or placed: ${q(sh.shortage,getProfileIdByName(sh.item))}`);L.push(esc(sh.message||'Consumption or bunkering was larger than what the tanks could provide or hold, so the balance is flagged instead of going negative.'));}
      else{const st=r.fuelStatus?.[g];title='Below reserve';value=gl;L.push(`Usable ROB at departure = ROB ${q(st?.rob)} − unpumpable ${q(st?.unpumpable)} = ${q(n(st?.rob)-n(st?.unpumpable))}`);L.push(`Reserve = reserve days × daily rate (Setup) = ${q(st?.reserveQty)}`);L.push('The alert appears when usable ROB is smaller than the reserve.');}break;}
    default:title='Value';L.push('No explanation available.');
  }
  return{title,value,lines:L};
}
function showWhy(el){
  const info=whyInfo({...el.dataset});
  $('#whyTitle').textContent=info.title;
  $('#whyValue').innerHTML=info.value||'';
  $('#whySteps').innerHTML=info.lines.map(l=>`<li>${l}</li>`).join('');
  $('#whyModal').hidden=false;
}
function renderPointDetails(index){
  const r=calc.results[index];
  const panel=$('#routePointDetails');
  if(!panel)return;
  if(!r){panel.innerHTML='<div class="empty">Tap a route point to inspect ETA/ETD, ROB and tank details.</div>';return;}
  $$('.route-node').forEach(b=>b.classList.toggle('selected',Number(b.dataset.routePoint)===index));
  const tanksEta=r.tankAtArrival||r.tankBefore||[];
  const tanksEtd=r.tankAfter||[];
  const tankIds=[...new Set([...tanksEta,...tanksEtd].map(t=>t.id))];
  const order=[...state.fuels,...state.lubes].map(p=>p.id);
  const byGroup={};
  tankIds.forEach(id=>{const t=tanksEta.find(x=>x.id===id)||tanksEtd.find(x=>x.id===id);(byGroup[t.group]||(byGroup[t.group]=[])).push(id);});
  Object.keys(byGroup).forEach(g=>{byGroup[g]=sortTankIdsByDisplayOrder(byGroup[g]);});
  const groupKeys=Object.keys(byGroup).sort((x,y)=>{const ix=order.indexOf(x),iy=order.indexOf(y);return(ix<0?99:ix)-(iy<0?99:iy);});
  const tankBlocks=groupKeys.map(g=>{
    const unit=getProfile(g)?.unit||'MT';
    const rows=byGroup[g].map(id=>{
      const a=tanksEta.find(t=>t.id===id),d=tanksEtd.find(t=>t.id===id);
      const activeEta=!!(a&&isCons(a)&&n(a.sequence)===n(r.activeAtArrival?.[a.group])+1);
      const activeEtd=!!(d&&isCons(d)&&n(d.sequence)===n(r.active?.[d.group])+1);
      const srcTank=state.tanks.find(x=>x.id===id);
      const fixedInService=srcTank&&tankInService(srcTank);
      const on=activeEta||activeEtd||fixedInService,name=a?.name||d?.name||id;
      const where=fixedInService?(srcTank.category==='settling'?'settling tank in service':'service tank in service'):(activeEta&&activeEtd?'ETA and ETD':activeEta?'ETA':'ETD');
      const bunkAlloc=(r.bunkerInfo?.[g]?.allocations||[]).find(x=>x.tankId===id),bunked=bunkAlloc&&n(bunkAlloc.quantity)>0.005;
      const bunkTagHtml=bunked?`<span class="rt-bk">${fuelTypeOptions(g)?'Bunkered':'Replenished'} +${fmtN(bunkAlloc.quantity,unit)}</span>`:'';
      return `<div class="rt-row ${on?'tank-active':''} ${bunked?'rt-bunkered':''}" ${bunked?`data-goto-bunker-port="${index}"`:`data-goto-tank="${esc(id)}"`} role="button" tabindex="0" title="${bunked?'Open this port’s bunkering on the Bunkering tab':'Open this tank on the Tanks tab'}"><div class="rt-name" title="${esc(name)}">${on?`<i class="svc-dot" title="In service — ${where}"></i>`:''}${tankNameHtml(name,g,srcTank)}${bunkTagHtml}</div>${rtCell(a,unit,g,index,'eta')}${rtCell(d,unit,g,index,'etd')}</div>`;
    }).join('');
    const arr=n(r.arrivalFuel?.[g]!==undefined?r.arrivalFuel[g]:r.arrivalLube?.[g]),dep=n(r.departureFuel?.[g]!==undefined?r.departureFuel[g]:r.departureLube?.[g]);
    const b=r.bunkerInfo?.[g];
    const bunkerLine=b&&b.quantity>0?`<div class="rt-group-bunker">Bunker ${fmtQty(b.quantity,unit)} · Allocated ${fmtQty(b.allocated,unit)}${b.unallocated>0?` · Unallocated ${fmtQty(b.unallocated,unit)}`:''}</div>`:'';
    const groupHead=esc(groupLabel(g).replace(/\s*\([^)]*\)\s*$/,''));
    return `<div class="rt-group"><div class="rt-head"><span>${groupHead} (${esc(unit)})</span><span>ETA</span><span>ETD</span></div>${rows}<div class="rt-group-total"${W('gtotal',{i:index,g})}><span>${groupHead} Total ROB</span><strong>${fmtQty(arr,unit)} → ${fmtQty(dep,unit)}</strong></div>${bunkerLine}</div>`;
  }).join('');
  const total=calc.results.length;
  const anchorLine=(r.anchorStayDays>0)?`<div${W('portstay',{i:index})}><span>At ${r.anchorMode==='drift'?'drift':'anchor'}</span><strong>${Math.floor(r.anchorStayDays)} d ${r.anchorStayHours} h</strong></div>`:'';
  const anchorConsLine=(r.anchorStayDays>0)?`<div class="detail-kpi hl"${W('cons',{i:index,ph:'anchor'})}><span>At anchor/drift consumption</span><strong>${formatConsumptionHtml(r.anchorUsage)}</strong></div>`:'';
  panel.innerHTML=`<div class="route-detail-head"><div><small>Point ${index+1} of ${total}</small><h3>${esc(r.port)}</h3></div><div class="pd-nav"><button type="button" class="icon-btn sm" data-route-point="${index-1}" aria-label="Previous port" ${index<=0?'disabled':''}>‹</button><button type="button" class="icon-btn sm" data-route-point="${index+1}" aria-label="Next port" ${index>=total-1?'disabled':''}>›</button></div></div><details class="rt-whole" data-open-key="robwhole" ${uiOpen.has('robwhole')?'open':''}><summary class="rt-title"><h4>Tank ROB at ETA → ETD</h4><span class="rt-legend"><i class="svc-dot"></i> in service</span>${ICON.chev}</summary><div class="rt-list">${tankBlocks||'<div class="empty">No tanks configured.</div>'}</div></details><div class="detail-grid"><div${W('eta',{i:index})}><span>ETA</span><strong>${fmtDate(r.arrivalUtc,r.utcOffset)}</strong><small>${fmtUTC(r.arrivalUtc)}</small></div><div${W('etd',{i:index})}><span>ETD</span><strong>${fmtDate(r.departureUtc,r.utcOffset)}</strong><small>${fmtUTC(r.departureUtc)}</small></div>${anchorLine}<div${W('portstay',{i:index})}><span>Port stay</span><strong>${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h</strong></div><div${W('distance',{i:index})}><span>Distance to last port</span><strong>${n(r.distanceNm).toFixed(1)} NM</strong></div><div${W('speed',{i:index})}><span>Estimated speed</span><strong>${n(r.speedKn).toFixed(1)} kn</strong></div><div${W('seadays',{i:index})}><span>Steaming days</span><strong>${days(r.seaDays)} d</strong><small>${daysHours(r.seaDays)}</small></div></div><div class="detail-kpis consumption-detail"><div class="detail-kpi hl"${W('cons',{i:index,ph:'sea'})}><span>At sea consumption</span><strong>${formatConsumptionHtml(r.seaUsage)}</strong></div>${anchorConsLine}<div class="detail-kpi hl"${W('cons',{i:index,ph:'port'})}><span>In port consumption</span><strong>${formatConsumptionHtml(r.portUsage)}</strong></div></div>${r.notes?`<p class="muted detail-note">${esc(r.notes)}</p>`:''}`;
}
function renderRouteSummary(activeIndex){
  const nodes=calc.results.map((r,i)=>`<button type="button" class="route-node ${i===activeIndex?'current':''} ${i===activeIndex+1?'next':''}" data-route-point="${i}"><span class="route-node-index">${i+1}</span><strong>${esc(r.port)}</strong><small>${fmtDate(r.arrivalUtc,r.utcOffset).slice(5)}</small></button>`).join('<span class="route-line" aria-hidden="true"></span>');
  const rows=calc.results.map((r,i)=>{const cls=i===activeIndex?'current-row':i===activeIndex+1?'next-row':'';const tag=i===activeIndex?'<span class="badge green">Current</span>':i===activeIndex+1?'<span class="badge">Next</span>':'';return `<tr class="${cls}" data-route-point="${i}"><td>${i+1}</td><td><strong>${esc(r.port)}</strong><div>${tag}</div></td><td${W('eta',{i})}>${fmtDate(r.arrivalUtc,r.utcOffset)}<small>${fmtUTC(r.arrivalUtc)}</small></td><td${W('etd',{i})}>${fmtDate(r.departureUtc,r.utcOffset)}<small>${fmtUTC(r.departureUtc)}</small></td><td${W('portstay',{i})}>${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h</td><td${W('distance',{i})}>${n(r.distanceNm).toFixed(1)} NM</td><td${W('speed',{i})}>${n(r.speedKn).toFixed(1)} kn</td><td${W('cons',{i,ph:'sea'})}>${formatConsumptionHtml(r.seaUsage)}</td><td${W('cons',{i,ph:'port'})}>${formatConsumptionHtml(r.portUsage)}</td></tr>`;}).join('');
  const tableOpen=tableTouched?uiOpen.has('routetable'):window.innerWidth>760;
  $('#routeSummary').innerHTML=rows?`<div class="route-timeline">${nodes}</div><div id="routePointDetails" class="route-point-details"></div><details class="fold flat" data-open-key="routetable" ${tableOpen?'open':''}><summary>Full route table</summary><div class="table-wrap"><table><thead><tr><th>#</th><th>Port</th><th>ETA</th><th>ETD</th><th>Port stay</th><th>Distance to last port</th><th>Estimated speed</th><th>Sea consumption</th><th>Port consumption</th></tr></thead><tbody>${rows}</tbody></table></div></details>`:'<div class="empty">No route yet. Add ports in the Voyage tab to build the route summary.</div>';
  if(rows)renderPointDetails(activeIndex>=0?activeIndex:0);
}

const rateHelp={seaRate:'Daily consumption while the vessel is at sea. Enter the planning rate used for this fuel/lubricant.',portRate:'Daily consumption while the vessel is alongside/in port. Use the vessel’s actual planning rate.',anchorRate:'Daily consumption while the vessel is at anchor or drifting (main engine stopped, auxiliaries/boiler only). Often lower than the sea rate — set to 0 if not tracked separately.',reserveDays:'Desired number of days remaining after the planned voyage/port event before a reserve warning is triggered.',reserveRate:'Rate used to convert reserve days into a reserve quantity. If left at zero, the sea rate is used.'};
function renderRates(){
  const profiles=[...state.fuels,...state.lubes];
  $('#ratesList').innerHTML=profiles.map(p=>{
    const isFuel=state.fuels.some(f=>f.id===p.id);
    const num=(field,label,step,help,sub)=>{const val=sub?n(p[sub]?.[field]):n(p[field]);const subAttr=sub?` data-rate-sub="${sub}"`:'';return `<div class="field"><label>${label}<input type="number" inputmode="decimal" step="${step}" min="0" data-rate-id="${p.id}"${subAttr} data-field="${field}" value="${val}"></label>${explain(label,help)}</div>`;};
    const reserveLabel=RESERVE_LABEL[p.id]||'Reserve/day';
    let foModeField='',rateGrid;
    if(p.id==='fo'){
      const mode=['hfo','both'].includes(p.foMode)?p.foMode:'vlsfo';
      foModeField=`<div class="field"><label>Fuel oil(s) used aboard<select data-rate-id="${p.id}" data-field="foMode"><option value="vlsfo" ${mode==='vlsfo'?'selected':''}>VLSFO only</option><option value="hfo" ${mode==='hfo'?'selected':''}>HFO only</option><option value="both" ${mode==='both'?'selected':''}>Both VLSFO and HFO</option></select></label>${explain('Fuel oil(s) used','Choose whether this vessel burns VLSFO, HFO, or switches between both (e.g. HFO outside an ECA/SECA, VLSFO inside). "Both" shows separate consumption rates for each and lets every route leg say which one is actually in use — it also drives the no-mixing bunkering rule for VLSFO automatically.')}</div>`;
      if(mode==='both')foModeField+=`<div class="field"><label class="check"><input type="checkbox" data-rate-id="${p.id}" data-field="sameAsVlsfo" ${p.sameAsVlsfo?'checked':''}> VLSFO and HFO have the same consumption rates</label>${explain('Same consumption rates','When checked, HFO uses the same at-sea/in-port/at-anchor rates, reserve days and reserve rate as VLSFO — the separate HFO fields below are hidden.')}</div>`;
      const grid=(label,sub)=>`<div class="rate-card-grid">${num('seaRate',`At sea/day (${label})`,'0.01',rateHelp.seaRate,sub)}${num('portRate',`In port/day (${label})`,'0.01',rateHelp.portRate,sub)}${num('anchorRate',`At anchor/drift/day (${label})`,'0.01',rateHelp.anchorRate,sub)}${num('reserveDays',`Reserve days (${label})`,'0.1',rateHelp.reserveDays,sub)}${num('reserveRate',`${reserveLabel} (${label})`,'0.01',rateHelp.reserveRate,sub)}</div>`;
      rateGrid=mode==='vlsfo'?grid('VLSFO',null):mode==='hfo'?grid('HFO','hfo'):(p.sameAsVlsfo?`<div class="fo-both-label">VLSFO & HFO (same rates)</div>${grid('VLSFO',null)}`:`<div class="fo-both-label">VLSFO</div>${grid('VLSFO',null)}<div class="fo-both-label">HFO</div>${grid('HFO','hfo')}`);
    }else if(p.id==='do'){
      const grid=(label,sub)=>`<div class="rate-card-grid">${num('seaRate',`At sea/day (${label})`,'0.01',rateHelp.seaRate,sub)}${num('portRate',`In port/day (${label})`,'0.01',rateHelp.portRate,sub)}${num('anchorRate',`At anchor/drift/day (${label})`,'0.01',rateHelp.anchorRate,sub)}</div>`;
      foModeField=`<div class="field"><label class="check"><input type="checkbox" data-rate-id="${p.id}" data-field="doEcaSplit" ${p.doEcaSplit?'checked':''}> Different consumption rate inside an ECA/SECA</label>${explain('Inside-ECA rate','When checked, set a separate at-sea/in-port/at-anchor rate for while the vessel is inside an ECA/SECA (e.g. running on a compliant blend or different load). It applies automatically on legs and port stays between an “entering” and the matching “leaving” on the ECA/SECA tab — reserve days and reserve/day stay the ones above.')}</div>`;
      rateGrid=`<div class="fo-both-label">Outside ECA/SECA</div>${grid('outside',null)}${num('reserveDays','Reserve days','0.1',rateHelp.reserveDays)}${num('reserveRate',reserveLabel,'0.01',rateHelp.reserveRate)}${p.doEcaSplit?`<div class="fo-both-label">Inside ECA/SECA</div>${grid('inside','insideEca')}`:''}`;
    }else{
      rateGrid=`<div class="rate-card-grid">${num('seaRate','At sea/day','0.01',rateHelp.seaRate)}${num('portRate','In port/day','0.01',rateHelp.portRate)}${num('anchorRate','At anchor/drift/day','0.01',rateHelp.anchorRate)}${num('reserveDays','Reserve days','0.1',rateHelp.reserveDays)}${num('reserveRate',reserveLabel,'0.01',rateHelp.reserveRate)}</div>`;
    }
    return `<div class="item-card rate-card ${isFuel?'is-fuel':'is-lube'}"><div class="rate-top"><span class="tag">${isFuel?'Fuel':'Lube'} (${esc(p.unit)})</span><div class="field"><input class="big-input" aria-label="Name" data-rate-id="${p.id}" data-field="name" value="${esc(p.name)}">${explain('Name','Shown throughout the dashboard and tank list.')}</div></div>${foModeField}${rateGrid}<span class="help">Reserve quantity = reserve days × reserve/day. These are planning inputs; verify them against vessel records and company requirements.</span></div>`;
  }).join('');
}
function tankDefaultName(group,category='storage'){
  const presets=(NAME_PRESETS[group]&&NAME_PRESETS[group][category])||null;
  const used=new Set(state.tanks.map(t=>t.name));
  if(presets){const free=presets.find(p=>!used.has(p));if(free)return free;}
  const count=state.tanks.filter(t=>t.group===group).length+1;
  return `${groupLabel(group)} Tank ${count}`;
}
function nameOptionsFor(group,category){return(NAME_PRESETS[group]&&NAME_PRESETS[group][category])||[];}
function normalizeSequence(group){const arr=consumptionOrder(state.tanks.filter(t=>t.group===group&&isCons(t)));arr.forEach((t,i)=>t.sequence=i+1);}
function nextOrder(group){return state.tanks.filter(t=>t.group===group).reduce((m,t)=>Math.max(m,n(t.order)),-1)+1;}
function orderedGroupTanks(group){return state.tanks.map((t,i)=>({t,i})).filter(x=>x.t.group===group).sort((a,b)=>n(a.t.order)-n(b.t.order)||a.i-b.i);}
function moveTankOrder(i,dir){
  const t=state.tanks[i];if(!t)return;
  const arr=orderedGroupTanks(t.group).map(x=>x.t);
  const pos=arr.findIndex(x=>x===t);
  const target=dir==='up'?pos-1:pos+1;
  if(pos<0||target<0||target>=arr.length)return;
  const a=arr[pos],b=arr[target],tmp=a.order;a.order=b.order;b.order=tmp;
}
function moveRoute(i,dir){
  const target=dir==='up'?i-1:i+1;
  if(target<0||target>=state.route.length)return;
  const tmp=state.route[i];state.route[i]=state.route[target];state.route[target]=tmp;
}
function barColorClass(group){return group==='fo'?'bar-fo':group==='do'?'bar-do':'bar-lo';}
function tankSummaryBits(t){
  const unit=getProfile(t.group)?.unit||'MT',cap=Math.max(0,n(t.capacity)),rob=Math.max(0,n(t.rob)),util=cap?rob/cap:0;
  return{unit,cap,rob,util,cls:util>1?'danger':util>.9?'warn':'',over85:util>bunkerFillFrac()&&util<=1+1e-9,bar:barColorClass(t.group),qty:`${fmtN(rob,unit)} / ${fmtN(cap,unit)} ${unit}`,pct:`${Math.round(util*100)}%`,width:Math.min(100,Math.max(0,util*100))};
}
const CATEGORY_LABEL={storage:'Storage / active',settling:'Settling tank',service:'Service tank',support:'Support / fixed ROB'};
function tankCard(t,i,groupOrder){
  const b=tankSummaryBits(t),unit=b.unit,consumable=isCons(t),fixedRole=isFixedRole(t);
  const groups=[...state.fuels,...state.lubes];
  const groupTanks=tanksFor(t.group,true),seq=Math.max(1,groupTanks.findIndex(x=>x.id===t.id)+1);
  const seqField=consumable
    ?`<div class="field"><label>Sequence<select data-tank-sequence="${i}">${Array.from({length:Math.max(1,groupTanks.length)},(_,k)=>`<option value="${k+1}" ${k+1===seq?'selected':''}>${k+1}${k===0?' (first)':''}</option>`).join('')}</select></label>${explain('Consumption sequence','Only consumable fuel/storage tanks use a sequence. Sequence 1 is consumed first.')}</div>`
    :`<div class="fixed-rob-note"><strong>Fixed ROB</strong><small>Counted in total ROB, not drained automatically.</small></div>`;
  const move=`<div class="sequence-actions"><button type="button" class="icon-btn" data-move-order="${i}" data-direction="up" aria-label="Move tank up in list" title="Move up">${ICON.up}</button><button type="button" class="icon-btn" data-move-order="${i}" data-direction="down" aria-label="Move tank down in list" title="Move down">${ICON.down}</button></div>`;
  const key='tank:'+t.id;
  const presets=nameOptionsFor(t.group,t.category);
  const useCustomName=t.nameCustom===true||(presets.length>0&&!presets.includes(t.name));
  const nameField=presets.length
    ?`<div class="field f-wide"><label>Tank name<select data-tank-index="${i}" data-field="namePreset">${presets.map(p=>`<option value="${esc(p)}" ${!useCustomName&&t.name===p?'selected':''}>${esc(p)}</option>`).join('')}<option value="${CUSTOM_NAME}" ${useCustomName?'selected':''}>Custom (type manually)</option></select></label>${explain('Tank name','Pick a default name for this fuel/lube group and role, or choose Custom to type your own.')}<input data-tank-index="${i}" data-field="name" class="manual-name-input" value="${esc(t.name)}" placeholder="${esc(tankDefaultName(t.group,t.category))}" autocomplete="off" ${useCustomName?'':'hidden'}></div>`
    :`<div class="field f-wide"><label>Tank name<input data-tank-index="${i}" data-field="name" value="${esc(t.name)}" placeholder="${esc(tankDefaultName(t.group,t.category))}" autocomplete="off"></label>${explain('Tank name','Physical tank identification used throughout the plan and export.')}</div>`;
  return `<details class="item-card tank-card ${consumable?'':'fixed-tank'}" id="tankcard-${esc(t.id)}" data-open-key="${key}" data-tank-card="${i}" ${uiOpen.has(key)?'open':''}>
    <summary class="tank-sum"><span class="seq-chip ${consumable?'':'fixed'}" title="${consumable?'Consumption order':'Fixed ROB tank'}">${consumable?seq:'F'}</span><span class="tk-main"><span class="tk-title">${esc(t.name||tankDefaultName(t.group,t.category))}</span><span class="tk-qty">${fuelTypeOptions(t.group)?`<span class="tk-fueltype">${esc(fuelTypeLabel(t.group,t.fuelType||defaultFuelType(t.group)))}</span> · `:''}${b.qty}</span></span><span class="tk-side"><span class="tk-pct">${b.pct}</span>${ICON.chev}</span><span class="tank-bar tk-bar ${b.bar} ${b.cls} ${b.over85?'over85':''}"><span style="width:${b.width}%"></span></span></summary>
    <div class="tank-body">
      <div class="tank-fields">
        <div class="field"><label>Tank role<select data-tank-index="${i}" data-field="category"><option value="storage" ${t.category==='storage'?'selected':''}>${CATEGORY_LABEL.storage}</option><option value="settling" ${t.category==='settling'?'selected':''}>${CATEGORY_LABEL.settling}</option><option value="service" ${t.category==='service'?'selected':''}>${CATEGORY_LABEL.service}</option><option value="support" ${t.category==='support'?'selected':''}>${CATEGORY_LABEL.support}</option></select></label>${explain('Tank role','Settling/service/support tanks are excluded from automatic consumption but remain in total ROB.')}</div>
        <div class="field"><label>Group<select data-tank-index="${i}" data-field="group">${groups.map(g=>`<option value="${g.id}" ${t.group===g.id?'selected':''}>${esc(g.name)}</option>`).join('')}</select></label>${explain('Group','Select which fuel or lubricant this tank belongs to.')}</div>
        ${fuelTypeOptions(t.group)?`<div class="field f-wide"><label>Fuel type${manualPickHtml(fuelTypeOptions(t.group),t.fuelType||defaultFuelType(t.group),`data-mp="tank" data-tank-index="${i}"`,'Type fuel type')}</label>${explain('Fuel type','The grade this tank is dedicated to (pick from the list or type your own). New VLSFO can never be mixed with old VLSFO, so it needs an empty VLSFO tank. HFO, diesel oil and biodiesel may be topped up into a tank holding the same type.')}</div>`:''}
        ${nameField}
        ${fuelTypeOptions(t.group)&&t.capUnit!=='weight'?`<div class="field f-num"><label>Density (t/m³)<input type="number" inputmode="decimal" step="0.001" min="0.5" max="1.2" data-tank-index="${i}" data-field="density" value="${n(t.density||0.95)}"></label>${explain('Density','Average density of this fuel/diesel grade, used to convert the tank’s volume (m³) to tonnes (MT) for the ROB, consumption and bunkering calculations.')}</div><div class="field f-num"><label>Capacity (m³)<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="capacityM3" value="${n(t.capacityM3||(n(t.density)?n(t.capacity)/n(t.density):0))}"></label>${explain('Capacity','Tank capacity by volume. Converted to tonnes using the density above.')}<span class="cap-mt">≈ ${fmtN(t.capacity,unit)} ${esc(unit)}</span></div>`
        :`<div class="field f-num"><label>Capacity (${esc(unit)})<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="capacity" value="${n(t.capacity)}"></label>${explain('Capacity','Approved/calibrated planning capacity for this tank.'+(fuelTypeOptions(t.group)?' Entered directly in weight, as chosen when this tank was added.':''))}</div>`}
        ${fuelTypeOptions(t.group)&&t.capUnit!=='weight'?`<div class="field f-num"><label>Corrected GOV (m³)<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="robVolumeM3" value="${n(t.robVolumeM3)}"></label>${explain('Corrected GOV','Sounded/dipped tank volume at the planning start point, already corrected for trim, list and the tank calibration table (from the ullage report) — not yet temperature-corrected.')}</div><div class="field f-num"><label>Observed temperature (°C)<input type="number" inputmode="decimal" step="0.1" data-tank-index="${i}" data-field="robTempC" value="${n(t.robTempC!==undefined?t.robTempC:15)}"></label>${explain('Observed temperature','Fuel temperature in the tank when sounded. Used with the density above — ASTM Table 54B corrects the volume to 15°C, then Table 56 converts it to weight in air.')}</div><div class="field f-num rob-computed"><span>Present ROB (computed)</span><strong class="rob-computed-val">${fmtN(t.rob,unit)} ${esc(unit)}</strong><small class="rob-computed-note">ASTM 54B/56, from GOV × density</small></div>`
        :`<div class="field f-num"><label>Present ROB (${esc(unit)})<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="rob" value="${n(t.rob)}"></label>${explain('Present ROB','Current accepted onboard quantity at the planning start point.'+(fuelTypeOptions(t.group)?' Entered directly in weight, as chosen when this tank was added.':''))}</div>`}
        <div class="field f-num"><label>Unpumpable (${esc(unit)})<input type="number" inputmode="decimal" step="0.01" min="0" data-tank-index="${i}" data-field="unpumpable" value="${n(t.unpumpable)}"></label>${explain('Unpumpable','Quantity retained as unavailable for consumption/reserve calculations.')}</div>
      </div>
      <div class="tank-opts">
        ${seqField}
      </div>
      <div class="tank-foot"><label class="check"><input type="checkbox" data-tank-index="${i}" data-field="consumable" ${t.consumable!==false?'checked':''}> Consume automatically</label><button type="button" class="danger ghost sm" data-remove-tank="${i}">${ICON.trash}<span>Remove</span></button><div class="foot-move" role="group" aria-label="Move tank position">${move}</div></div>
    </div>
  </details>`;
}
function renderTanks(){
  renderMaxFillBar();
  const groups=[...state.fuels,...state.lubes],ids=groups.map(g=>g.id);
  const section=(id,title,unit)=>{
    const items=orderedGroupTanks(id);
    const rob=items.reduce((a,x)=>a+Math.max(0,n(x.t.rob)),0),cap=items.reduce((a,x)=>a+Math.max(0,n(x.t.capacity)),0);
    return `<div class="tank-group"><div class="tg-head"><div><strong>${esc(title)}</strong><small>${items.length?`${fmtN(rob,unit)} / ${fmtN(cap,unit)} ${esc(unit)} in ${items.length} tank${items.length>1?'s':''}`:'No tanks yet'}</small></div>${id?`<button type="button" class="ghost sm" data-add-tank="${esc(id)}">${ICON.plus}<span>Tank</span></button>`:''}</div>${items.map((x,pos)=>tankCard(x.t,x.i,pos+1)).join('')}</div>`;
  };
  let html=groups.map(g=>section(g.id,g.name,g.unit)).join('');
  if(state.tanks.some(t=>!ids.includes(t.group))){
    const items=state.tanks.map((t,i)=>({t,i})).filter(x=>!ids.includes(x.t.group));
    html+=`<div class="tank-group"><div class="tg-head"><div><strong>Other tanks</strong></div></div>${items.map((x,pos)=>tankCard(x.t,x.i,pos+1)).join('')}</div>`;
  }
  $('#tankList').innerHTML=html;
  renderTankSequenceSummary();
}
function renderTankSequenceSummary(){
  $('#activeTankList').innerHTML=[...state.fuels,...state.lubes].map(p=>{const ts=tanksFor(p.id,true);return `<div class="sequence-box"><strong>${esc(p.name)}</strong>${ts.length?ts.map((t,idx)=>`<div class="sequence-item"><span><span class="badge">${idx+1}</span> ${esc(t.name)}</span><strong>${fmtQty(t.rob,p.unit)}</strong></div>`).join(''):'<div class="muted">No automatic-consumption tanks configured.</div>'}</div>`;}).join('');
}
function syncTankCard(i){
  const t=state.tanks[i],card=document.querySelector(`[data-tank-card="${i}"]`);if(!t||!card)return;
  const b=tankSummaryBits(t);
  card.querySelector('.tk-title').textContent=t.name||tankDefaultName(t.group,t.category);
  const qtyEl=card.querySelector('.tk-qty'),hasFt=!!qtyEl.querySelector('.tk-fueltype');qtyEl.innerHTML=hasFt?`<span class="tk-fueltype">${esc(fuelTypeLabel(t.group,t.fuelType||defaultFuelType(t.group)))}</span> · ${esc(b.qty)}`:esc(b.qty);card.querySelector('.tk-pct').textContent=b.pct;
  const bar=card.querySelector('.tk-bar');bar.className=`tank-bar tk-bar ${b.bar} ${b.cls} ${b.over85?'over85':''}`;bar.firstElementChild.style.width=`${b.width}%`;
  const capMt=card.querySelector('.cap-mt');if(capMt)capMt.textContent=`≈ ${fmtN(t.capacity,b.unit)} ${b.unit}`;
  const robVal=card.querySelector('.rob-computed-val');if(robVal)robVal.textContent=`${fmtN(t.rob,b.unit)} ${b.unit}`;
}
function routeMeta(r){const anchor=(Math.max(0,n(r.anchorStayDays))||Math.max(0,n(r.anchorStayHours)))?`, ${Math.floor(n(r.anchorStayDays))}d ${n(r.anchorStayHours)}h at ${r.anchorMode==='drift'?'drift':'anchor'}`:'';const fuelTag=getProfile('fo')?.foMode==='both'?`, ${r.foActiveFuel==='hfo'?'HFO':'VLSFO'}`:'';return `${n(r.distanceNm).toFixed(0)} NM at ${n(r.speedKn)} kn${anchor}, port stay ${Math.floor(n(r.portStayDays))} d ${n(r.portStayHours)} h${fuelTag}`;}
/* Position along the leg (previous departure -> this arrival, or this departure -> next arrival)
   at a given absolute time T, by simple time-fraction interpolation over the leg's distance — the
   app has no port coordinates, so position is expressed relative to the two end ports. */
function positionAtTime(legStartMs,legEndMs,distanceNm,T){
  const span=legEndMs-legStartMs,frac=span>0?Math.max(0,Math.min(1,(T-legStartMs)/span)):1;
  return{frac,nmRun:frac*n(distanceNm),nmLeft:(1-frac)*n(distanceNm)};
}
/* ---------------------------------------------------------------------------------------------
   ECA / SECA fuel change-over — FOBAS-style, calculated separately for the Main Engine, the Aux.
   Engine(s) and the Boiler(s) using the formulas of FOBAS_Changeover_Calculator_with_Formulas.xlsx
   (see fobasChangeover() in core.js). The vessel is ready when the slowest system has finished.
   --------------------------------------------------------------------------------------------- */
const ECA_SYSTEMS=[{key:'me',label:'Main Engine',color:'#ffc63a'},{key:'ae',label:'Aux. Engine',color:'#5ec8ff'},{key:'boiler',label:'Boiler',color:'#ff8a8a'}];
const fmtH=h=>h===null||h===undefined||!Number.isFinite(h)?'—':`${h.toFixed(1)} h`;
const iso=ms=>new Date(ms).toISOString();
function ecaSystemResults(dir,cfg){
  const enter=dir==='entering',from=n(cfg.fromSulphurPct),to=n(cfg.toSulphurPct);
  const req=enter?n(cfg.limitPct):to-0.05*(to-from);
  const list=ECA_SYSTEMS.map(s=>{
    const c=cfg[s.key]||{};
    if(c.on===false)return{...s,skipped:true};
    return{...s,c,res:fobasChangeover({rate:c.rate,qty:c.qty,fromS:from,toS:to,reqS:req,mode:enter?'down':'up'})};
  });
  const done=list.filter(x=>!x.skipped&&x.res.valid&&x.res.planning!==null);
  return{list,req,from,to,planning:done.length?Math.max(...done.map(x=>x.res.planning)):null,anyProblem:list.some(x=>!x.skipped&&(!x.res.valid||x.res.planning===null))};
}
function niceScale(raw){
  for(const step of [0.01,0.02,0.05,0.1,0.2,0.25,0.5,1,2,5,10]){if(raw/step<=6)return{step,max:Math.ceil(raw/step-1e-9)*step};}
  return{step:10,max:Math.ceil(raw/10)*10};
}
/* "Sulphur at engine inlet vs time" — same two series per system as the workbook's chart
   (solid = step method, dashed = exact continuous mixing), over 0–20 h. */
function ecaChartHtml(dir,sr){
  const shown=sr.list.filter(x=>!x.skipped&&x.res.valid&&x.res.curve.length);
  if(!shown.length)return'';
  const XMAX=20,W=340,H=228,L=42,Rm=12,Tm=14,Bm=46,pw=W-L-Rm,ph=H-Tm-Bm;
  const {step,max:ymax}=niceScale(Math.max(sr.from,sr.to,sr.req,0.05)*1.04);
  const X=t=>L+t/XMAX*pw,Y=s=>Tm+ph-Math.max(0,Math.min(ymax,s))/ymax*ph;
  const dec=step<0.1?2:step<1?1:0;
  let grid='';
  for(let v=0;v<=ymax+1e-9;v+=step){grid+=`<line class="grid" x1="${L}" x2="${W-Rm}" y1="${Y(v).toFixed(1)}" y2="${Y(v).toFixed(1)}"/><text x="${L-5}" y="${(Y(v)+3).toFixed(1)}" text-anchor="end">${v.toFixed(dec)}</text>`;}
  for(let t=0;t<=XMAX;t+=2){grid+=`<line class="grid v" x1="${X(t).toFixed(1)}" x2="${X(t).toFixed(1)}" y1="${Tm}" y2="${Tm+ph}"/><text x="${X(t).toFixed(1)}" y="${Tm+ph+13}" text-anchor="middle">${t}</text>`;}
  const pts=c=>c.map(([t,s])=>`${X(t).toFixed(1)},${Y(s).toFixed(1)}`).join(' ');
  const lines=shown.map(x=>`<g class="eca-series" data-sys="${esc(x.key)}"><polyline points="${pts(x.res.exactCurve)}" fill="none" stroke="${x.color}" stroke-width="1.3" stroke-dasharray="4 3" opacity=".85"/><polyline points="${pts(x.res.curve)}" fill="none" stroke="${x.color}" stroke-width="2.2" stroke-linejoin="round"/>${x.res.planning!==null&&x.res.planning<=XMAX?`<circle cx="${X(x.res.planning).toFixed(1)}" cy="${Y(sr.req).toFixed(1)}" r="3.6" fill="${x.color}" stroke="#12070b" stroke-width="1"/>`:''}</g>`).join('');
  const reqLabel=dir==='entering'?`Limit ${sr.req.toFixed(2)} %`:`Target ${sr.req.toFixed(2)} % (95%)`;
  const limitLine=`<line x1="${L}" x2="${W-Rm}" y1="${Y(sr.req).toFixed(1)}" y2="${Y(sr.req).toFixed(1)}" stroke="#45d69b" stroke-width="1.3" stroke-dasharray="6 4"/><text class="lim" x="${W-Rm-2}" y="${(Y(sr.req)-4).toFixed(1)}" text-anchor="end">${reqLabel}</text>`;
  const legend=shown.map(x=>`<span class="eca-legend-item" data-sys="${esc(x.key)}" role="button" tabindex="0" title="Tap to show only the ${esc(x.label)} trend — tap again to show all"><i style="background:${x.color}"></i>${x.label}${x.res.planning!==null?` — ${fmtH(x.res.planning)}`:''}</span>`).join('');
  const over=shown.filter(x=>x.res.planning===null||x.res.planning>XMAX).map(x=>x.label);
  return `<div class="eca-chart">
    <h4>Sulphur at engine inlet vs time <small>(0–20 h)</small></h4>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Sulphur at engine inlet versus time from switch-over, 0 to 20 hours">
      ${grid}<line class="axis" x1="${L}" x2="${L}" y1="${Tm}" y2="${Tm+ph}"/><line class="axis" x1="${L}" x2="${W-Rm}" y1="${Tm+ph}" y2="${Tm+ph}"/>
      ${limitLine}${lines}
      <text x="${(L+pw/2).toFixed(0)}" y="${H-18}" text-anchor="middle">Time from switch-over (h)</text>
      <text transform="translate(11 ${(Tm+ph/2).toFixed(0)}) rotate(-90)" text-anchor="middle">S % m/m</text>
    </svg>
    <div class="eca-legend">${legend}</div>
    <div class="eca-key"><span><b class="solid"></b>Step method (FOBAS)</span><span><b class="dash"></b>Exact continuous mixing</span><span><b class="dot"></b>Limit reached</span></div>
    ${over.length?`<p class="help" style="display:block">${esc(over.join(', '))}: limit not reached within the 20 h shown — see the times above.</p>`:''}
  </div>`;
}
function ecaSystemCard(dir,x,startMs,finishMs,utcOffset){
  const head=`<div class="eca-sys-head"><i style="background:${x.color}"></i><strong>${x.label}</strong></div>`;
  if(x.skipped)return `<div class="eca-sys skipped">${head}<small>Not included</small></div>`;
  const r=x.res;
  if(!r.valid)return `<div class="eca-sys">${head}<div class="alert warning" style="margin:6px 0 0">${esc(r.reason)}</div></div>`;
  const stepTxt=r.alreadyOk?'0.0 h':r.unstable?'unstable':r.stepExceeds?'> 200 h':fmtH(r.stepTime);
  const exactTxt=r.alreadyOk?'0.0 h':r.exactRounded===null?'n/a':`${fmtH(r.exactRounded)} <small>(${r.exactTime.toFixed(2)})</small>`;
  const when=startMs!==null?`<div><span>Start</span><strong>${fmtDate(iso(startMs),utcOffset)}</strong></div><div><span>Finish</span><strong>${fmtDate(iso(finishMs),utcOffset)}</strong></div>`:'';
  return `<div class="eca-sys">${head}<div class="eca-sys-grid">
      <div><span>Rate · Quantity</span><strong>${n(x.c.rate)} t/hr · ${n(x.c.qty)} t</strong></div>
      <div><span>Step method</span><strong>${stepTxt}</strong></div>
      <div><span>Exact, rounded up</span><strong>${exactTxt}</strong></div>
      <div><span>Planning time</span><strong class="eca-plan">${fmtH(r.planning)}</strong></div>${when}</div>
      ${r.unstable?`<small class="eca-warn">Step unstable (r·dt/Q &gt; 1) — the exact time is used.</small>`:''}${r.stepExceeds&&!r.unstable&&!r.alreadyOk?`<small class="eca-warn">Limit not reached within 200 h by the step method.</small>`:''}</div>`;
}
const ECA_FUEL_OPTIONS=[{value:'hfo',label:'HFO'},{value:'vlsfo',label:'VLSFO'},{value:'lsmgo',label:'LSMGO'},{value:'mgo',label:'MGO / DO'},{value:'biodiesel',label:'Biodiesel'}];
function ecaFuelLabel(v){const h=ECA_FUEL_OPTIONS.find(o=>o.value===v);return h?h.label:((!v||v==='other')?'Other':String(v));}
/* Fuel being changed from / to. Entering an ECA: current FO grade -> compliant fuel. Leaving: compliant fuel -> FO grade to resume. */
function ecaFuels(cfg,dir,i){
  let active='vlsfo';try{active=resolveFoActiveFuel(getProfile('fo'),state.route[i])||'vlsfo';}catch{}
  return dir==='entering'?{from:cfg.fromFuel||active,to:cfg.toFuel||'lsmgo'}:{from:cfg.fromFuel||'lsmgo',to:cfg.toFuel||active};
}
function ecaSummaryText(r,i){
  const parts=[];
  ['entering','leaving'].forEach(dir=>{const c=r.eca?.[dir];if(!c?.enabled)return;const tag=dir==='entering'?'In':'Out';
    if((c.method||'fuel')==='scrubber'){parts.push(`${tag}: Scrubber (EGCS)`);return;}
    const f=ecaFuels(c,dir,i),sr=ecaSystemResults(dir,c);
    parts.push(`${tag}: ${ecaFuelLabel(f.from)} → ${ecaFuelLabel(f.to)}${sr.planning!==null?` (${fmtH(sr.planning)})`:''}`);});
  return parts.length?parts.join(' · '):'Not configured';
}
function ecaMethodHtml(dir,i,cfg){
  const method=cfg.method||'fuel',enter=dir==='entering',f=ecaFuels(cfg,dir,i),at=`data-eca="${i}" data-eca-dir="${dir}"`;
  const picker=(field,label,val,tip)=>`<div class="field rg-half"><label>${label}${manualPickHtml(ECA_FUEL_OPTIONS,val,`data-mp="eca" ${at} data-eca-field="${field}"`,'Type fuel type')}</label>${explain(label,tip)}</div>`;
  return `<div class="field rg-full"><label>${enter?'How will the vessel comply inside the ECA/SECA?':'After leaving the ECA/SECA'}<select ${at} data-eca-field="method"><option value="fuel" ${method==='fuel'?'selected':''}>Fuel changeover</option><option value="scrubber" ${method==='scrubber'?'selected':''}>Scrubber (EGCS) — no fuel changeover</option></select></label>${explain('Compliance method','Choose Fuel changeover to plan the switch to a compliant fuel, or Scrubber if the vessel complies with an approved exhaust gas cleaning system and keeps burning its current fuel.')}</div>`
    +(method==='fuel'?picker('fromFuel',enter?'Change over from':'Fuel in use in the ECA/SECA',f.from,enter?'Fuel currently in the service system, e.g. HFO or VLSFO. Pick from the list or type your own.':'The compliant fuel being used inside the area.')
      +picker('toFuel',enter?'Change over to':'Fuel to resume',f.to,enter?'Compliant fuel to be used inside the ECA/SECA (0.10% S limit), e.g. 0.10% VLSFO/ULSFO, LSMGO, MGO/DO or compliant biodiesel. Pick from the list or type your own.':'Fuel to switch back to after leaving the area.'):'');
}
/* Suggested starting values when a direction is first enabled for a port. */
function ecaDefaultCfg(dir,i){
  const fo=getProfile('fo'),route=state.route[i],active=resolveFoActiveFuel(fo,route);
  const fallbackMeRate=Number((Math.max(0,n(effectiveFuelRates(fo,active)?.seaRate))/24).toFixed(3));
  const hs=active==='hfo'?3.5:0.5;
  const saved=state.meta.ecaSystemDefaults||{};
  const seed=(key,fallbackRate)=>({on:true,rate:n(saved[key]?.rate)||fallbackRate,qty:n(saved[key]?.qty)||0});
  const sys={me:seed('me',fallbackMeRate),ae:seed('ae',0),boiler:seed('boiler',0)};
  const ff=ecaFuels({},dir,i),fuels={method:'fuel',fromFuel:ff.from,toFuel:ff.to};
  return dir==='entering'
    ? {...fuels,limitPct:0.10,fromSulphurPct:hs,toSulphurPct:0.10,marginHours:1,...sys}
    : {...fuels,fromSulphurPct:0.10,toSulphurPct:hs,...sys};
}
function ecaFieldsHtml(dir,i,cfg){
  const head=ecaMethodHtml(dir,i,cfg);
  if((cfg.method||'fuel')==='scrubber')return `<div class="route-grid" style="margin-top:6px">${head}</div>`;
  const fld=(label,field,step,help,sys)=>{const v=sys?n(cfg[sys]?.[field]):n(cfg[field]);return `<div class="field rg-half"><label>${label}<input type="number" inputmode="decimal" step="${step}" min="0" data-eca="${i}" data-eca-dir="${dir}"${sys?` data-eca-sys="${sys}"`:''} data-eca-field="${field}" value="${v}"></label>${explain(label.replace(/ \(.*\)/,''),help)}</div>`;};
  const shared=dir==='entering'
    ?fld('Required sulphur at engine inlet (%)','limitPct','0.01','Maximum sulphur allowed inside this ECA/SECA — 0.10% m/m for the IMO-designated ECAs in force. Check current notices for this area/date, as ECAs are added periodically under MARPOL Annex VI Reg. 14.')
      +fld('Current fuel sulphur in system (%)','fromSulphurPct','0.01','Sulphur content of the fuel now in the service system (starting value), from its BDN.')
      +fld('New (compliant) fuel sulphur (%)','toSulphurPct','0.01','Sulphur content of the compliant fuel being introduced, from its BDN. Must not exceed the current sulphur or the required limit. A value equal to the limit (0.10 or 0.50) is treated as 0.099 / 0.499, as in the FOBAS workbook.')
      +fld('Safety margin (hours)','marginHours','0.1','Extra buffer so all systems finish this long before arrival at the port. Set per your vessel’s approved changeover procedure/SMS.')
    :fld('Current (compliant) sulphur (%)','fromSulphurPct','0.01','Sulphur content of the compliant fuel now in the service system, from its BDN.')
      +fld('Sulphur of fuel to resume (%)','toSulphurPct','0.01','Sulphur content of the fuel you will switch back to once clear of the area, from its BDN.');
  const sysBlocks=ECA_SYSTEMS.map(s=>{const c=cfg[s.key]||{};return `<div class="eca-sys-input">
      <label class="check"><input type="checkbox" data-eca="${i}" data-eca-dir="${dir}" data-eca-sys="${s.key}" data-eca-field="on" ${c.on!==false?'checked':''}><i class="eca-dot" style="background:${s.color}"></i> ${s.label}</label>
      ${c.on!==false?`<div class="route-grid">${fld('Consumption rate (t/hr)','rate','0.001','Fuel consumption rate of this system during the changeover (r). Once entered here, it is suggested automatically for the next changeover on another port — change it any time.',s.key)}${fld('Service system quantity (t)','qty','0.01','Fuel in this system’s service/mixing volume including the mixing column and pipework (Q). Values below 0.1 t are treated as 0.1 t, as in the FOBAS workbook. Once entered here, it is suggested automatically for the next changeover on another port — change it any time.',s.key)}</div>`:''}
    </div>`;}).join('');
  return `<div class="route-grid" style="margin-top:6px">${head}${shared}</div>${sysBlocks}`;
}
function ecaDirectionResult(dir,i){
  const r=state.route[i];if(!r)return'';
  const cfg=dir==='entering'?(r.eca?.entering||{}):(r.eca?.leaving||{});
  if(!cfg.enabled)return'';
  if((cfg.method||'fuel')==='scrubber')return `<div class="alert good">${dir==='entering'?'Scrubber (EGCS) selected — no fuel changeover is planned on the approach. The vessel keeps burning its current fuel while the approved scrubber operates; check washwater discharge rules for the area/port.':'Scrubber (EGCS) selected — no fuel changeover is planned after leaving the area.'}</div>`;
  const f=ecaFuels(cfg,dir,i);
  return `<div class="eca-fuelline">${dir==='entering'?'Change over':'Resume'}: <strong>${esc(ecaFuelLabel(f.from))} → ${esc(ecaFuelLabel(f.to))}</strong></div>`+ecaDirectionResultCore(dir,i);
}
function ecaDirectionResultCore(dir,i){
  const r=state.route[i],c=calc.results[i];if(!c)return'';
  const cfg=dir==='entering'?(r.eca?.entering||{}):(r.eca?.leaving||{});
  if(!cfg.enabled)return'';
  const sr=ecaSystemResults(dir,cfg),T=sr.planning;
  const port=r.port||`Port ${i+1}`;
  const note=`<p class="muted" style="font-size:.7rem;margin:8px 0 0">Planning time = the longer of the FOBAS step-method time and the exact time rounded up to 0.1 h; the vessel is ready when its slowest system (${T===null?'—':fmtH(T)}) has finished.</p>`;
  if(dir==='entering'){
    const margin=Math.max(0,n(cfg.marginHours)),seaHrs=c.seaDays*24;
    const legEndMs=new Date(c.arrivalUtc).getTime(),legStartMs=legEndMs-c.seaDays*86400000;
    const targetMs=legEndMs-margin*3600000;
    const cards=sr.list.map(x=>{const ok=!x.skipped&&x.res.valid&&x.res.planning!==null;return ecaSystemCard(dir,x,ok?targetMs-x.res.planning*3600000:null,ok?targetMs:null,c.utcOffset);}).join('');
    if(T===null)return `<div class="eca-systems">${cards}</div><div class="alert warning">Complete the inputs above (rates, quantities, and a new-fuel sulphur at or below the limit) to calculate the changeover.</div>${ecaChartHtml(dir,sr)}`;
    const startMs=targetMs-T*3600000,lead=T+margin,insufficient=lead>seaHrs+0.001;
    const prevPort=i>0?(state.route[i-1]?.port||`Port ${i}`):'the voyage start';
    const posS=positionAtTime(legStartMs,legEndMs,c.distanceNm,startMs),posF=positionAtTime(legStartMs,legEndMs,c.distanceNm,targetMs);
    return `<div class="eca-systems">${cards}</div>
      <div class="eca-result">
        <div><span>Changeover duration (slowest system)</span><strong>${fmtH(T)}</strong></div>
        <div><span>Required lead time (+${margin} h margin)</span><strong>${fmtH(lead)}</strong></div>
        <div><span>Start changeover (earliest)</span><strong>${fmtDate(iso(startMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(startMs))}</small></div>
        <div><span>All systems finished by</span><strong>${fmtDate(iso(targetMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(targetMs))}</small></div>
        <div><span>Vessel position at start</span><strong>≈${posS.nmRun.toFixed(0)} NM out from ${esc(prevPort)}</strong><small>${posS.nmLeft.toFixed(0)} NM (${(posS.frac*100).toFixed(0)}%) to ${esc(port)}</small></div>
        <div><span>Vessel position at finish</span><strong>≈${posF.nmRun.toFixed(0)} NM out from ${esc(prevPort)}</strong><small>${posF.nmLeft.toFixed(0)} NM (${(posF.frac*100).toFixed(0)}%) to ${esc(port)}</small></div>
      </div>${insufficient?`<div class="alert warning">This leg has only ${seaHrs.toFixed(1)} h at sea — not enough time to complete the changeover (${fmtH(lead)}) before arrival. Start earlier (on a previous leg) or review the plan.</div>`:''}
      ${sr.anyProblem?`<div class="alert warning">One or more systems could not be calculated — see their cards above. The duration shown covers only the valid systems.</div>`:''}${ecaChartHtml(dir,sr)}${note}`;
  }
  const next=calc.results[i+1];
  const legStartMs=new Date(c.departureUtc).getTime();
  const cards=sr.list.map(x=>{const ok=!x.skipped&&x.res.valid&&x.res.planning!==null;return ecaSystemCard(dir,x,ok?legStartMs:null,ok?legStartMs+x.res.planning*3600000:null,c.utcOffset);}).join('');
  if(T===null)return `<div class="eca-systems">${cards}</div><div class="alert warning">Enter a resume-fuel sulphur above the current sulphur, and each system's rate and quantity, to estimate the leaving changeover.</div>${ecaChartHtml(dir,sr)}`;
  const finishMs=legStartMs+T*3600000;
  let pos;
  if(next){const legEndMs=new Date(next.arrivalUtc).getTime(),p=positionAtTime(legStartMs,legEndMs,next.distanceNm,finishMs),nextPort=next.port||`Port ${i+2}`;pos=`<strong>≈${p.nmRun.toFixed(0)} NM out from ${esc(port)}</strong><small>${p.nmLeft.toFixed(0)} NM (${(p.frac*100).toFixed(0)}%) to ${esc(nextPort)}</small>`;}
  else pos=`<strong>Beyond the last port in the plan</strong><small>add a next port to estimate the position</small>`;
  return `<div class="eca-systems">${cards}</div>
    <div class="eca-result">
      <div><span>Estimated changeover duration (slowest)</span><strong>${fmtH(T)}</strong><small>to ≈95% resume fuel</small></div>
      <div><span>Start changeover</span><strong>${fmtDate(iso(legStartMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(legStartMs))} — on departure/clearing the area</small></div>
      <div><span>Estimated finish</span><strong>${fmtDate(iso(finishMs),c.utcOffset)} local</strong><small>${fmtUTC(iso(finishMs))}</small></div>
      <div><span>Vessel position at start</span><strong>At ${esc(port)}</strong><small>0 NM into the leg${next?` to ${esc(next.port||`Port ${i+2}`)}`:''}</small></div>
      <div><span>Vessel position at finish</span>${pos}</div>
    </div>${sr.anyProblem?`<div class="alert warning">One or more systems could not be calculated — see their cards above.</div>`:''}${ecaChartHtml(dir,sr)}
    <div class="help" style="display:block;margin-top:8px">Informational only — no regulatory time limit applies once the vessel has cleared the ECA/SECA. Do not resume higher-sulphur fuel until fully clear of the boundary. Record date, time, position and tank quantities at both changeovers in the Oil Record Book / changeover log.</div>${note}`;
}
function ecaCard(r,i){
  const en=r.eca?.entering||{},lv=r.eca?.leaving||{},k='ecacard:'+i;
  return `<details class="item-card route-card" data-eca-card="${i}" data-open-key="${k}" ${uiOpen.has(k)?'open':''}>
    <summary class="route-sum"><span class="step">${i+1}</span><span class="rs-main"><strong class="rs-port">${esc(r.port||`Port ${i+1}`)}</strong><small class="rs-meta">${esc(ecaSummaryText(r,i))}</small></span>${ICON.chev}</summary>
    <div class="route-body">
      <label class="check"><input type="checkbox" data-eca="${i}" data-eca-dir="entering" data-eca-field="enabled" ${en.enabled?'checked':''}> Vessel enters an ECA/SECA on the approach to this port</label>
      ${en.enabled?ecaFieldsHtml('entering',i,en):''}
      ${en.enabled?`<div class="eca-result-slot" data-eca-slot="${i}:entering">${ecaDirectionResult('entering',i)}</div>`:''}
      <label class="check" style="margin-top:16px"><input type="checkbox" data-eca="${i}" data-eca-dir="leaving" data-eca-field="enabled" ${lv.enabled?'checked':''}> Vessel leaves an ECA/SECA after this port</label>
      ${lv.enabled?ecaFieldsHtml('leaving',i,lv):''}
      ${lv.enabled?`<div class="eca-result-slot" data-eca-slot="${i}:leaving">${ecaDirectionResult('leaving',i)}</div>`:''}
      <p class="muted" style="font-size:.7rem;margin-top:10px">Planning estimate using the FOBAS-style well-mixed service-system model, calculated per system (Main Engine, Aux. Engine, Boiler). Vessel position is estimated by time fraction along the leg (no port coordinates are stored). Always follow the vessel’s approved changeover procedure/SMS and verify current ECA boundaries and sulphur limits (MARPOL Annex VI Reg. 14) before use — re-check every port, as designated areas and limits can change.</p>
    </div>
  </details>`;
}
function renderEca(){
  $('#ecaList').innerHTML=state.route.length?state.route.map((r,i)=>ecaCard(r,i)).join(''):'<div class="empty">Add ports in the Voyage tab first, then plan any ECA/SECA changeovers here.</div>';
}
function syncEcaResult(i){
  const enSlot=document.querySelector(`[data-eca-slot="${i}:entering"]`);if(enSlot)enSlot.innerHTML=ecaDirectionResult('entering',i);
  const lvSlot=document.querySelector(`[data-eca-slot="${i}:leaving"]`);if(lvSlot)lvSlot.innerHTML=ecaDirectionResult('leaving',i);
}
function routeCard(r,i){
  const c=calc.results[i],k='route:'+i,last=state.route.length-1;
  const hasBunker=[...state.fuels,...state.lubes].some(f=>n(r.bunkers?.[f.id]?.quantity)>0);
  const hasEca=!!(r.eca?.entering?.enabled||r.eca?.leaving?.enabled);
  const eta=c?fmtDate(c.arrivalUtc,c.utcOffset):'—',etd=c?fmtDate(c.departureUtc,c.utcOffset):'—';
  const move=`<div class="sequence-actions"><button type="button" class="icon-btn" data-move-route="${i}" data-direction="up" aria-label="Move port earlier" title="Move earlier" ${i===0?'disabled':''}>${ICON.up}</button><button type="button" class="icon-btn" data-move-route="${i}" data-direction="down" aria-label="Move port later" title="Move later" ${i===last?'disabled':''}>${ICON.down}</button></div>`;
  return `<details class="item-card route-card" data-route-card="${i}" data-open-key="${k}" ${uiOpen.has(k)?'open':''}>
    <summary class="route-sum"><span class="step">${i+1}</span><span class="rs-main"><strong class="rs-port">${esc(r.port||`Port ${i+1}`)}</strong><small class="rs-meta">${routeMeta(r)}</small></span><span class="tk-side"><span class="rs-eta">ETA ${eta==='—'?eta:eta.slice(5)}</span>${ICON.chev}</span></summary>
    <div class="route-body">
      <div class="route-grid">
        <div class="field rg-full"><label>Port name<input class="big-input" data-route-index="${i}" data-field="port" value="${esc(r.port)}" placeholder="Port name" autocomplete="off" list="defaultPorts"></label></div>
        ${i===0?`<div class="field rg-full"><label>ETA (first port)<input type="datetime-local" data-route-index="${i}" data-field="eta" value="${esc(r.eta||'')}"></label>${explain('First port ETA','Optional. If set, this exact arrival time is used for the first port instead of the voyage start time. Leave blank to use voyage start UTC as the arrival.')}</div>`:''}
        <div class="field rg-half"><label>Distance from previous (NM)<input type="number" inputmode="decimal" step="0.1" min="0" data-route-index="${i}" data-field="distanceNm" value="${n(r.distanceNm)}"></label>${explain('Distance','Nautical miles from the previous route point to this port. The first port normally uses 0 NM.')}</div>
        <div class="field rg-half"><label>Speed (kn)<input type="number" inputmode="decimal" step="0.1" min="0" data-route-index="${i}" data-field="speedKn" value="${n(r.speedKn)}"></label>${explain('Speed','Planning speed in knots used to calculate sailing time: distance ÷ speed ÷ 24.')}</div>
        <div class="field rg-half"><label>At anchor / drift (days)<input type="number" inputmode="numeric" step="1" min="0" data-route-index="${i}" data-field="anchorStayDays" value="${Math.floor(n(r.anchorStayDays))}"></label></div>
        <div class="field rg-half"><label>At anchor / drift (hours)<input type="number" inputmode="numeric" step="1" min="0" max="23" data-route-index="${i}" data-field="anchorStayHours" value="${n(r.anchorStayHours)}"></label>${explain('At anchor / drift','Time spent waiting at anchor or drifting off this port before going alongside/berthing — added to the ETA→ETD span and consumed at the "At anchor/drift/day" rate set in Setup (or its own override below).')}</div>
        <div class="field rg-half"><label>Port stay (days)<input type="number" inputmode="numeric" step="1" min="0" data-route-index="${i}" data-field="portStayDays" value="${Math.floor(n(r.portStayDays))}"></label></div>
        <div class="field rg-half"><label>Port stay (hours)<input type="number" inputmode="numeric" step="1" min="0" max="23" data-route-index="${i}" data-field="portStayHours" value="${n(r.portStayHours)}"></label>${explain('Port stay','Time spent alongside the berth. Enter whole days and additional hours. Total port-point time = anchor/drift stay + port stay.')}</div>
        <div class="field rg-full"><label>UTC offset<select data-route-index="${i}" data-field="utcOffset">${UTC_OFFSETS.map(o=>`<option value="${o}" ${Math.abs(n(r.utcOffset)-o)<0.01?'selected':''}>${utcOffsetLabel(o)}</option>`).join('')}</select></label>${explain('UTC offset','Local-port time offset from UTC. It changes displayed local ETA/ETD only.')}</div>
        ${getProfile('fo')?.foMode==='both'?`<div class="field rg-full"><label>Fuel oil in use for this leg<select data-route-index="${i}" data-field="foActiveFuel"><option value="vlsfo" ${r.foActiveFuel!=='hfo'?'selected':''}>VLSFO</option><option value="hfo" ${r.foActiveFuel==='hfo'?'selected':''}>HFO</option></select></label>${explain('Fuel oil in use','This vessel tracks VLSFO and HFO separately (set in Setup). Choose which one is actually being burned on this leg — it drives the sea/port/anchor consumption, the reserve/shortage check, and the no-mixing bunkering rule for VLSFO.')}</div>`:''}
      </div>
      <div class="stay-summary"><span>ETA <strong class="eta-val">${eta}</strong></span><span>ETD <strong class="etd-val">${etd}</strong></span></div>
      ${consOverrideHtml(r,i)}
      <div class="cross-tab-links">
        <span class="tag ${hasBunker?'':'dim'}" data-goto-tab="bunkering">${hasBunker?'Bunkering planned':'Bunkering & lube oil'} — see Bunkering tab</span>
        <span class="tag ${hasEca?'':'dim'}" data-goto-tab="eca">${hasEca?'ECA/SECA planned':'ECA/SECA changeover'} — see ECA/SECA tab</span>
      </div>
      <div class="route-foot">${move}<button type="button" class="danger ghost sm" data-remove-route="${i}">${ICON.trash}<span>Remove port</span></button></div>
    </div>
  </details>`;
}
function renderRoute(){
  $('#routeList').innerHTML=state.route.length?state.route.map((r,i)=>routeCard(r,i)).join(''):'<div class="empty">Add the first port. The route is calculated sequentially from the voyage start UTC time.</div>';
  $('#routeList').insertAdjacentHTML('beforeend', `<div class="add-row"><button id="addRouteInline" class="primary">${ICON.plus}<span>Add port</span></button></div>`);
}
/* Per-port override of in-port / anchor-drift daily consumption, one row per fuel & lube. */
function consOverrideHtml(r,i){
  const profiles=[...state.fuels,...state.lubes],hasAnchor=Math.max(0,n(r.anchorStayDays))>0||Math.max(0,n(r.anchorStayHours))>0;
  const rows=profiles.map(p=>{
    const port=r.consOverride?.port?.[p.id],anchor=r.consOverride?.anchor?.[p.id];
    const field=(phase,val,rate)=>`<label>${phase==='port'?'In port':'Anchor/drift'} (${esc(p.unit)}/day)<input type="number" inputmode="decimal" step="0.01" min="0" placeholder="${rate.toFixed(2)}" data-route-index="${i}" data-cons-phase="${phase}" data-cons-id="${p.id}" value="${val===undefined||val===null||val===''?'':n(val)}"></label>`;
    return `<div class="cons-row ${hasAnchor?'':'no-anchor'}"><span class="cons-name">${esc(p.name)}</span>${field('port',port,ratesFor(p.id,i).port)}${hasAnchor?field('anchor',anchor,ratesFor(p.id,i).anchor):''}</div>`;
  }).join('');
  return `<details class="cons-override" data-open-key="cons:${i}" ${uiOpen.has('cons:'+i)?'open':''}><summary>Override in-port${hasAnchor?' / anchor-drift':''} consumption for this port${ICON.chev}</summary><div class="cons-grid">${rows}</div><span class="help" style="display:block;margin-top:6px">Leave blank to use the default rate from Setup. Placeholders show the rate that will be used.</span></details>`;
}
function syncRouteCard(i){
  const r=state.route[i],card=document.querySelector(`[data-route-card="${i}"]`);if(!r||!card)return;
  const c=calc.results[i],eta=c?fmtDate(c.arrivalUtc,c.utcOffset):'—',etd=c?fmtDate(c.departureUtc,c.utcOffset):'—',name=r.port||`Port ${i+1}`;
  card.querySelector('.rs-port').textContent=name;card.querySelector('.rs-meta').textContent=routeMeta(r);
  card.querySelector('.rs-eta').textContent=`ETA ${eta==='—'?eta:eta.slice(5)}`;
  card.querySelector('.eta-val').textContent=eta;card.querySelector('.etd-val').textContent=etd;
  const hasBunker=[...state.fuels,...state.lubes].some(f=>n(r.bunkers?.[f.id]?.quantity)>0);
  const bunkTag=card.querySelector('[data-goto-tab="bunkering"]');
  if(bunkTag){bunkTag.textContent=`${hasBunker?'Bunkering planned':'Bunkering & lube oil'} — see Bunkering tab`;bunkTag.classList.toggle('dim',!hasBunker);}
  const consEl=card.querySelector('.cons-override');
  if(consEl&&!consEl.contains(document.activeElement))consEl.outerHTML=consOverrideHtml(r,i);
}
/* Which tanks a bunker of this fuel/type may be allocated into — mirrors the no-mixing rule in
   core.js: HFO may top up a tank that already has ROB, VLSFO/diesel-oil grades need an empty tank. */
function bunkerFillFrac(){return maxFillFrac(state.meta);}
const maxFillPctText=()=>String(Math.round(bunkerFillFrac()*1000)/10);
function eligibleBunkerTanks(groupId,fuelType,tanksSnapshot){
  const pool=consumptionOrder((tanksSnapshot||state.tanks).filter(t=>t.group===groupId&&isConsumableTank(t)));
  if(!fuelType)return pool;
  const matched=pool.filter(t=>normFuelType(t.fuelType||defaultFuelType(t.group))===normFuelType(fuelType));
  return fuelTypeNoMixing(fuelType)?matched.filter(t=>n(t.rob)<=1e-9):matched;
}
/* Per-tank proposal at the port's arrival condition. Fuel: grade must match the tank; VLSFO needs an empty tank
   (new VLSFO must not be mixed with old VLSFO); HFO / diesel / biodiesel may top up a tank of the same type, up to 85%.
   Lube oil: replenish each tank up to full capacity. */
function bunkerTankProposals(groupId,fuelType,ri){
  const c=calc.results[ri],snapshot=(c&&c.tankAtArrival)||state.tanks,frac=bunkerFillFrac(groupId),noMix=fuelType?fuelTypeNoMixing(fuelType):false;
  return consumptionOrder(snapshot.filter(t=>t.group===groupId&&isConsumableTank(t))).map(t=>{
    const own=t.fuelType||defaultFuelType(t.group),cap=Math.max(0,n(t.capacity)),rob=Math.max(0,n(t.rob)),room=Math.max(0,cap*frac-rob),roomMax=room;
    let ok=true,reason='';
    if(fuelType&&normFuelType(own)!==normFuelType(fuelType)){ok=false;reason='different fuel type';}
    else if(noMix&&rob>1e-9){ok=false;reason='holds old '+fuelTypeLabel(groupId,fuelType)+' — cannot mix';}
    else if(room<=1e-9){ok=false;reason='already at '+maxFillPctText()+'% or more';}
    return{tank:t,type:own,rob,cap,room,ok,qty:ok?room:0,qtyMax:ok?roomMax:0,reason};
  });
}
function proposedBunkerQuantity(groupId,fuelType,ri){return bunkerTankProposals(groupId,fuelType,ri).reduce((s,p)=>s+p.qty,0);}
function proposedBunkerRange(groupId,fuelType,ri){const l=bunkerTankProposals(groupId,fuelType,ri);return{lo:l.reduce((s,p)=>s+p.qty,0),hi:l.reduce((s,p)=>s+p.qtyMax,0)};}
const fmtRange=(lo,hi,unit)=>Math.abs(hi-lo)<0.005?fmtN(lo,unit):`${fmtN(lo,unit)} – ${fmtN(hi,unit)}`;
function bunkerEditor(r,f,ri){
  const b=r.bunkers?.[f.id]||{quantity:0,autoAllocate:true,allocations:[]};
  const tg=tanksFor(f.id,true);
  const opts=fuelTypeOptions(f.id);
  const fuelType=opts?(b.fuelType||defaultFuelType(f.id)):null;
  const fuelTypeField=opts?`<div class="field"><label>Fuel type (this bunker)${manualPickHtml(opts,fuelType,`data-mp="bunker" data-bunker-route="${ri}" data-bunker-fuel="${f.id}"`,'Type fuel type')}</label>${explain('Fuel type','Which grade is being bunkered (pick from the list or type your own). Only tanks of the same type are offered. New VLSFO needs an empty tank — it cannot be mixed with old VLSFO. HFO, diesel oil and biodiesel may top up a tank of the same type.')}</div>`:'';
  const eligibleTanks=opts?eligibleBunkerTanks(f.id,fuelType,calc.results[ri]?.tankAtArrival).map(t=>t.id):null;
  return `<div class="bunker-box"><div class="tank-head"><strong>${esc(f.name)}</strong><span class="tag">${esc(f.unit)}</span></div>${fuelTypeField}<div class="field"><label>Bunker quantity<input type="number" step="0.01" min="0" data-bunker-route="${ri}" data-bunker-fuel="${f.id}" data-bunker-field="quantity" value="${n(b.quantity)}"></label>${explain('Bunker quantity','Planned quantity received at this port. It is credited after port consumption and allocated only to tanks with available capacity.')}</div><div class="bunker-live" data-bunker-live="${ri}:${f.id}">${bunkerLiveHtml(r,f,ri)}</div><label class="check" style="margin-top:8px"><input type="checkbox" data-bunker-route="${ri}" data-bunker-fuel="${f.id}" data-bunker-field="autoAllocate" ${b.autoAllocate!==false?'checked':''}> Auto-allocate by tank free capacity</label>${explain('Auto allocation','When enabled, the planner fills eligible tanks (matching the fuel type above) in sequence, up to '+maxFillPctText()+'% of capacity first, until the bunker quantity is allocated.')}${tg.length?`<div class="allocation-list">${tg.map(t=>{const a=allocValue(ri,f.id,b,t.id),dimmed=eligibleTanks&&!eligibleTanks.includes(t.id);return `<div class="field${dimmed?' tank-ineligible':''}"><label>${esc(t.name)}<small class="inel-note">(not eligible for this fuel type)</small><input type="number" step="0.01" min="0" data-alloc-route="${ri}" data-alloc-fuel="${f.id}" data-alloc-tank="${t.id}" value="${n(a)}"></label></div>`}).join('')}</div>`:'<div class="muted" style="margin-top:8px">No consumable tanks in this fuel group.</div>'}</div>`;}
/* With Auto-allocate on, the tank inputs show the quantity the planner allocated; otherwise the user's own figures. */
function allocValue(ri,fid,b,tankId){
  if(b.autoAllocate!==false&&n(b.quantity)>0){const hit=(calc.results[ri]?.bunkerInfo?.[fid]?.allocations||[]).find(x=>x.tankId===tankId);return hit?Math.round(hit.quantity*100)/100:0;}
  return (b.allocations||[]).find(x=>x.tankId===tankId)?.quantity||0;
}
function bunkerLiveHtml(r,f,ri){
  const opts=fuelTypeOptions(f.id),isLube=!opts;
  const b=r.bunkers?.[f.id]||{quantity:0,autoAllocate:true,allocations:[]},fuelType=opts?(b.fuelType||defaultFuelType(f.id)):null;
  const list=bunkerTankProposals(f.id,fuelType,ri);if(!list.length)return'';
  const lo=list.reduce((s,p)=>s+p.qty,0),hi=list.reduce((s,p)=>s+p.qtyMax,0);
  const rule=`eligible tanks filled to your ${maxFillPctText()}% maximum${isLube?'':(fuelTypeNoMixing(fuelType)?' — new VLSFO needs an empty tank, no mixing with old VLSFO':'; same-type ROB may be topped up')}`;
  const head=`<div class="proposed-qty"><span>Proposed ${isLube?'replenish':'bunker'} quantity <small>(${rule})</small>: <strong>${fmtN(lo,f.unit)} ${esc(f.unit)}</strong></span><button type="button" class="ghost sm" data-use-proposed="${ri}:${f.id}" >Use this</button></div>`;
  const rows=`<div class="pq-list">${list.map(p=>`<div class="pq-row ${p.ok?'':'pq-no'}"><span>${esc(p.tank.name)}${opts?` <small>${esc(fuelTypeLabel(f.id,p.type))}</small>`:''}</span><span>${p.ok?`<b>${fmtN(p.qty,f.unit)}</b> ${esc(f.unit)}`:esc(p.reason)}</span></div>`).join('')}</div>`;
  const bi=calc.results[ri]?.bunkerInfo?.[f.id];
  const over85Warn=bi&&bi.over85?`<div class="alert warning blink-warn">Over the ${maxFillPctText()}% maximum fill in: ${bi.overTanks.map(esc).join(', ')||'one or more tanks'}. Consider a smaller quantity or spreading it across more tanks.</div>`:'';
  return head+rows+over85Warn;
}
/* Bunkering tab: small horizontal ETA/ETD tank-condition bars (with ROB/Capacity numbers) per
   product group, reusing rtCell so the visuals match the Dashboard's Tank ROB at ETA → ETD list. */
function tankConditionRows(c,groupId){
  const unit=getProfile(groupId)?.unit||'MT';
  const tanksEta=(c?.tankAtArrival)||[],tanksEtd=(c?.tankAfter)||[];
  const ids=sortTankIdsByDisplayOrder([...new Set([...tanksEta,...tanksEtd].filter(t=>t.group===groupId).map(t=>t.id))]);
  if(!ids.length)return '<div class="empty">No tanks configured for this product.</div>';
  const rows=ids.map(id=>{
    const a=tanksEta.find(t=>t.id===id),d=tanksEtd.find(t=>t.id===id),name=a?.name||d?.name||id;
    return `<div class="rt-row"><div class="rt-name" title="${esc(name)}">${tankNameHtml(name,groupId,state.tanks.find(x=>x.id===id))}</div>${rtCell(a,unit,groupId,c?.index,'eta')}${rtCell(d,unit,groupId,c?.index,'etd')}</div>`;
  }).join('');
  return `<div class="rt-group"><div class="rt-head"><span>Tank</span><span>ETA</span><span>ETD</span></div>${rows}</div>`;
}
function bunkerProductBlock(r,p,i){
  const c=calc.results[i];
  return `<div class="bunker-product"><div class="bp-head"><strong>${esc(p.name)}</strong><span class="tag">${esc(p.unit)}</span></div>${bunkerEditor(r,p,i)}<div class="bunker-cond" data-bunker-cond="${i}:${p.id}">${tankConditionRows(c,p.id)}</div></div>`;
}
function bunkerPortCard(r,i){
  const c=calc.results[i],eta=c?fmtDate(c.arrivalUtc,c.utcOffset):'—',k='bunkport:'+i;
  return `<details class="item-card route-card" id="bunkport-${i}" data-open-key="${k}" ${uiOpen.has(k)?'open':''}>
    <summary class="route-sum"><span class="step">${i+1}</span><span class="rs-main"><strong class="rs-port">${esc(r.port||`Port ${i+1}`)}</strong><small class="rs-meta">ETA ${eta}</small></span>${ICON.chev}</summary>
    <div class="route-body">
      <h4 class="bunker-section-title">Fuel bunkering</h4>
      <div class="bunker-grid">${state.fuels.map(f=>bunkerProductBlock(r,f,i)).join('')}</div>
      <h4 class="bunker-section-title">Lube oil replenishment</h4>
      <div class="bunker-grid">${state.lubes.map(l=>bunkerProductBlock(r,l,i)).join('')}</div>
    </div>
  </details>`;
}
let maxFillAsked=false;
function maxFillSeen(){try{return !!localStorage.getItem('bunker-maxfill-asked');}catch{return maxFillAsked;}}
function markMaxFillSeen(){maxFillAsked=true;try{localStorage.setItem('bunker-maxfill-asked','1');}catch{}}
function askMaxFill(force){
  if(!force&&(state.meta.maxFillPct||maxFillAsked||maxFillSeen()||tourIndex>=0))return;   // first Tanks-tab visit only
  markMaxFillSeen();$('#maxFillInput').value=state.meta.maxFillPct||'';$('#maxFillModal').hidden=false;
  setTimeout(()=>{try{$('#maxFillInput').focus();}catch{}},50);
}
function renderMaxFillBar(){
  const el=$('#maxFillBar');if(!el)return;
  el.innerHTML=`<span>Company maximum tank fill: <strong>${maxFillPctText()}%</strong>${state.meta.maxFillPct?'':' <small>(default — not set yet)</small>'}</span><button type="button" class="ghost sm" data-change-maxfill>Change</button>`;
}
function renderBunkering(){
  $('#bunkerList').innerHTML=state.route.length?state.route.map((r,i)=>bunkerPortCard(r,i)).join(''):'<div class="empty">Add ports in the Voyage tab first, then plan bunkering and lube oil replenishment here.</div>';
}
function syncBunkerConditions(i){
  const c=calc.results[i],r=state.route[i];
  [...state.fuels,...state.lubes].forEach(p=>{
    const el=document.querySelector(`[data-bunker-cond="${i}:${p.id}"]`);if(el)el.innerHTML=tankConditionRows(c,p.id);
    const live=document.querySelector(`[data-bunker-live="${i}:${p.id}"]`);if(live&&r)live.innerHTML=bunkerLiveHtml(r,p,i);
    if(r){const b=r.bunkers?.[p.id]||{};document.querySelectorAll(`[data-alloc-route="${i}"][data-alloc-fuel="${p.id}"]`).forEach(inp=>{if(document.activeElement!==inp)inp.value=n(allocValue(i,p.id,b,inp.dataset.allocTank));});}
    if(r&&fuelTypeOptions(p.id)){const ft=r.bunkers?.[p.id]?.fuelType||defaultFuelType(p.id),ids=eligibleBunkerTanks(p.id,ft,c?.tankAtArrival).map(t=>t.id);document.querySelectorAll(`[data-alloc-route="${i}"][data-alloc-fuel="${p.id}"]`).forEach(inp=>{const fld=inp.closest('.field');if(fld)fld.classList.toggle('tank-ineligible',!ids.includes(inp.dataset.allocTank));});}
  });
}

let lastAlertKeys=new Set(),lastIgnored=[];
function ignoredAlerts(){state.meta.ignoredAlerts=state.meta.ignoredAlerts||{};return state.meta.ignoredAlerts;}
function A(kind,o={}){
  const key=o.k||kind;
  const a=Object.entries(o).filter(([k,v])=>k!=='k'&&v!==undefined&&v!==null).map(([k,v])=>` data-${k}="${esc(String(v))}"`).join('');
  return ` data-alert="${kind}" data-k="${esc(key)}"${a} role="button" tabindex="0" title="Tap to find the source and see how to fix it"`;
}
const GO='<span class="alert-go">Fix ›</span>';
function buildAlertItems(){
  const alertItems=[];const maxf=bunkerFillFrac();lastAlertKeys=new Set();lastIgnored=[];
  const ign=ignoredAlerts();
  const add=(html,k)=>{
    const label=html.replace(/<span class="alert-go">.*?<\/span>/,'').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
    if(ign[k]){lastIgnored.push({k,label});return;}
    lastAlertKeys.add(k);
    alertItems.push(html.replace(/<\/li>$/,`<button type="button" class="ghost sm alert-ignore" data-ignore-alert="${esc(k)}" title="Hide this alert from the list">Ignore</button></li>`));
  };
  calc.results.forEach(r=>r.tankAfter.forEach(t=>{
    if(n(t.capacity)>0&&n(t.rob)>n(t.capacity)+1e-9){const k=`cap:${r.index}:${t.id}`;add(`<li${A('cap',{i:r.index,t:t.id,k})}><b>${esc(t.name)}</b> exceeds capacity by ${fmtQty(n(t.rob)-n(t.capacity),unitFor(t.group))}. ${GO}</li>`,k);}
    else if(n(t.capacity)>0&&n(t.rob)>n(t.capacity)*maxf+1e-9&&!(t.group==='fo'&&(t.category==='settling'||t.category==='service'))){const k=`over85:${r.index}:${t.id}`;add(`<li${A('over85',{i:r.index,t:t.id,k})}><b>${esc(t.name)}</b> is at ${Math.round(n(t.rob)/n(t.capacity)*100)}% full after ${esc(r.port)} — above the ${Math.round(maxf*100)}% maximum fill. ${GO}</li>`,k);}
  }));
  calc.totals.shortages.forEach((a,ai)=>{const k=`short:${a.stopIndex}:${a.phase}:${a.item}`;add(`<li${A('short',{x:ai,k})}><b>${esc(a.item)}</b> at ${esc(a.location||'route')}: shortage ${fmtQty(a.shortage,unitFor(getProfileIdByName(a.item)))}. ${esc(a.message||'')} ${GO}</li>`,k);});
  calc.results.forEach(r=>Object.entries(r.fuelStatus).forEach(([id,s])=>{if(s.belowReserve){const k=`res:${r.index}:${id}`;add(`<li${A('res',{i:r.index,g:id,k})}><b>${esc(groupLabel(id))}</b> below reserve at departure from ${esc(r.port)}. Required reserve: ${fmtQty(s.reserveQty,unitFor(id))}. ${GO}</li>`,k);}}));
  return alertItems;
}

/* ---------- Alert → source + correction guide ---------- */
let activeGuide=null;
function alertGuide(d){
  const i=d.i!==undefined&&d.i!==''?Number(d.i):null,r=i!==null?calc.results[i]:null,pname=r?r.port||`Port ${i+1}`:'';
  const q=(v,g)=>fmtQty(v,g?unitFor(g):'MT'),E=esc;
  const bunkQty=(j,g)=>`[data-bunker-route="${j}"][data-bunker-fuel="${g}"][data-bunker-field="quantity"]`;
  const G={title:'Planning alert',where:'',tab:'dashboard',open:[],target:[],steps:[],alt:null};
  if(d.a==='cap'||d.a==='over85'){
    const t=(r?.tankAfter||[]).find(x=>x.id===d.t)||{},g=t.group,tname=t.name||'this tank',maxf=bunkerFillFrac();
    const limit=d.a==='cap'?n(t.capacity):n(t.capacity)*maxf,excess=Math.max(0,n(t.rob)-limit);
    G.title=d.a==='cap'?`${tname} would overfill after ${pname}`:`${tname} is above the maximum fill after ${pname}`;
    let j=-1;for(let k=i;k>=0;k--){if(n((calc.results[k]?.bunkerInfo?.[g]?.allocations||[]).find(x=>x.tankId===d.t)?.quantity)>1e-9){j=k;break;}}
    const limTxt=d.a==='cap'?`its capacity of ${q(t.capacity,g)}`:`the ${Math.round(maxf*100)}% maximum fill (${q(limit,g)})`;
    if(j>=0){
      const rec=n(calc.results[j].bunkerInfo[g].allocations.find(x=>x.tankId===d.t).quantity),pj=calc.results[j].port||`Port ${j+1}`;
      G.tab='bunkering';G.open=['bunkport:'+j];
      G.target=[`[data-alloc-route="${j}"][data-alloc-fuel="${g}"][data-alloc-tank="${d.t}"]`,bunkQty(j,g),`[data-open-key="bunkport:${j}"]`];
      G.where=`Bunkering & Lube Oil › ${pj} › ${groupLabel(g)} › ${tname}`;
      G.steps=[`After ${E(pname)} this tank holds ${q(t.rob,g)}, which is ${q(excess,g)} over ${limTxt}.`,`It got there because ${q(rec,g)} is bunkered into it at ${E(pj)}.`,`Lower this tank’s figure in the highlighted box by at least ${q(excess,g)} — or tick “Auto-allocate” so the planner spreads the bunker over tanks that have room, or reduce the Bunker quantity.`,`This alert clears by itself once the tank is within the limit.`];
    }else{
      const idx=state.tanks.findIndex(x=>x.id===d.t),tk=state.tanks[idx]||{};
      const robBad=n(tk.rob)>limit+1e-9;
      G.tab='tanks';G.open=['tank:'+d.t];
      G.target=robBad?[`[data-tank-index="${idx}"][data-field="rob"]`,`[data-tank-card="${idx}"]`]:[`[data-tank-index="${idx}"][data-field="capacityM3"]`,`[data-tank-index="${idx}"][data-field="capacity"]`,`[data-tank-card="${idx}"]`];
      G.where=`Tanks › ${groupLabel(g)} › ${tname}`;
      G.steps=robBad?[`The present ROB entered for this tank is ${q(tk.rob,g)}, which is over ${limTxt}.`,`Check the sounding: correct the Present ROB in the highlighted box.`,`If the ROB is right, the capacity entered for this tank is too small — correct the capacity instead.`]:[`This tank ends at ${q(t.rob,g)} — ${q(excess,g)} over ${limTxt} — with no bunker going into it.`,`Check the capacity entered for this tank (highlighted) and its present ROB.`,`If they are right, the tank is genuinely too full: move consumption into it earlier in the sequence.`];
    }
  }else if(d.a==='short'){
    const sh=calc.totals.shortages[Number(d.x)]||{},g=getProfileIdByName(sh.item),si=sh.stopIndex,ph=sh.phase,u=g?unitFor(g):'MT';
    G.title=`${sh.item||'Product'} shortage at ${sh.location||'route'}`;
    if(ph==='bunkering'){
      G.tab='bunkering';G.open=['bunkport:'+si];G.target=[bunkQty(si,g),`[data-open-key="bunkport:${si}"]`];
      G.where=`Bunkering & Lube Oil › ${sh.location} › ${sh.item}`;
      G.steps=[`${fmtQty(sh.shortage,u)} of the planned bunker could not be placed in any tank.`,E(sh.message||'The tanks have no room for it.'),`Reduce the Bunker quantity (highlighted) by ${fmtQty(sh.shortage,u)}, or add/enlarge an eligible tank in the Tanks tab.`];
    }else{
      const when=ph==='sea'?'on the sea leg to':ph==='anchor'?'at anchor/drift at':'during the port stay at',prev=si>0?calc.results[si-1]?.port||`Port ${si}`:'';
      G.steps=[`${E(sh.item)} runs out ${when} ${E(sh.location)} — short by ${fmtQty(sh.shortage,u)}.`];
      if(si>0){
        G.tab='bunkering';G.open=['bunkport:'+(si-1)];G.target=[bunkQty(si-1,g),`[data-open-key="bunkport:${si-1}"]`];G.where=`Bunkering & Lube Oil › ${prev} › ${sh.item}`;
        G.steps.push(`Bunker at least ${fmtQty(sh.shortage,u)} at ${E(prev)} (the port before) — enter it in the highlighted Bunker quantity box. Bunker received in a port is only available after that port’s own consumption.`,`If the present ROB you entered is too low, correct it in the Tanks tab instead.`,`If the plan is too pessimistic, check the daily rate in Setup or the speed/distance in the Voyage tab.`);
        G.alt={label:'Open Tanks (present ROB)',tab:'tanks',target:[`[data-tank-card]`]};
      }else{
        const idx=state.tanks.findIndex(x=>x.group===g);
        G.tab='tanks';G.open=idx>=0?['tank:'+state.tanks[idx].id]:[];G.target=[`[data-tank-index="${idx}"][data-field="rob"]`,`[data-tank-card="${idx}"]`];G.where=`Tanks › ${groupLabel(g)}`;
        G.steps.push(`This is the first port, so there is no earlier port to bunker at. The present ROB entered for ${E(sh.item)} is too low for the first leg or stay.`,`Correct the Present ROB in the highlighted tank, or lower the daily rate in Setup.`);
      }
    }
  }else if(d.a==='res'){
    const g=d.g,gl=groupLabel(g),st=r?.fuelStatus?.[g]||{},usable=n(st.rob)-n(st.unpumpable),need=Math.max(0,n(st.reserveQty)-usable),cur=n(state.route[i]?.bunkers?.[g]?.quantity);
    G.title=`${gl} below reserve leaving ${pname}`;G.tab='bunkering';G.open=['bunkport:'+i];G.target=[bunkQty(i,g),`[data-open-key="bunkport:${i}"]`];
    G.where=`Bunkering & Lube Oil › ${pname} › ${gl}`;
    G.steps=[`Leaving ${E(pname)}, usable ${E(gl)} is ${q(usable,g)} but the reserve you set needs ${q(st.reserveQty,g)}.`,`Bunker at least ${q(need,g)} more here (planned now: ${q(cur,g)}), so enter ${q(cur+need,g)} or more in the highlighted Bunker quantity box.`,`Or bunker at an earlier port, or reduce the reserve days in Setup › Consumption rates.`];
    G.alt={label:'Open reserve days (Setup)',tab:'setup',target:[`[data-rate-id="${g}"][data-field="reserveDays"]`,`#ratesList`]};
  }
  return G;
}
function guideTarget(sels){for(const sel of sels||[]){try{const el=document.querySelector(sel);if(el)return el;}catch{}}return null;}
function guideHighlight(sels,scroll){
  document.querySelectorAll('.alert-target').forEach(el=>el.classList.remove('alert-target'));
  const el=guideTarget(sels);if(!el)return;
  let dt=el.closest('details');while(dt){dt.open=true;if(dt.dataset.openKey)uiOpen.add(dt.dataset.openKey);dt=dt.parentElement?.closest('details');}
  (el.closest('.field')||el).classList.add('alert-target');
  if(scroll)requestAnimationFrame(()=>{try{el.scrollIntoView({behavior:'smooth',block:'center'});}catch{el.scrollIntoView();}});
}
function guideGo(info,scroll=true){
  showTab(info.tab);
  (info.open||[]).forEach(k=>{uiOpen.add(k);const el=document.querySelector(`[data-open-key="${k}"]`);if(el)el.open=true;});
  guideHighlight(info.target,scroll);
}
function renderGuidePanel(info,resolved){
  let p=document.getElementById('alertGuide');
  if(!p){p=document.createElement('div');p.id='alertGuide';p.className='alert-guide';p.setAttribute('role','status');document.body.appendChild(p);
    p.addEventListener('click',e=>{
      const b=e.target.closest('[data-guide]');if(!b||!activeGuide)return;
      const act=b.dataset.guide;
      if(act==='close')closeAlertGuide();
      else if(act==='again')guideGo(activeGuide.info,true);
      else if(act==='why')showWhy({dataset:{why:'alert',...activeGuide.d}});
      else if(act==='alt'&&activeGuide.info.alt)guideGo({tab:activeGuide.info.alt.tab,open:[],target:activeGuide.info.alt.target},true);
    });}
  p.classList.toggle('resolved',!!resolved);
  p.innerHTML=resolved
    ?`<div class="ag-head"><strong>✓ Fixed</strong><button type="button" class="ghost sm" data-guide="close" aria-label="Close">✕</button></div><p class="ag-where">${esc(info.title)} — this alert no longer applies.</p><div class="ag-actions"><button type="button" class="primary sm" data-guide="close">Done</button></div>`
    :`<div class="ag-head"><strong>${esc(info.title)}</strong><button type="button" class="ghost sm" data-guide="close" aria-label="Close guide">✕</button></div><p class="ag-where">📍 ${esc(info.where||'')}</p><ol class="ag-steps">${info.steps.map(x=>`<li>${x}</li>`).join('')}</ol><div class="ag-actions"><button type="button" class="secondary sm" data-guide="again">Show me again</button>${info.alt?`<button type="button" class="ghost sm" data-guide="alt">${esc(info.alt.label)}</button>`:''}<button type="button" class="ghost sm" data-guide="why">How was this calculated?</button></div>`;
  p.hidden=false;
}
function openAlertGuide(d){
  d={...d,a:d.a||d.alert};
  const info=alertGuide(d);
  activeGuide={d:{...d},key:d.k,info};
  $('#alertsModal').hidden=true;
  renderGuidePanel(info,false);
  guideGo(info,true);
}
function closeAlertGuide(){
  activeGuide=null;document.querySelectorAll('.alert-target').forEach(el=>el.classList.remove('alert-target'));
  const p=document.getElementById('alertGuide');if(p)p.hidden=true;
}
/* Called after every recalculation: keep the guide's figures live, keep the highlight, and confirm when fixed. */
function refreshAlertGuide(){
  if(!activeGuide)return;
  if(!lastAlertKeys.has(activeGuide.key)){
    if(!activeGuide.resolved){activeGuide.resolved=true;document.querySelectorAll('.alert-target').forEach(el=>el.classList.remove('alert-target'));renderGuidePanel(activeGuide.info,true);}
    return;
  }
  if(activeGuide.d.a!=='short'){const fresh=alertGuide(activeGuide.d);activeGuide.info={...fresh,tab:activeGuide.info.tab,open:activeGuide.info.open,target:activeGuide.info.target};renderGuidePanel(activeGuide.info,false);}
  if(currentTab===activeGuide.info.tab&&!document.querySelector('.alert-target'))guideHighlight(activeGuide.info.target,false);
}
let lastAlertCount=null;
function renderAlertsUi(items){
  const count=items.length,badge=$('#alertsBadge'),btn=$('#alertsBtn');
  if(badge){badge.textContent=count>99?'99+':String(count);badge.hidden=!count;}
  if(btn){btn.classList.toggle('has-alerts',count>0);btn.setAttribute('aria-label',count?`Planning alerts: ${count}`:'Planning alerts');}
  const box=$('#alerts');
  const ignHtml=lastIgnored.length?`<details class="ignored-alerts"><summary>${lastIgnored.length} ignored alert${lastIgnored.length>1?'s':''}</summary><ul>${lastIgnored.map(x=>`<li><span>${esc(x.label)}</span><button type="button" class="ghost sm" data-restore-alert="${esc(x.k)}">Restore</button></li>`).join('')}</ul><button type="button" class="ghost sm" data-restore-alert="*">Restore all</button></details>`:'';
  if(box)box.innerHTML=(count?`<div class="alert warning"><strong>${count} planning alert${count>1?'s':''}</strong><ul>${items.join('')}</ul></div>`:'<div class="alert good">No active planning alerts'+(lastIgnored.length?' (some are ignored)':' — no shortages, capacity conflicts or below-reserve fuel departures detected')+'.</div>')+ignHtml;
  if(lastAlertCount!==null&&count>lastAlertCount&&!$('#introScreen')&&tourIndex<0)toastAlerts(count);
  lastAlertCount=count;
  refreshAlertGuide();
}
let alertToastTimer=null;
function toastAlerts(count){
  if(!count)return;
  let t=document.getElementById('alertToast');
  if(!t){t=document.createElement('div');t.id='alertToast';t.className='alert-toast';t.setAttribute('role','alert');t.onclick=()=>{t.classList.remove('show');$('#alertsModal').hidden=false;};document.body.appendChild(t);}
  t.textContent=`⚠ ${count} planning alert${count>1?'s':''} — tap to review`;
  t.classList.add('show');clearTimeout(alertToastTimer);alertToastTimer=setTimeout(()=>t.classList.remove('show'),6000);
}
function renderResults(){
  const head=state.fuels.map(f=>`<th>${esc(f.name)} ARR</th><th>${esc(f.name)} DEP</th><th>Req. bunker</th>`).join('');
  const rows=calc.results.map(r=>`<tr><td>${r.index+1}</td><td><strong>${esc(r.port)}</strong></td><td${W('eta',{i:r.index})}>${fmtDate(r.arrivalUtc,r.utcOffset)}<small>${fmtUTC(r.arrivalUtc)}</small></td><td${W('etd',{i:r.index})}>${fmtDate(r.departureUtc,r.utcOffset)}<small>${fmtUTC(r.departureUtc)}</small></td><td${W('seadays',{i:r.index})}>${days(r.seaDays)}</td><td${W('portstay',{i:r.index})}>${days(r.portStayDays)}</td>${state.fuels.map(f=>`<td${W('arr',{i:r.index,g:f.id})}>${fmtQty(r.arrivalFuel[f.id],f.unit)}</td><td${W('dep',{i:r.index,g:f.id})} class="${r.fuelStatus[f.id].belowReserve?'warn-text':''}">${fmtQty(r.departureFuel[f.id],f.unit)}<small>${pct(r.fuelStatus[f.id].utilization)} util. · ${Number.isFinite(r.fuelStatus[f.id].marginDays)?r.fuelStatus[f.id].marginDays.toFixed(1)+' d margin':'—'}</small></td><td${W('req',{i:r.index,g:f.id})}>${fmtQty(r.fuelStatus[f.id].bunkerRequiredNow,f.unit)}</td>`).join('')}</tr>`).join('');
  $('#resultTable').innerHTML=`<table><thead><tr><th>#</th><th>Port</th><th>ETA local</th><th>ETD local</th><th>Sea d</th><th>Port d</th>${head}</tr></thead><tbody>${rows||'<tr><td colspan="99">No route yet.</td></tr>'}</tbody></table>`;
  renderAlertsUi(buildAlertItems());
  const totals=[...state.fuels,...state.lubes].map(p=>`<div class="metric-card"${W('ctotal',{g:p.id})}><div class="metric-label">${esc(p.name)}</div><div class="metric-value">${fmtQty(calc.totals.consumption[p.id],p.unit)}</div><div class="metric-foot">Sea ${fmtQty(calc.totals.seaConsumption[p.id],p.unit)} · Port ${fmtQty(calc.totals.portConsumption[p.id],p.unit)}</div></div>`).join('');$('#consumptionKpis').innerHTML=totals||'<div class="empty">Add rates to calculate consumption.</div>';
}
function getProfileIdByName(name){return[...state.fuels,...state.lubes].find(p=>p.name===name)?.id||'fo';}
function consumptionParts(usage){return[...state.fuels,...state.lubes].map(p=>{const v=n(usage?.[p.id]);return v>0?`${groupLabel(p.id)} ${fmtQty(v,p.unit)}`:null;}).filter(Boolean);}
function formatConsumption(usage){const parts=consumptionParts(usage);return parts.length?parts.join(' · '):'—';}
/* One fuel/lube type per line, for on-screen display (dashboard route summary & point details). */
function formatConsumptionHtml(usage){const parts=consumptionParts(usage);return parts.length?parts.map(esc).join('<br>'):'—';}

function bind(){
  $('#vesselName').addEventListener('input',e=>{state.meta.vesselName=e.target.value;save();renderSidebar();});
  $('#voyageNo').addEventListener('input',e=>{state.meta.voyageNo=e.target.value;save();renderSidebar();});
  $('#startUtc').addEventListener('change',e=>{state.meta.startUtc=e.target.value;rerun();});
  $('#currentPosition').addEventListener('input',e=>{state.meta.currentPosition=e.target.value;save();renderDashboard();});
  const noonRobField=(id,key)=>$('#'+id).addEventListener('input',e=>{state.meta.noonRob||={fo:0,do:0,cyl:0,mesys:0,gesys:0};state.meta.noonRob[key]=Math.max(0,n(e.target.value));save();renderDashboard();});
  noonRobField('noonRobFo','fo');noonRobField('noonRobDo','do');noonRobField('noonRobCyl','cyl');noonRobField('noonRobMesys','mesys');noonRobField('noonRobGesys','gesys');
  const setMaxFill=v=>{const x=Number(v);if(!Number.isFinite(x)||x<50||x>100)return false;state.meta.maxFillPct=x;return true;};
  $('#maxFillSave').onclick=()=>{if(!setMaxFill($('#maxFillInput').value)){alert('Enter a percentage between 50 and 100.');return;}$('#maxFillModal').hidden=true;rerun();};
  $('#maxFillSkip').onclick=()=>{markMaxFillSeen();$('#maxFillModal').hidden=true;};
  $('#maxFillBar').addEventListener('click',e=>{if(e.target.closest('[data-change-maxfill]'))askMaxFill(true);});

  /* Consumption rates and tank capacity/unpumpable are treated as fixed once a real value is entered —
     changing one away from a non-zero value needs confirming. Typing itself is never interrupted; the
     check runs when the field is left (blur), comparing against the value it had when focused. Cancelling
     reverts the field (and, via the normal input handler, the underlying value) back to what it was. */
  const LOCKED_FIELD_SEL='[data-rate-id][data-field="seaRate"],[data-rate-id][data-field="portRate"],[data-rate-id][data-field="anchorRate"],[data-rate-id][data-field="reserveDays"],[data-rate-id][data-field="reserveRate"],[data-tank-index][data-field="capacity"],[data-tank-index][data-field="capacityM3"],[data-tank-index][data-field="unpumpable"]';
  const lockedFieldOrigin=new WeakMap();
  document.addEventListener('focusin',e=>{const el=e.target.closest&&e.target.closest(LOCKED_FIELD_SEL);if(el)lockedFieldOrigin.set(el,el.value);});
  document.addEventListener('focusout',e=>{
    const el=e.target.closest&&e.target.closest(LOCKED_FIELD_SEL);if(!el)return;
    const before=lockedFieldOrigin.get(el);lockedFieldOrigin.delete(el);
    if(!lockedFieldNeedsConfirm(before,el.value))return;
    const label=(el.closest('label')?.childNodes[0]?.textContent||'this value').trim();
    if(!confirm(`Change ${label} from ${before} to ${el.value}?`)){el.value=before;el.dispatchEvent(new Event('input',{bubbles:true}));}
  });

  document.addEventListener('input',e=>{
    const t=e.target;
    if(t.dataset.mpText!==undefined){manualPickApply(t,t.value.trim()||'other');save();refreshOutputs();const k=t.dataset.mp;if(k==='tank')syncTankCard(Number(t.dataset.tankIndex));else if(k==='bunker')syncBunkerConditions(Number(t.dataset.bunkerRoute));else syncEcaResult(Number(t.dataset.eca));return;}
    if(t.dataset.mp!==undefined)return;
    if(t.dataset.rateId){const p=getProfile(t.dataset.rateId);if(p){const f=t.dataset.field,sub=t.dataset.rateSub;if(f==='sameAsVlsfo'||f==='doEcaSplit')return;const val=(f==='name'||f==='foMode')?t.value:n(t.value);if(sub){p[sub]=p[sub]||{};p[sub][f]=val;}else p[f]=val;save();refreshOutputs();}}
    if(t.dataset.tankIndex!==undefined){const i=Number(t.dataset.tankIndex),x=state.tanks[i],f=t.dataset.field;
      if(x&&['name','capacity','rob','unpumpable'].includes(f)){x[f]=f==='name'?t.value:n(t.value);if(f==='rob')x.rob=Math.max(0,x.rob);save();refreshOutputs();syncTankCard(i);}
      else if(x&&(f==='density'||f==='capacityM3')){x[f]=n(t.value);if(!(n(x.density)>0)&&f!=='density')x.density=0.95;x.capacity=n(x.density)>0?n(x.capacityM3)*n(x.density):0;if(fuelTypeOptions(x.group))x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));save();refreshOutputs();syncTankCard(i);}
      else if(x&&(f==='robVolumeM3'||f==='robTempC')){x[f]=n(t.value);x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));save();refreshOutputs();syncTankCard(i);}}
    if(t.dataset.routeIndex!==undefined&&t.dataset.consPhase===undefined){const i=Number(t.dataset.routeIndex),r=state.route[i];if(r){const f=t.dataset.field;const STRING_ROUTE_FIELDS=['port','notes','eta','anchorMode','foActiveFuel'];r[f]=STRING_ROUTE_FIELDS.includes(f)?t.value:n(t.value);save();refreshOutputs();syncRouteCard(i);}}
    if(t.dataset.consPhase!==undefined){const i=Number(t.dataset.routeIndex),r=state.route[i];if(r){r.consOverride||={port:{},anchor:{}};r.consOverride[t.dataset.consPhase]||={};if(t.value==='')delete r.consOverride[t.dataset.consPhase][t.dataset.consId];else r.consOverride[t.dataset.consPhase][t.dataset.consId]=n(t.value);save();refreshOutputs();}}
    if(t.dataset.bunkerRoute!==undefined){const ri=Number(t.dataset.bunkerRoute),r=state.route[ri],f=t.dataset.bunkerFuel;if(r){const field=t.dataset.bunkerField;if(field==='fuelType')return;r.bunkers ||= {};r.bunkers[f] ||= {quantity:0,autoAllocate:true,allocations:[]};if(field==='autoAllocate'&&!t.checked&&r.bunkers[f].autoAllocate!==false)r.bunkers[f].allocations=(calc.results[ri]?.bunkerInfo?.[f]?.allocations||[]).map(x=>({tankId:x.tankId,quantity:Math.round(x.quantity*100)/100}));
r.bunkers[f][field]=field==='quantity'?n(t.value):t.checked;save();refreshOutputs();syncRouteCard(ri);syncBunkerConditions(ri);}}
    if(t.dataset.allocRoute!==undefined){const ri=Number(t.dataset.allocRoute),r=state.route[ri],f=t.dataset.allocFuel,tankId=t.dataset.allocTank;if(r){r.bunkers ||= {};r.bunkers[f] ||= {quantity:0,autoAllocate:false,allocations:[]};const a=r.bunkers[f].allocations ||= [];const found=a.find(x=>x.tankId===tankId);const qty=n(t.value);if(found)found.quantity=qty;else a.push({tankId,quantity:qty});r.bunkers[f].autoAllocate=false;const box=t.closest('.bunker-box'),cb=box&&box.querySelector('[data-bunker-field="autoAllocate"]');if(cb)cb.checked=false;save();refreshOutputs();syncBunkerConditions(ri);}}
    if(t.dataset.eca!==undefined&&t.dataset.ecaField!=='enabled'&&t.dataset.ecaField!=='method'&&t.dataset.ecaField!=='on'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir,sys=t.dataset.ecaSys,field=t.dataset.ecaField;if(r){r.eca ||= {entering:{},leaving:{}};r.eca[dir] ||= {};if(sys){r.eca[dir][sys] ||= {};r.eca[dir][sys][field]=n(t.value);if(field==='rate'||field==='qty'){state.meta.ecaSystemDefaults ||= {};state.meta.ecaSystemDefaults[sys] ||= {rate:0,qty:0};state.meta.ecaSystemDefaults[sys][field]=n(t.value);}}else{r.eca[dir][field]=n(t.value);}save();syncEcaResult(i);}}
  });
  document.addEventListener('change',e=>{
    const t=e.target;
    if(t.dataset.mp!==undefined){
      if(t.dataset.mpText!==undefined)return;
      const inp=t.closest('.manual-pick')?.querySelector('[data-mp-text]');
      if(t.value===FUEL_MANUAL){manualPickApply(t,(inp&&inp.value.trim())||'other');pendingFocus=manualPickSelector(t);}
      else manualPickApply(t,t.value);
      rerun();return;
    }
    if(t.dataset.eca!==undefined&&t.dataset.ecaField==='method'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir;if(r){r.eca ||= {entering:{},leaving:{}};(r.eca[dir] ||= {}).method=t.value;rerun();}return;}
    if(t.dataset.eca!==undefined&&t.dataset.ecaField==='on'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir,sys=t.dataset.ecaSys;if(r){r.eca ||= {entering:{},leaving:{}};r.eca[dir] ||= {};r.eca[dir][sys] ||= {};r.eca[dir][sys].on=t.checked;save();rerun();}return;}
    // Plain numeric/text edits are already applied live on "input"; only structural changes re-render,
    // so the keyboard, focus and any expanded card stay where the user left them.
    if(t.dataset.rateId){if(t.dataset.field==='name')rerun();else if(t.dataset.field==='foMode'){const p=getProfile(t.dataset.rateId);if(p&&(t.value==='hfo'||t.value==='both')&&p.hfo&&!p.hfo.seaRate&&!p.hfo.portRate&&!p.hfo.anchorRate){/* first switch to HFO: seed it from the existing rate so numbers aren't silently lost behind the newly-shown fields */p.hfo={seaRate:p.seaRate,portRate:p.portRate,anchorRate:p.anchorRate,reserveDays:p.reserveDays,reserveRate:p.reserveRate};}rerun();}else if(t.dataset.field==='sameAsVlsfo'){const p=getProfile(t.dataset.rateId);if(p)p.sameAsVlsfo=t.checked;rerun();}else if(t.dataset.field==='doEcaSplit'){const p=getProfile(t.dataset.rateId);if(p){p.doEcaSplit=t.checked;if(t.checked&&p.insideEca&&!p.insideEca.seaRate&&!p.insideEca.portRate&&!p.insideEca.anchorRate){/* first switch on: seed it from the outside-ECA rate so numbers aren't silently lost behind the newly-shown fields */p.insideEca={seaRate:p.seaRate,portRate:p.portRate,anchorRate:p.anchorRate};}}rerun();}return;}
    if(t.dataset.tankIndex!==undefined){const x=state.tanks[Number(t.dataset.tankIndex)];if(!x)return;const f=t.dataset.field;
      if(f==='group'){const old=x.group;x.group=t.value;if(fuelTypeOptions(x.group)){x.capUnit=x.capUnit==='weight'?'weight':'volume';if(x.capUnit==='volume'){if(!(n(x.density)>0))x.density=0.95;x.capacityM3=n(x.capacityM3)||(n(x.capacity)/x.density)||0;x.capacity=x.capacityM3*x.density;if(x.robTempC===undefined)x.robTempC=15;if(!(n(x.robVolumeM3)>0))x.robVolumeM3=n(x.density)>0?Math.round((n(x.rob)/x.density)*100)/100:0;x.rob=Math.max(0,robFromVolume(x.robVolumeM3,x.robTempC,x.density));}}else{x.capUnit=undefined;}if(!x.name||/ Tank \d+$/.test(x.name))x.name=tankDefaultName(x.group,x.category);x.order=nextOrder(x.group);x.fuelType=defaultFuelType(x.group)||null;normalizeSequence(old);normalizeSequence(x.group);rerun();}
      else if(f==='category'){const oldCat=x.category;x.category=t.value;if(oldCat!==x.category&&(oldCat==='settling'||oldCat==='service'))x.inService=false;normalizeSequence(x.group);rerun();}
      else if(f==='consumable'){x.consumable=t.checked;normalizeSequence(x.group);rerun();}
      else if(f==='fuelType'){x.fuelType=t.value;rerun();}
      else if(f==='namePreset'){if(t.value===CUSTOM_NAME){x.nameCustom=true;pendingFocus=`[data-tank-index="${t.dataset.tankIndex}"].manual-name-input`;rerun();}else{x.nameCustom=false;x.name=t.value;rerun();}}
      else renderTankSequenceSummary();
      return;}
    if(t.dataset.tankSequence!==undefined){setTankSequence(Number(t.dataset.tankSequence),Number(t.value));rerun();return;}
    if(t.dataset.eca!==undefined&&t.dataset.ecaField==='enabled'){const i=Number(t.dataset.eca),r=state.route[i],dir=t.dataset.ecaDir;if(r){r.eca ||= {entering:{},leaving:{}};const existing=r.eca[dir]||{};r.eca[dir]=t.checked?{...ecaDefaultCfg(dir,i),...existing,enabled:true}:{...existing,enabled:false};save();rerun();}return;}
    if(t.dataset.bunkerRoute!==undefined&&t.dataset.bunkerField==='fuelType'){const ri=Number(t.dataset.bunkerRoute),r=state.route[ri],f=t.dataset.bunkerFuel;if(r){r.bunkers ||= {};r.bunkers[f] ||= {quantity:0,autoAllocate:true,allocations:[]};r.bunkers[f].fuelType=t.value;save();rerun();}return;}
  });
  document.addEventListener('toggle',e=>{
    const k=e.target&&e.target.dataset&&e.target.dataset.openKey;if(!k)return;
    if(e.target.open)uiOpen.add(k);else uiOpen.delete(k);
    if(k==='routetable'&&e.target.open!==(window.innerWidth>760))tableTouched=true;
  },true);
  document.addEventListener('click',e=>{
    const upEl=e.target.closest('[data-use-proposed]');
    if(upEl){const [riStr,fid]=upEl.dataset.useProposed.split(':'),ri=Number(riStr),r=state.route[ri];if(r){r.bunkers ||= {};r.bunkers[fid] ||= {quantity:0,autoAllocate:true,allocations:[]};const fuelType=r.bunkers[fid].fuelType||defaultFuelType(fid);const qty=proposedBunkerQuantity(fid,fuelType,ri);r.bunkers[fid].quantity=Math.round(qty*100)/100;r.bunkers[fid].autoAllocate=true;save();rerun();}return;}
    const rtEl=e.target.closest('[data-remove-tank]');
    if(rtEl){const rt=rtEl.dataset.removeTank,tk=state.tanks[Number(rt)];if(confirm(`Remove tank “${tk?.name||'this tank'}”? This cannot be undone after the plan is saved.`)){if(tk)uiOpen.delete('tank:'+tk.id);state.tanks.splice(Number(rt),1);state.tanks.forEach((t,i)=>{if(!Number.isFinite(Number(t.sequence)))t.sequence=i+1;});normalizeAllSequences();rerun();}return;}
    const rrEl=e.target.closest('[data-remove-route]');
    if(rrEl){const rr=rrEl.dataset.removeRoute;if(confirm('Remove route port “'+(state.route[Number(rr)]?.port||('Port '+(Number(rr)+1)))+'”?')){state.route.splice(Number(rr),1);[...uiOpen].filter(k=>k.startsWith('route:')||k.startsWith('bunk:')).forEach(k=>uiOpen.delete(k));rerun();}return;}
    const miEl=e.target.closest('[data-move-tank]');
    if(miEl){moveTank(Number(miEl.dataset.moveTank),miEl.dataset.direction);rerun();return;}
    const moEl=e.target.closest('[data-move-order]');
    if(moEl){const idx=Number(moEl.dataset.moveOrder);moveTankOrder(idx,moEl.dataset.direction);rerun();requestAnimationFrame(()=>{const card=document.querySelector(`[data-tank-card="${idx}"]`);if(card)card.scrollIntoView({behavior:'smooth',block:'center'});});return;}
    const mrEl=e.target.closest('[data-move-route]');
    if(mrEl){moveRoute(Number(mrEl.dataset.moveRoute),mrEl.dataset.direction);rerun();return;}
    const rp=e.target.closest('[data-route-point]');if(rp&&rp.dataset.routePoint!==undefined){renderPointDetails(Number(rp.dataset.routePoint));return;}
    const gt=e.target.closest('[data-goto-tab]');if(gt){showTab(gt.dataset.gotoTab);return;}
    const legItem=e.target.closest('.eca-legend-item');
    if(legItem){
      const chart=legItem.closest('.eca-chart'),sys=legItem.dataset.sys;
      const next=chart.dataset.iso===sys?'':sys;
      chart.dataset.iso=next;
      chart.querySelectorAll('[data-sys]').forEach(el=>el.classList.toggle('eca-dim',!!next&&el.dataset.sys!==next));
      return;
    }
    const gtk=e.target.closest('[data-goto-tank]');
    if(gtk&&!e.target.closest('[data-why]')){
      const tid=gtk.dataset.gotoTank;uiOpen.add('tank:'+tid);showTab('tanks');
      requestAnimationFrame(()=>{const el=document.getElementById('tankcard-'+tid);if(el){el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});el.classList.add('tank-jump');setTimeout(()=>el.classList.remove('tank-jump'),1600);}});
      return;
    }
    const gbp=e.target.closest('[data-goto-bunker-port]');
    if(gbp&&!e.target.closest('[data-why]')){
      const pi=gbp.dataset.gotoBunkerPort;uiOpen.add('bunkport:'+pi);showTab('bunkering');
      requestAnimationFrame(()=>{const el=document.getElementById('bunkport-'+pi);if(el){el.open=true;el.scrollIntoView({behavior:'smooth',block:'start'});el.classList.add('tank-jump');setTimeout(()=>el.classList.remove('tank-jump'),1600);}});
      return;
    }
    const addG=e.target.closest('[data-add-tank]');if(addG){openAddTankModal(addG.dataset.addTank);return;}
    if(e.target.closest('#addRouteInline')){addRoute();return;}
    const loadV=e.target.closest('[data-load-voyage]');
    if(loadV){const list=loadSavedVoyages(),entry=list.find(v=>v.id===loadV.dataset.loadVoyage);if(entry&&confirm(`Load “${entry.name}”? The current unsaved plan will be replaced.`)){state=migrate(JSON.parse(JSON.stringify(entry.data)));rerun();showTab('dashboard');window.scrollTo({top:0});}return;}
    const delV=e.target.closest('[data-delete-voyage]');
    if(delV){const list=loadSavedVoyages(),entry=list.find(v=>v.id===delV.dataset.deleteVoyage);if(entry&&confirm(`Delete saved voyage “${entry.name}”? This cannot be undone.`)){writeSavedVoyages(list.filter(v=>v.id!==entry.id));renderSavedVoyages();}return;}
  });
  const addTank=(group,category,afterTankId,fuelType,density,capacityM3,capUnit)=>{
    category=category||'storage';
    const hasFuelOpts=!!fuelTypeOptions(group),vol=hasFuelOpts&&capUnit!=='weight';
    const dens=vol?(Number(density)||0.95):0,capM3=vol?(Number(capacityM3)||0):0;
    const t={id:uid('tank'),group,name:tankDefaultName(group,category),capacity:vol?dens*capM3:0,density:vol?dens:undefined,capacityM3:vol?capM3:undefined,capUnit:hasFuelOpts?(vol?'volume':'weight'):undefined,robVolumeM3:vol?0:undefined,robTempC:vol?15:undefined,rob:0,unpumpable:0,consumable:true,category,sequence:tanksFor(group,true).length+1,order:0,inService:false,nameCustom:false,fuelType:fuelType||defaultFuelType(group)||null};
    const list=orderedGroupTanks(group).map(x=>x.t);
    state.tanks.push(t);
    let insertIdx=list.length;
    if(afterTankId){const pos=list.findIndex(x=>x.id===afterTankId);if(pos>=0)insertIdx=pos+1;}
    list.splice(insertIdx,0,t);
    list.forEach((x,idx)=>{x.order=idx;});
    const newIdx=state.tanks.length-1;
    uiOpen.add('tank:'+t.id);
    pendingFocus=`[data-tank-index="${newIdx}"][data-field="${vol?'capacityM3':'capacity'}"]`;
    rerun();
  };
  let addTankGroup='fo';
  function populateAddTankPosition(){
    const list=orderedGroupTanks(addTankGroup).map(x=>x.t);
    $('#addTankPosition').innerHTML='<option value="">At the end</option>'+list.map(t=>`<option value="${esc(t.id)}">After: ${esc(t.name||'(unnamed tank)')}</option>`).join('');
  }
  function populateAddTankFuelType(){
    const opts=fuelTypeOptions(addTankGroup),field=$('#addTankFuelTypeField'),capUnitField=$('#addTankCapUnitField'),densField=$('#addTankDensityField');
    if(!opts){field.hidden=true;$('#addTankFuelType').innerHTML='';capUnitField.hidden=true;densField.hidden=true;return;}
    field.hidden=false;capUnitField.hidden=false;
    $('#addTankCapUnit').value='volume';
    densField.hidden=false;$('#addTankDensity').value=$('#addTankDensity').value||'0.95';
    $('#addTankFuelType').innerHTML=opts.map(o=>`<option value="${o.value}">${esc(o.label)}</option>`).join('')+`<option value="${FUEL_MANUAL}">Other (type manually)</option>`;
    const cu=$('#addTankFuelTypeCustom');cu.hidden=true;cu.value='';
  }
  function openAddTankModal(presetGroup){
    const groups=[...state.fuels,...state.lubes];
    addTankGroup=presetGroup&&groups.some(g=>g.id===presetGroup)?presetGroup:(groups[0]?.id||'fo');
    $('#addTankModalGroup').textContent=groupLabel(addTankGroup);
    $('#addTankRole').value='storage';
    populateAddTankPosition();
    populateAddTankFuelType();
    $('#addTankModal').hidden=false;
  }
  $('#addTankFuelType').addEventListener('change',e=>{const cu=$('#addTankFuelTypeCustom');cu.hidden=e.target.value!==FUEL_MANUAL;if(!cu.hidden)cu.focus();});
  $('#addTankCapUnit').addEventListener('change',e=>{$('#addTankDensityField').hidden=e.target.value==='weight';});
  $('#addTankConfirm').onclick=()=>{
    const group=addTankGroup,category=$('#addTankRole').value,after=$('#addTankPosition').value||null;
    let fuelType=null,density=null,capacityM3=null,capUnit=null;
    if(fuelTypeOptions(group)){
      const v=$('#addTankFuelType').value;fuelType=v===FUEL_MANUAL?($('#addTankFuelTypeCustom').value.trim()||'other'):(v||null);
      capUnit=$('#addTankCapUnit').value==='weight'?'weight':'volume';
      if(capUnit==='volume'){
        density=Number($('#addTankDensity').value)||0;
        if(density<0.5||density>1.2){alert('Enter an average density between 0.5 and 1.2 t/m³.');$('#addTankDensity').focus();return;}
      }
      capacityM3=0; // capacity is set afterwards on the tank card, once created
    }
    $('#addTankModal').hidden=true;
    addTank(group,category,after,fuelType,density,capacityM3,capUnit);

  };
  const addRoute=()=>{state.route.push({port:'',distanceNm:0,speedKn:0,anchorStayDays:0,anchorStayHours:0,anchorMode:'anchor',portStayDays:0,portStayHours:0,utcOffset:0,notes:'',foActiveFuel:'vlsfo',bunkers:{},eca:{entering:{enabled:false},leaving:{enabled:false}}});uiOpen.add('route:'+(state.route.length-1));pendingFocus=`[data-route-index="${state.route.length-1}"][data-field="port"]`;rerun();};
  initCalcModal(()=>rerun());
  $('#alertsBtn').addEventListener('click',()=>{$('#alertsModal').hidden=false;});
  $('#exportXlsx').onclick=exportXlsx;
  const whyTag=(el,kind)=>{if(!el)return;el.dataset.why=kind;el.setAttribute('role','button');el.tabIndex=0;el.title='Tap to see how this is calculated';};
  whyTag($('#kpiRoute')?.closest('.kpi'),'stops');whyTag($('#kpiDuration')?.closest('.kpi'),'duration');whyTag($('#kpiAlerts')?.closest('.kpi'),'alerts');whyTag($('#kpiNext')?.closest('.kpi'),'nextport');
  whyTag($('#presentPositionView'),'position');whyTag($('#positionStatus'),'position');whyTag($('#positionDetail'),'position');whyTag($('#voyageProgress')?.closest('.progress'),'progress');whyTag($('#progressLabel'),'progress');
  document.addEventListener('click',e=>{
    const ig=e.target.closest('[data-ignore-alert]');
    if(ig){e.stopPropagation();ignoredAlerts()[ig.dataset.ignoreAlert]=true;save();closeAlertGuide();refreshOutputs();return;}
    const rs=e.target.closest('[data-restore-alert]');
    if(rs){const k=rs.dataset.restoreAlert;if(k==='*')state.meta.ignoredAlerts={};else delete ignoredAlerts()[k];save();refreshOutputs();const d=$('#alerts details');if(d&&lastIgnored.length)d.open=true;return;}
    const al=e.target.closest('[data-alert]');if(al)openAlertGuide({...al.dataset});});
  const openWhy=e=>{const w=e.target.closest('[data-why]');if(!w)return false;if(e.target.closest('button,a,input,select,textarea,summary')&&e.target.closest('button,a,input,select,textarea,summary')!==w)return false;showWhy(w);return true;};
  document.addEventListener('click',e=>{openWhy(e);});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-why]')){e.preventDefault();showWhy(e.target);}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-goto-tank]')&&!e.target.closest('[data-why]')){e.preventDefault();e.target.click();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-goto-bunker-port]')&&!e.target.closest('[data-why]')){e.preventDefault();e.target.click();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('.eca-legend-item')){e.preventDefault();e.target.click();}});
  document.addEventListener('keydown',e=>{if((e.key==='Enter'||e.key===' ')&&e.target.matches&&e.target.matches('[data-alert]')){e.preventDefault();openAlertGuide({...e.target.dataset});}});
  document.addEventListener('click',e=>{const b=e.target.closest('.topbar-actions .icon-btn[data-label]');if(b)showIconLabel(b);});
  const newPlanFn=()=>{if(!confirm('Start a new plan? The current plan will be replaced.'))return;const carry=confirm('Carry over Setup, consumption rates, reserves and Tanks from the previous plan?\n\nOK = carry them over\nCancel = start completely blank');const old=state;state=defaultState();if(carry){state.meta={...state.meta,vesselName:old.meta.vesselName,voyageNo:'',currentPosition:old.meta.currentPosition,positionMode:old.meta.positionMode,notes:old.meta.notes};state.fuels=JSON.parse(JSON.stringify(old.fuels));state.lubes=JSON.parse(JSON.stringify(old.lubes));state.tanks=JSON.parse(JSON.stringify(old.tanks));state.active={...old.active};}rerun();showTab('dashboard');window.scrollTo({top:0});};
  const demoPlanFn=()=>{state=migrate(demoState());rerun();showTab('dashboard');window.scrollTo({top:0});};
  const clearAllFn=()=>{
    if(!confirm('Clear ALL entries?\n\nVessel, rates, tanks, route, bunkering and ECA data will be erased and the app returned to a blank plan. Voyages you saved under a name are not affected.'))return;
    closeAlertGuide();state=defaultState();rerun();showTab('setup');window.scrollTo({top:0});
  };
  $('#newPlan').onclick=newPlanFn;$('#demoPlan').onclick=demoPlanFn;$('#demoPlan2').onclick=demoPlanFn;$('#clearAll').onclick=clearAllFn;$('#clearAll2').onclick=clearAllFn;
  $('#tourBtn').onclick=startTour;$$('[data-close-modal]').forEach(b=>b.addEventListener('click',()=>{const m=$('#'+b.dataset.closeModal);if(m)m.hidden=true;}));$$('.modal').forEach(m=>m.addEventListener('click',e=>{if(e.target===m)m.hidden=true;}));
  $$('.top-logo,.brand-mark').forEach(el=>{el.style.cursor='pointer';el.title='Program credits & version';el.setAttribute('role','button');el.setAttribute('tabindex','0');el.setAttribute('aria-label','Program credits and version');const open=()=>{$('#aboutModal').hidden=false;};el.addEventListener('click',open);el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();open();}});});
  $('#saveVoyageBtn').onclick=()=>{
    const nameInput=$('#saveVoyageName');
    const name=(nameInput.value||'').trim()||state.meta.vesselName||`Voyage ${new Date().toISOString().slice(0,16).replace('T',' ')}`;
    const list=loadSavedVoyages();
    list.unshift({id:uid('voyage'),name,savedAt:new Date().toISOString(),data:JSON.parse(JSON.stringify(state))});
    const ok=writeSavedVoyages(list);
    nameInput.value='';renderSavedVoyages();
    if(!ok)alert(`“${name}” could not be saved — browser storage may be full or unavailable on this device.`);
  };
  renderSavedVoyages();
  if($('#aboutVersion'))$('#aboutVersion').textContent=APP_VERSION;
  $$('.nav-link').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();if(a.dataset.tab===currentTab){window.scrollTo({top:0,behavior:'smooth'});return;}showTab(a.dataset.tab);}));
  window.addEventListener('hashchange',()=>showTab(location.hash.slice(1),{scroll:false}));
  $('#hintsBtn').onclick=()=>{const cb=$('#hintsToggle');if(cb)cb.checked=document.body.classList.contains('hints');$('#helpModal').hidden=false;};
  $('#hintsToggle').onchange=e=>{try{localStorage.setItem('bunker-hints',e.target.checked?'1':'0');}catch{}applyHints();};
  document.addEventListener('keydown',e=>{if(e.key==='Escape')$$('.modal').forEach(m=>m.hidden=true);});
}
function normalizeAllSequences(){[...state.fuels,...state.lubes].forEach(p=>normalizeSequence(p.id));}
function setTankSequence(index,newSeq){const t=state.tanks[index];if(!t)return;const group=t.group,arr=tanksFor(group,true);const from=arr.findIndex(x=>x.id===t.id);const to=Math.max(0,Math.min(arr.length-1,newSeq-1));if(from<0)return;arr.splice(from,1);arr.splice(to,0,t);arr.forEach((x,i)=>x.sequence=i+1);}
function moveTank(index,dir){const t=state.tanks[index];if(!t)return;const arr=tanksFor(t.group,true),pos=arr.findIndex(x=>x.id===t.id);const target=dir==='up'?pos-1:pos+1;if(pos<0||target<0||target>=arr.length)return;[arr[pos],arr[target]]=[arr[target],arr[pos]];arr.forEach((x,i)=>x.sequence=i+1);}

function workbookSheets(){
  const route=[['No','Port','ETA UTC','ETD UTC','ETA Local','ETD Local','Distance NM','Speed kn','Sea Days','Anchor/Drift Days','Anchor/Drift Hours','Anchor/Drift Consumption','Port Stay Days','Port Stay Hours','Sea Consumption','Port Consumption','Notes']];
  calc.results.forEach(r=>route.push([r.index+1,r.port,r.arrivalUtc,r.departureUtc,fmtDate(r.arrivalUtc,r.utcOffset),fmtDate(r.departureUtc,r.utcOffset),r.distanceNm,r.speedKn,r.seaDays,Math.floor(n(r.anchorStayDays)),n(r.anchorStayHours),formatConsumption(r.anchorUsage),Math.floor(n(r.portStayDays)),n(r.portStayHours),formatConsumption(r.seaUsage),formatConsumption(r.portUsage),r.notes]));
  const tanks=[['Sequence','Group','Tank Name','Capacity','Present ROB','Unpumpable','Consumable','Role']];
  state.tanks.forEach(t=>tanks.push([n(t.sequence),groupLabel(t.group),t.name,n(t.capacity),n(t.rob),n(t.unpumpable),t.consumable!==false?'Yes':'No',t.category]));
  const rates=[['Type','ID','Name','Unit','At Sea / Day','In Port / Day','At Anchor/Drift / Day','Reserve Days','Reserve Basis / Day']];
  [...state.fuels,...state.lubes].forEach(p=>rates.push([state.fuels.some(f=>f.id===p.id)?'Fuel':'Lubricant',p.id,p.name,p.unit,n(p.seaRate),n(p.portRate),n(p.anchorRate),n(p.reserveDays),n(p.reserveRate)]));
  const summary=[['BUNKER & ROB PLANNER — SUMMARY','','',''],['Vessel',state.meta.vesselName||'—'],['Voyage / passage no.',state.meta.voyageNo||'—'],['Date of noon report entry (UTC)',state.meta.startUtc||'—'],['Present position',state.meta.currentPosition||'—'],['Position status',state.meta.positionMode||'—'],['Planned voyage duration (days)',calc.totals.totalVoyageDays],['Route stops',calc.results.length],['Planning alerts',buildAlertItems().length],[],['Fuel / lubricant','Present / final ROB','Total consumption','Total bunkering']];
  [...state.fuels,...state.lubes].forEach(p=>{const last=calc.results.at(-1);const rob=last?.departureFuel?.[p.id]??last?.departureLube?.[p.id]??groupRob(state.tanks,p.id);summary.push([p.name,rob,calc.totals.consumption[p.id]||0,calc.totals.bunker[p.id]||0]);});
  return[
    {name:'Summary',rows:summary,styleMap:{0:'title',10:'header'},merges:['A1:D1']},
    {name:'Route',rows:route},
    {name:'Tanks',rows:tanks},
    {name:'Rates',rows:rates}
  ];
}
function xmlEsc(v){return String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;').replace(/\r/g,'&#13;').replace(/\n/g,'&#10;');}
function colName(i){let s='';i++;while(i){const r=(i-1)%26;s=String.fromCharCode(65+r)+s;i=Math.floor((i-1)/26);}return s;}
function colWidths(rows){
  const maxCols=Math.max(1,...rows.map(r=>r.length)),widths=[];
  for(let c=0;c<maxCols;c++){let max=8;rows.forEach(r=>{const len=String(r[c]??'').length;if(len>max)max=len;});widths.push(Math.min(42,Math.max(10,max+2)));}
  return widths;
}
// Style ids (see styles.xml built in exportXlsx): 0 base, 1 header, 2 title,
// 3/4 text rows (even/odd), 5/6 numeric rows (even/odd, 2-decimal format).
function sheetXml(rows,styleMap={},freezeRows=1,merges=[]){
  const maxCols=Math.max(1,...rows.map(r=>r.length)),widths=colWidths(rows);
  let xml='<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="'+freezeRows+'" topLeftCell="A'+(freezeRows+1)+'" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetFormatPr defaultRowHeight="18"/><cols>';
  for(let i=1;i<=maxCols;i++)xml+=`<col min="${i}" max="${i}" width="${widths[i-1]}" customWidth="1"/>`;
  xml+='</cols><autoFilter ref="A1:'+colName(maxCols-1)+rows.length+'"/><sheetData>';
  rows.forEach((row,ri)=>{
    const kind=styleMap[ri]??(ri===0?'header':(ri%2===0?'even':'odd'));
    const rowHeight=kind==='title'?30:(kind==='header'?26:18);
    xml+=`<row r="${ri+1}" ht="${rowHeight}">`;
    row.forEach((v,ci)=>{
      const ref=`${colName(ci)}${ri+1}`,isNum=typeof v==='number'&&Number.isFinite(v);
      let sid;
      if(kind==='title')sid=2;else if(kind==='header')sid=1;else sid=isNum?(kind==='even'?5:6):(kind==='even'?3:4);
      if(isNum)xml+=`<c r="${ref}" s="${sid}"><v>${v}</v></c>`;
      else{const text=xmlEsc(v);xml+=`<c r="${ref}" t="inlineStr" s="${sid}"><is><t xml:space="preserve">${text}</t></is></c>`;}
    });
    xml+='</row>';
  });
  xml+='</sheetData>';
  if(merges.length)xml+=`<mergeCells count="${merges.length}">${merges.map(m=>`<mergeCell ref="${m}"/>`).join('')}</mergeCells>`;
  xml+='</worksheet>';
  return xml;
}
function crc32(data){let c=0xFFFFFFFF;for(let i=0;i<data.length;i++){c^=data[i];for(let k=0;k<8;k++)c=(c>>>1)^((c&1)?0xEDB88320:0);}return (c^0xFFFFFFFF)>>>0;}
function u32(n){return new Uint8Array([n&255,(n>>>8)&255,(n>>>16)&255,(n>>>24)&255]);}
function u16(n){return new Uint8Array([n&255,(n>>>8)&255]);}
function zipStore(files){
  const enc=new TextEncoder(),parts=[],central=[];let offset=0;
  for(const file of files){
    const name=enc.encode(file.name),data=typeof file.data==='string'?enc.encode(file.data):file.data,crc=crc32(data);
    const lh=new Uint8Array([
      0x50,0x4b,0x03,0x04,...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...name
    ]);
    parts.push(lh,data);
    const ch=new Uint8Array([
      0x50,0x4b,0x01,0x02,...u16(20),...u16(20),...u16(0),...u16(0),...u16(0),...u16(0),
      ...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),...u16(0),...u16(0),...u16(0),...u16(0),
      ...u32(0),...u32(offset),...name
    ]);
    central.push(ch);offset+=lh.length+data.length;
  }
  const cdOffset=offset,cdSize=central.reduce((a,b)=>a+b.length,0);
  const end=new Uint8Array([
    0x50,0x4b,0x05,0x06,...u16(0),...u16(0),...u16(central.length),...u16(central.length),...u32(cdSize),...u32(cdOffset),...u16(0)
  ]);
  parts.push(...central,end);
  const out=new Uint8Array(parts.reduce((a,b)=>a+b.length,0));let at=0;
  for(const part of parts){out.set(part,at);at+=part.length;}
  return out;
}

function buildXlsxBytes(){
  const sheets=workbookSheets();
  const contentTypes=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_,i)=>`<Override PartName="/xl/worksheets/sheet${i+1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>`;
  const rootRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;
  const wbRels=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_,i)=>`<Relationship Id="rId${i+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i+1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length+1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
  const workbook=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s,i)=>`<sheet name="${xmlEsc(s.name)}" sheetId="${i+1}" r:id="rId${i+1}"/>`).join('')}</sheets></workbook>`;
  const styles=`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts><fonts count="4"><font><sz val="10"/><name val="Aptos"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Aptos Display"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="15"/><name val="Aptos Display"/></font><font><color rgb="FF17394F"/><sz val="10"/><name val="Aptos"/></font></fonts><fills count="5"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="solid"><fgColor rgb="0B2942"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="147D92"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="E8F1F5"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="F4F8FA"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="2"><border/><border><left style="thin"><color rgb="B7C9D3"/></left><right style="thin"><color rgb="B7C9D3"/></right><top style="thin"><color rgb="B7C9D3"/></top><bottom style="thin"><color rgb="B7C9D3"/></bottom></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="7"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/><xf numFmtId="0" fontId="1" fillId="1" borderId="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="2" fillId="2" borderId="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="3" borderId="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="4" borderId="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="164" fontId="3" fillId="3" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf><xf numFmtId="164" fontId="3" fillId="4" borderId="1" applyNumberFormat="1" applyAlignment="1"><alignment vertical="center" horizontal="right"/></xf></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`;
  const files=[{name:'[Content_Types].xml',data:contentTypes},{name:'_rels/.rels',data:rootRels},{name:'xl/workbook.xml',data:workbook},{name:'xl/_rels/workbook.xml.rels',data:wbRels},{name:'xl/styles.xml',data:styles},...sheets.map((sh,i)=>({name:`xl/worksheets/sheet${i+1}.xml`,data:sheetXml(sh.rows,sh.styleMap||{},1,sh.merges||[])}))];
  return zipStore(files);
}
function exportXlsx(){
  downloadBytes('bunker-voyage-planner.xlsx',buildXlsxBytes(),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
}
/* Export XLS: earlier builds saved the real .xlsx (zip/OOXML) bytes under an .xls file name — desktop
   Excel tolerates that (with a "format doesn't match extension" prompt) but many mobile Excel/WPS/Sheets
   apps dispatch purely on the .xls extension to a legacy-binary parser and fail to open it outright.
   This instead writes genuine "SpreadsheetML 2003" XML — a single plain-text file, not a zip — which is
   the well-established, universally supported format for a real .xls-named export. */
function ssmlCell(v){
  if(typeof v==='number'&&Number.isFinite(v))return `<Cell><Data ss:Type="Number">${v}</Data></Cell>`;
  return `<Cell><Data ss:Type="String">${xmlEsc(v)}</Data></Cell>`;
}
function ssmlSheet(sheet){
  const rows=sheet.rows.map((row,ri)=>`<Row>${row.map(v=>ssmlCell(v)).join('')}</Row>`).join('');
  return `<Worksheet ss:Name="${xmlEsc(sheet.name)}"><Table>${rows}</Table></Worksheet>`;
}
function buildSpreadsheetMLXml(){
  const sheets=workbookSheets();
  return `<?xml version="1.0"?><?mso-application progid="Excel.Sheet"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><DocumentProperties xmlns="urn:schemas-microsoft-com:office:office"><Title>Bunker Voyage Planner</Title></DocumentProperties>${sheets.map(ssmlSheet).join('')}</Workbook>`;
}
function exportXls(){
  download('bunker-voyage-planner.xls',buildSpreadsheetMLXml(),'application/vnd.ms-excel');
}

const TOUR_STEPS=[
  {tab:'setup',sel:'#vesselName',title:'1 · Name your vessel',text:'Start here — enter the vessel name. It appears on the dashboard.'},
  {tab:'setup',sel:'#startUtc',title:'2 · Set the noon report date',text:'Enter the UTC date/time of the noon report — every ETA/ETD is calculated from this point, and it pairs with the noon report ROB fields below it.'},
  {tab:'setup',sel:'#ratesList',title:'3 · Set consumption rates',text:'For each fuel/lube: at-sea, in-port and at-anchor/drift rates, plus reserve days and reserve/day.'},
  {tab:'tanks',sel:'[data-add-tank]',title:'4 · Add your tanks',text:'Tap "+ Tank" under a group, choose its role and where it should sit in the list, then fill in capacity, present ROB and unpumpable quantity.'},
  {tab:'tanks',sel:'#tankList',fullScreen:true,title:'5 · Set tank details',text:'Open a tank to set its consumption sequence, role (storage/settling/service/support) and — for settling/service tanks — which one is in service. Use the arrows on the right of the tank to move it up or down the list.'},
  {tab:'tanks',sel:'#maxFillBar',title:'6 · Set your maximum tank fill',text:'Your company’s maximum storage in tanks (e.g. 85% or 90%) drives the proposed bunker / replenish quantity and the over-fill warning. Tap Change here any time.',onEnter:'maxfill'},
  {tab:'voyage',sel:'#addRouteInline',title:'7 · Build the route',text:'Tap "Add port" for each call: distance, speed, anchor/drift and port stay, and UTC offset.'},
  {tab:'bunkering',sel:'#bunkerList',title:'8 · Plan bunkering & lube oil',text:'For each port, record a planned fuel bunker or lube oil replenishment and preview the tank condition at ETA/ETD.'},
  {tab:'eca',sel:'#ecaList',title:'9 · ECA/SECA changeover',text:'If the voyage enters an Emission Control Area, plan the fuel changeover here — per system (Main Engine, Aux. Engine, Boiler), with planning time, start/finish and vessel position.'},
  {tab:'dashboard',sel:'#routeSummary',title:'10 · Review the dashboard',text:'See fuel/lube ROB and tank ROB at ETA/ETD. Tap any value to see how it was calculated. Planning alerts are under the bell icon in the top bar.'},
  {tab:'results',sel:'#saveVoyageBtn',title:'11 · Save your work',text:'Save the voyage under a name to reopen it anytime on this device.'}
];
let tourIndex=-1;
function tourOverlayEls(){
  let ov=$('#tourOverlay');
  if(!ov){
    ov=document.createElement('div');ov.id='tourOverlay';ov.className='tour-overlay';
    ov.innerHTML=`<div class="tour-hole"></div><div class="tour-card"><div class="tour-head"><div class="tour-step-count"></div><button type="button" class="ghost sm tour-min" id="tourMin" aria-label="Minimize guide" aria-expanded="true" title="Minimize">–</button></div><h4 class="tour-title"></h4><p class="tour-text"></p><div class="tour-actions"><button type="button" class="ghost sm" id="tourSkip">Skip</button><span style="flex:1"></span><button type="button" class="secondary sm" id="tourPrev">Back</button><button type="button" class="primary sm" id="tourNext">Next</button></div></div>`;
    document.body.appendChild(ov);
    ov.querySelector('#tourSkip').onclick=endTour;
    const setMin=m=>{ov.classList.toggle('min',m);const b=ov.querySelector('#tourMin');b.textContent=m?'▴':'–';b.setAttribute('aria-label',m?'Expand guide':'Minimize guide');b.setAttribute('aria-expanded',String(!m));b.title=m?'Expand':'Minimize';};
    ov.querySelector('#tourMin').onclick=e=>{e.stopPropagation();setMin(!ov.classList.contains('min'));};
    ov.querySelector('.tour-card').addEventListener('click',()=>{if(ov.classList.contains('min'))setMin(false);});
    ov.querySelector('#tourPrev').onclick=()=>gotoTourStep(tourIndex-1);
    ov.querySelector('#tourNext').onclick=()=>gotoTourStep(tourIndex+1);
  }
  return ov;
}
function endTour(){
  const ov=$('#tourOverlay');if(ov)ov.remove();
  document.querySelectorAll('.tour-target').forEach(el=>el.classList.remove('tour-target'));
  tourIndex=-1;
  try{localStorage.setItem('bunker-tour-seen','1');}catch{}
}
function positionTourCard(target,card,hole,fullScreen){
  if(fullScreen){
    hole.style.top='0px';hole.style.left='0px';hole.style.width='100vw';hole.style.height='100vh';
  }else{
    const r=target.getBoundingClientRect(),pad=6;
    hole.style.top=(r.top-pad)+'px';hole.style.left=(r.left-pad)+'px';hole.style.width=(r.width+pad*2)+'px';hole.style.height=(r.height+pad*2)+'px';
  }
  const cardH=card.offsetHeight||160,cardW=card.offsetWidth||280;
  const r=target.getBoundingClientRect();
  let top=fullScreen?Math.max(10,(window.innerHeight-cardH)/2):r.bottom+14;
  if(!fullScreen&&top+cardH>window.innerHeight-10)top=Math.max(10,r.top-cardH-14);
  card.style.top=top+'px';
  card.style.left=fullScreen?Math.max(10,(window.innerWidth-cardW)/2)+'px':Math.min(Math.max(10,r.left),window.innerWidth-cardW-10)+'px';
}
/* Waits for the smooth scrollIntoView to actually settle (rather than a fixed delay) before measuring
   the target's position — a fixed short timeout could fire mid-scroll, especially for a sticky-positioned
   target like the "Add port" button, leaving the highlight hole visibly off the element. */
function waitForScrollSettle(cb){
  let lastY=window.scrollY,stable=0;
  const tick=()=>{
    if(window.scrollY===lastY){stable++;}else{stable=0;lastY=window.scrollY;}
    if(stable>=3){cb();return;}
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
  setTimeout(cb,900); // hard safety net
}
function gotoTourStep(i){
  document.querySelectorAll('.tour-target').forEach(el=>el.classList.remove('tour-target'));
  if(i<0)return;
  if(i>=TOUR_STEPS.length){endTour();return;}
  const step=TOUR_STEPS[i];
  if(step.onEnter==='maxfill')markMaxFillSeen();   // the tour covers it, so no pop-up later
  tourIndex=i;
  showTab(step.tab,{scroll:false});
  requestAnimationFrame(()=>{
    const target=document.querySelector(step.sel);
    if(!target){i<TOUR_STEPS.length-1?gotoTourStep(i+1):endTour();return;}
    target.classList.add('tour-target');
    const ov=tourOverlayEls(),card=ov.querySelector('.tour-card'),hole=ov.querySelector('.tour-hole');
    ov.querySelector('.tour-step-count').textContent=`Step ${i+1} of ${TOUR_STEPS.length}`;
    ov.querySelector('.tour-title').textContent=step.title;
    ov.querySelector('.tour-text').textContent=step.text;
    ov.querySelector('#tourPrev').disabled=i===0;
    ov.querySelector('#tourNext').textContent=i===TOUR_STEPS.length-1?'Finish':'Next';
    if(step.fullScreen){
      window.scrollTo({top:0});
      positionTourCard(target,card,hole,true);
    }else{
      target.scrollIntoView({block:'center',behavior:'smooth'});
      waitForScrollSettle(()=>positionTourCard(target,card,hole,false));
    }
  });
}
function startTour(){gotoTourStep(0);}
function loadSavedVoyages(){try{const v=JSON.parse(localStorage.getItem(SAVED_VOYAGES_KEY)||'[]');return Array.isArray(v)?v:[];}catch{return[];}}
function writeSavedVoyages(list){try{localStorage.setItem(SAVED_VOYAGES_KEY,JSON.stringify(list.slice(0,30)));return true;}catch{return false;}}
function renderSavedVoyages(){
  const box=$('#savedVoyageList');if(!box)return;
  const list=loadSavedVoyages();
  box.innerHTML=list.length?list.slice().sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).map(v=>`<div class="saved-voyage-row" data-saved-id="${esc(v.id)}"><div class="sv-info"><strong>${esc(v.name)}</strong><small>Saved ${fmtUTC(v.savedAt)}</small></div><div class="sv-actions"><button type="button" class="secondary sm" data-load-voyage="${esc(v.id)}">Load</button><button type="button" class="danger ghost sm" data-delete-voyage="${esc(v.id)}">${ICON.trash}</button></div></div>`).join(''):'<div class="empty">No saved voyages yet — enter a name above and tap Save.</div>';
}
function safeFileName(name){return (name||'voyage').replace(/[^a-z0-9\-_ ]/gi,'').trim().replace(/\s+/g,'-').slice(0,60)||'voyage';}
/* The anchor is appended to the DOM before .click() and removed after — some mobile browsers/WebViews
   only trigger the native download for an <a download> that is actually attached to the document. */
function triggerDownload(a){document.body.appendChild(a);a.click();requestAnimationFrame(()=>a.remove());}
function download(name,text,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type}));a.download=name;triggerDownload(a);setTimeout(()=>URL.revokeObjectURL(a.href),1000);}
function downloadBytes(name,bytes,type){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([bytes],{type}));a.download=name;triggerDownload(a);setTimeout(()=>URL.revokeObjectURL(a.href),1000);}

function demoState(){const s=defaultState();s.meta={...s.meta,vesselName:'Demo Vessel',voyageNo:'DEMO-001',startUtc:'2026-09-24T00:00',currentPosition:'Philippine Sea',positionMode:'underway',notes:'Example values only — replace with vessel records.',noonRob:{fo:525,do:78,cyl:410,mesys:1250,gesys:340}};s.fuels[0].seaRate=25;s.fuels[0].portRate=2;s.fuels[0].reserveRate=25;s.fuels[1].seaRate=.1;s.fuels[1].portRate=.1;s.fuels[1].reserveRate=.1;s.lubes[0].seaRate=205;s.lubes[0].reserveRate=205;s.tanks=[{id:'fo1p',group:'fo',name:'No.1 FO Tank (P)',capacity:410,rob:300,unpumpable:2.5,consumable:true,category:'storage',sequence:1,order:0},{id:'fo1s',group:'fo',name:'No.1 FO Tank (S)',capacity:430,rob:200,unpumpable:2.5,consumable:true,category:'storage',sequence:2,order:1},{id:'fo2p',group:'fo',name:'No.2 FO Tank (P)',capacity:180,rob:0,unpumpable:0,consumable:true,category:'storage',sequence:3,order:2},{id:'fo2s',group:'fo',name:'No.2 FO Tank (S)',capacity:430,rob:0,unpumpable:0,consumable:true,category:'storage',sequence:4,order:3},{id:'fo-sett',group:'fo',name:'FO Settling Tank No.1',capacity:8.8,rob:7,unpumpable:0,consumable:false,category:'settling',sequence:99,order:4,inService:true},{id:'fo-serv',group:'fo',name:'FO Service Tank No.1',capacity:14.1,rob:11.2,unpumpable:0,consumable:false,category:'service',sequence:100,order:5,inService:true},{id:'blr-serv',group:'fo',name:'Boiler FO Service Tank',capacity:1,rob:0.8,unpumpable:0,consumable:false,category:'support',sequence:101,order:6},{id:'do1p',group:'do',name:'No.1 DO Tank (P)',capacity:60,rob:40,unpumpable:.5,consumable:true,category:'storage',sequence:1,order:0},{id:'do1s',group:'do',name:'No.1 DO Tank (S)',capacity:60,rob:30,unpumpable:.5,consumable:true,category:'storage',sequence:2,order:1},{id:'do-serv',group:'do',name:'DO Service Tank No.1',capacity:9.6,rob:7.6,unpumpable:0,consumable:false,category:'service',sequence:99,order:2,inService:true},{id:'cyl-tk',group:'cyl',name:'Cylinder Oil Storage Tank',capacity:16000,rob:11000,unpumpable:0,consumable:true,category:'storage',sequence:1,order:0},{id:'mesys-tk',group:'mesys',name:'ME System Oil Tank',capacity:10000,rob:8000,unpumpable:0,consumable:true,category:'storage',sequence:1,order:0},{id:'gesys-tk',group:'gesys',name:'GE System Oil Tank',capacity:5000,rob:4000,unpumpable:0,consumable:true,category:'storage',sequence:1,order:0}];s.active={fo:0,do:0};s.route=[{port:'START PORT',distanceNm:0,speedKn:10.5,portStayDays:1,utcOffset:8,notes:'Starting port',bunkers:{}},{port:'PORT A',distanceNm:625,speedKn:10.2,portStayDays:.5,utcOffset:8,notes:'',bunkers:{}},{port:'PORT B',distanceNm:2286,speedKn:10.2,portStayDays:1,utcOffset:8,notes:'Planned bunker port',bunkers:{fo:{quantity:250,autoAllocate:true,allocations:[]},do:{quantity:15,autoAllocate:true,allocations:[]}}}];return s;}

function maybeAutoTour(){
  let seen=true;try{seen=!!localStorage.getItem('bunker-tour-seen');}catch{}
  if(!seen)setTimeout(startTour,350);          // first launch: Guide me comes first
  else if(lastAlertCount>0)setTimeout(()=>toastAlerts(lastAlertCount),500);
}
function dismissIntro(){const intro=$('#introScreen');if(intro){intro.remove();maybeAutoTour();}}
function initialTab(){const h=location.hash.slice(1);if(TAB_TITLES[h])return h;try{const t=sessionStorage.getItem('bunker-tab');if(TAB_TITLES[t])return t;}catch{}return'dashboard';}
function init(){
  uiOpen.add('robwhole'); // Tank ROB at ETA→ETD block starts expanded
  bind();applyHints();renderAll();showTab(initialTab(),{scroll:false});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
  const intro=$('#introScreen');
  if(!intro)maybeAutoTour();
  if(intro){
    // Runs on every load (no "seen before" gate) and lasts exactly 3s in total — see the
    // .intro-screen animation-delay + animation-duration in styles.css, which must sum to 3s.
    intro.addEventListener('click',dismissIntro);
    intro.addEventListener('animationend',e=>{if(e.animationName==='introFadeOut')dismissIntro();});
    setTimeout(dismissIntro,3300); // safety net in case the animationend event doesn't fire
  }
  // Explanation text lingers briefly after a field loses focus so a native dropdown
  // opening over it doesn't just make it vanish.
  document.addEventListener('focusin',e=>{
    const field=e.target.closest('.field');
    if(!field)return;
    field.classList.add('help-visible');
    if(field._helpHideTimer){clearTimeout(field._helpHideTimer);field._helpHideTimer=null;}
  });
  document.addEventListener('focusout',e=>{
    const field=e.target.closest('.field');
    if(!field)return;
    field._helpHideTimer=setTimeout(()=>{field.classList.remove('help-visible');field._helpHideTimer=null;},3000);
  });
}
init();
