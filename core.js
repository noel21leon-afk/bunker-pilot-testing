export const HOURS_PER_DAY = 24;
const EPS = 1e-9;
export const clampNonNegative = v => Math.max(0, Number.isFinite(Number(v)) ? Number(v) : 0);
/* Settling, service and support tanks are fixed-ROB (counted in totals but never drained/bunkered automatically). */
export const isConsumableTank = t => t.consumable !== false && t.category !== 'support' && t.category !== 'service' && t.category !== 'settling';
export const num = (v,fallback=0) => Number.isFinite(Number(v)) ? Number(v) : fallback;
export function seaDays(distanceNm,speedKn){const d=num(distanceNm),s=num(speedKn);return s>0?d/s/HOURS_PER_DAY:0;}
export function consumptionOrder(tanks){return [...(tanks||[])].sort((a,b)=>num(a.sequence,9999)-num(b.sequence,9999) || String(a.name||'').localeCompare(String(b.name||'')) || String(a.id).localeCompare(String(b.id)));}
export function formatMt(v){return `${num(v).toFixed(2)} MT`;}
export function formatLitres(v){return `${num(v).toFixed(0)} L`;}
export function consumeTankGroup(tanks,activeIndex,quantity){
  const out=consumptionOrder(tanks).map(t=>({...t,rob:clampNonNegative(t.rob)})); const q=clampNonNegative(quantity);
  if(!out.length||q===0)return{tanks:out,activeIndex:Math.max(0,Math.min(num(activeIndex),Math.max(0,out.length-1))),shortage:0,withdrawals:[]};
  let idx=Math.max(0,Math.min(num(activeIndex),out.length-1)),remaining=q; const withdrawals=[]; let visited=0;
  while(remaining>EPS&&visited<out.length){const tank=out[idx];const take=Math.min(remaining,clampNonNegative(tank.rob));if(take>0){tank.rob-=take;withdrawals.push({id:tank.id,name:tank.name,quantity:take});remaining-=take;}if(remaining<=EPS)break;idx=(idx+1)%out.length;visited++;}
  return{tanks:out,activeIndex:idx,shortage:remaining,withdrawals};
}
export function refillTanks(tanks,allocations){const out=(tanks||[]).map(t=>({...t,rob:clampNonNegative(t.rob)}));let overflow=0;const applied=[];for(const a of allocations||[]){const i=out.findIndex(t=>t.id===a.tankId);if(i<0)continue;const tank=out[i],capacity=Math.max(0,num(tank.capacity)),qty=clampNonNegative(a.quantity),space=Math.max(0,capacity-tank.rob),add=Math.min(qty,space);tank.rob+=add;overflow+=qty-add;if(add>EPS)applied.push({tankId:tank.id,tankName:tank.name,quantity:add});}return{tanks:out,overflow,applied};}
/* Maximum recommended fill level when loading bunkers — leaves ullage/expansion space.
   Auto-allocation fills to this level first; only if the full quantity still doesn't fit
   does it spill over toward 100% capacity (the caller should warn when that happens). */
export const MAX_LOAD_FRAC=0.85;
/* Company maximum tank fill (meta.maxFillPct, 50-100 %) overrides the 85% default. */
export function maxFillFrac(meta){const p=Number(meta&&meta.maxFillPct);return Number.isFinite(p)&&p>=50&&p<=100?p/100:MAX_LOAD_FRAC;}
export function allocateBunkerByCapacity(tanks,quantity,noMixing=false,opts={}){
  const maxFillFrac=Number.isFinite(opts.maxFillFrac)?opts.maxFillFrac:1;
  let remaining=clampNonNegative(quantity),allocations=[];
  const pool=consumptionOrder(tanks).filter(tank=>!noMixing||clampNonNegative(tank.rob)<=EPS);
  for(const tank of pool){if(remaining<=EPS)break;const cap=Math.max(0,num(tank.capacity)),fillLimit=cap*maxFillFrac,space=Math.max(0,fillLimit-clampNonNegative(tank.rob)),add=Math.min(space,remaining);if(add>EPS){allocations.push({tankId:tank.id,quantity:add});remaining-=add;}}
  if(remaining>EPS&&maxFillFrac<1){
    // Not enough room within the recommended level — top up further toward full capacity so the
    // bunker quantity is still accounted for; the caller flags the affected tanks as over the
    // recommended fill level.
    for(const tank of pool){if(remaining<=EPS)break;const cap=Math.max(0,num(tank.capacity)),already=allocations.filter(a=>a.tankId===tank.id).reduce((s,a)=>s+a.quantity,0),space=Math.max(0,cap-clampNonNegative(tank.rob)-already),add=Math.min(space,remaining);if(add>EPS){const existing=allocations.find(a=>a.tankId===tank.id);if(existing)existing.quantity+=add;else allocations.push({tankId:tank.id,quantity:add});remaining-=add;}}
  }
  return{allocations,unallocated:remaining};
}
/* Default fuel sub-type for a tank that predates the fuel-type field (backward compatibility). */
export function defaultFuelType(group){return group==='fo'?'vlsfo':group==='do'?'lsmgo':null;}
/* Whether a bunker of this sub-type may be mixed into a tank that already carries ROB. */
export function normFuelType(v){return String(v==null?'':v).trim().toLowerCase();}
/* Only VLSFO is treated as non-mixable (a new VLSFO batch must not be blended with old VLSFO ROB —
   stability/compatibility risk). HFO, diesel oils and biodiesel may be topped up into a tank that
   already holds the SAME type. Manually typed grades count as VLSFO if the text says so. */

/* ---------------------------------------------------------------------------------------------
   ASTM/IP/API Petroleum Measurement Tables — Table 54B (Generalized Products, Volume Correction
   Factor) and Table 56 (Weight Correction Factor). Used to turn a sounded/dipped tank volume
   ("Corrected GOV", m3, already corrected for trim/list/calibration) plus its observed temperature
   into a weight in air (MT), given the fuel's density at 15C. Formula and K0/K1 breakpoints are the
   published ASTM Table 54B generalized-products equation; verified against the ASTM worked examples.
   --------------------------------------------------------------------------------------------- */
export function vcf54B(den15KgM3,tempC){
  const d=num(den15KgM3);
  if(!(d>0))return 1;
  const dT=num(tempC)-15;
  let alpha;
  if(d<=770)alpha=(346.42278+0.43884*d)/(d*d);
  else if(d<778)alpha=-0.0033612+2680.32/(d*d); // narrow transition zone between the <=770 and 778-839 tables
  else if(d<839)alpha=594.5418/(d*d);
  else alpha=(186.9696+0.48618*d)/(d*d);
  return Math.exp(-alpha*dT*(1+0.8*alpha*dT));
}
/* Table 56: weight correction factor, i.e. density at 15C in air = density at 15C in vacuum minus 1.1 kg/m3. */
export function wcf56(den15KgM3){return Math.max(0,num(den15KgM3)-1.1);}
/* Corrected GOV (m3) + observed temperature (C) + density at 15C (t/m3) -> weight in air (MT):
   GSV = GOV x VCF(54B)  ->  MT = GSV x WCF(56) / 1000. */
export function robFromVolume(volumeM3,tempC,densityTPerM3){
  const v=Math.max(0,num(volumeM3)),den15=Math.max(0,num(densityTPerM3))*1000;
  if(!(v>0)||!(den15>0))return 0;
  const gsv=v*vcf54B(den15,tempC);
  return gsv*wcf56(den15)/1000;
}
export function fuelTypeNoMixing(fuelType){return /vlsfo/.test(normFuelType(fuelType));}
export function totalRob(state){return(state.tanks||[]).reduce((sum,t)=>sum+clampNonNegative(t.rob),0);}
export function groupRob(tanks,group){return(tanks||[]).filter(t=>t.group===group).reduce((sum,t)=>sum+clampNonNegative(t.rob),0);}
export function groupConsumableRob(tanks,group){return(tanks||[]).filter(t=>t.group===group&&isConsumableTank(t)).reduce((sum,t)=>sum+clampNonNegative(t.rob),0);}
export function tankCapacity(tanks,group){return(tanks||[]).filter(t=>t.group===group).reduce((sum,t)=>sum+Math.max(0,num(t.capacity)),0);}
export function tankUnpumpable(tanks,group){return(tanks||[]).filter(t=>t.group===group).reduce((sum,t)=>sum+Math.max(0,num(t.unpumpable)),0);}
export function rateFor(profile,phase){return Math.max(0,num(phase==='sea'?profile.seaRate:profile.portRate));}
/* Per-port override of the in-port / anchor-drift daily consumption (Voyage tab). Blank = use the default. */
function stopOverride(stop,phase,id){const v=stop&&stop.consOverride&&stop.consOverride[phase]&&stop.consOverride[phase][id];if(v===''||v===null||v===undefined)return null;const x=Number(v);return Number.isFinite(x)&&x>=0?x:null;}
export function portRateFor(stop,id,profile){const o=stopOverride(stop,'port',id);return o!==null?o:rateFor(profile,'port');}
/* Anchor/drift default = the in-port rate (a legacy plan's own anchor rate is still honoured). */
export function anchorRateFor(stop,id,profile){const o=stopOverride(stop,'anchor',id);if(o!==null)return o;const a=Math.max(0,num(profile.anchorRate));return a>0?a:rateFor(profile,'port');}
/* When a fuel profile tracks VLSFO and HFO consumption separately (foMode:'both'), each route point
   picks which one is actually being burned (stop.foActiveFuel); 'vlsfo' mode/rates are the profile's own
   top-level fields, 'hfo' mode/rates come from the profile's nested .hfo rate set. */
export function resolveFoActiveFuel(fuel,stop){
  if(!fuel||fuel.id!=='fo')return null;
  const mode=fuel.foMode||'vlsfo';
  if(mode==='hfo')return'hfo';
  if(mode==='both')return(stop&&stop.foActiveFuel==='hfo')?'hfo':'vlsfo';
  return'vlsfo';
}
export function effectiveFuelRates(fuel,activeKey,insideEca){
  if(fuel&&fuel.id==='do'&&insideEca&&fuel.doEcaSplit)return{...fuel,...(fuel.insideEca||{})};
  if(!fuel||fuel.id!=='fo'||activeKey!=='hfo')return fuel;
  if(fuel.sameAsVlsfo)return fuel; // HFO rates deliberately mirror VLSFO rates — nothing to override
  return{...fuel,...(fuel.hfo||{})};
}
function updateGroupFromConsumption(tanks,group,activeIndex,qty){const ordered=consumptionOrder(tanks.filter(t=>t.group===group&&isConsumableTank(t)));const res=consumeTankGroup(ordered,activeIndex,qty);return{ordered:res.tanks,activeIndex:res.activeIndex,shortage:res.shortage,withdrawals:res.withdrawals};}
function writeOrdered(tanks,ordered){for(const t of ordered){const i=tanks.findIndex(x=>x.id===t.id);if(i>=0)tanks[i]={...tanks[i],rob:t.rob};}}
export function calculateVoyage(input){
  const startUtc=input.startUtc||input.meta?.startUtc||new Date().toISOString(),fuels=input.fuels||[],lubes=input.lubes||[],route=input.route||[];
  let tanks=(input.tanks||[]).map((t,i)=>({...t,sequence:num(t.sequence,i+1),rob:clampNonNegative(t.rob)})); const active={...(input.active||{})}; const results=[];
  let prevDeparture=new Date(startUtc);if(Number.isNaN(prevDeparture.getTime()))prevDeparture=new Date();
  const all=[...fuels,...lubes],consumptionTotals=Object.fromEntries(all.map(p=>[p.id,0])),seaConsumptionTotals=Object.fromEntries(all.map(p=>[p.id,0])),portConsumptionTotals=Object.fromEntries(all.map(p=>[p.id,0])),anchorConsumptionTotals=Object.fromEntries(all.map(p=>[p.id,0])),shortages=[];
  const MAXF=maxFillFrac(input.meta),bunkerTotals=Object.fromEntries([...fuels,...lubes].map(p=>[p.id,0]));
  let insideEca=false; // running state: whether the vessel is inside an ECA/SECA, driven by each port's entering/leaving flags
  route.forEach((stop,index)=>{
    const speed=num(stop.speedKn),dist=Math.max(0,num(stop.distanceNm)),sd=index===0?0:seaDays(dist,speed);
    let arrival=new Date(prevDeparture.getTime()+sd*86400000);
    if(index===0&&stop.eta){const customEta=new Date(stop.eta);if(!Number.isNaN(customEta.getTime()))arrival=customEta;}
    const doInsideAtSea=insideEca; // state for the sea leg approaching this port (before this port's own entering/leaving applies)
    const seaUsage={},portUsage={},bunkerInfo={},tankBefore=tanks.map(t=>({...t}));
    for(const fuel of fuels){const foKey=resolveFoActiveFuel(fuel,stop),ef=effectiveFuelRates(fuel,foKey,fuel.id==='do'&&doInsideAtSea);const qty=rateFor(ef,'sea')*sd;seaUsage[fuel.id]=qty;consumptionTotals[fuel.id]+=qty;seaConsumptionTotals[fuel.id]+=qty;const groupTanks=tanks.filter(t=>t.group===fuel.id&&isConsumableTank(t)),consumed=updateGroupFromConsumption(tanks,fuel.id,active[fuel.id]||0,qty);active[fuel.id]=consumed.activeIndex;writeOrdered(tanks,consumed.ordered);if(consumed.shortage>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'sea',item:fuel.name,shortage:consumed.shortage});}
    for(const lub of lubes){const qty=rateFor(lub,'sea')*sd;seaUsage[lub.id]=qty;consumptionTotals[lub.id]+=qty;seaConsumptionTotals[lub.id]+=qty;const lt=consumptionOrder(tanks.filter(t=>t.group===lub.id&&isConsumableTank(t)))[0];if(lt){const take=Math.min(lt.rob,qty);lt.rob-=take;if(qty-take>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'sea',item:lub.name,shortage:qty-take});}else if(qty>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'sea',item:lub.name,shortage:qty,message:'No consumable tank configured'});}
    const activeAtArrival={...active},arrivalFuel=Object.fromEntries(fuels.map(f=>[f.id,groupRob(tanks,f.id)])),arrivalLube=Object.fromEntries(lubes.map(l=>[l.id,groupRob(tanks,l.id)])),tankAtArrival=tanks.map(t=>({...t}));
    if(stop.eca?.entering?.enabled)insideEca=true; // vessel crosses into the ECA/SECA around arrival at this port
    const doInsideAtStay=insideEca; // state for this port's anchor/drift and port stay
    const anchorStayDays=Math.max(0,num(stop.anchorStayDays))+Math.max(0,num(stop.anchorStayHours))/HOURS_PER_DAY,anchorUsage={};
    for(const fuel of fuels){const foKey=resolveFoActiveFuel(fuel,stop),ef=effectiveFuelRates(fuel,foKey,fuel.id==='do'&&doInsideAtStay);const qty=anchorRateFor(stop,fuel.id,ef)*anchorStayDays;anchorUsage[fuel.id]=qty;consumptionTotals[fuel.id]+=qty;anchorConsumptionTotals[fuel.id]+=qty;const consumed=updateGroupFromConsumption(tanks,fuel.id,active[fuel.id]||0,qty);active[fuel.id]=consumed.activeIndex;writeOrdered(tanks,consumed.ordered);if(consumed.shortage>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'anchor',item:fuel.name,shortage:consumed.shortage});}
    for(const lub of lubes){const qty=anchorRateFor(stop,lub.id,lub)*anchorStayDays;anchorUsage[lub.id]=qty;consumptionTotals[lub.id]+=qty;anchorConsumptionTotals[lub.id]+=qty;const lt=consumptionOrder(tanks.filter(t=>t.group===lub.id&&isConsumableTank(t)))[0];if(lt){const take=Math.min(lt.rob,qty);lt.rob-=take;if(qty-take>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'anchor',item:lub.name,shortage:qty-take});}else if(qty>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'anchor',item:lub.name,shortage:qty,message:'No consumable tank configured'});}
    const portStayDays=Math.max(0,num(stop.portStayDays))+Math.max(0,num(stop.portStayHours))/HOURS_PER_DAY;
    for(const fuel of fuels){const foKey=resolveFoActiveFuel(fuel,stop),ef=effectiveFuelRates(fuel,foKey,fuel.id==='do'&&doInsideAtStay);const qty=portRateFor(stop,fuel.id,ef)*portStayDays;portUsage[fuel.id]=qty;consumptionTotals[fuel.id]+=qty;portConsumptionTotals[fuel.id]+=qty;const consumed=updateGroupFromConsumption(tanks,fuel.id,active[fuel.id]||0,qty);active[fuel.id]=consumed.activeIndex;writeOrdered(tanks,consumed.ordered);if(consumed.shortage>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'port',item:fuel.name,shortage:consumed.shortage});}
    for(const lub of lubes){const qty=portRateFor(stop,lub.id,lub)*portStayDays;portUsage[lub.id]=qty;consumptionTotals[lub.id]+=qty;portConsumptionTotals[lub.id]+=qty;const lt=consumptionOrder(tanks.filter(t=>t.group===lub.id&&isConsumableTank(t)))[0];if(lt){const take=Math.min(lt.rob,qty);lt.rob-=take;if(qty-take>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'port',item:lub.name,shortage:qty-take});}else if(qty>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'port',item:lub.name,shortage:qty,message:'No consumable tank configured'});}
    for(const fuel of fuels){const event=(stop.bunkers||{})[fuel.id],totalQty=Math.max(0,num(event?.quantity));if(totalQty>0){
        const fuelType=event?.fuelType||(fuel.id==='fo'?resolveFoActiveFuel(fuel,stop):defaultFuelType(fuel.id));
        const allGroupTanks=consumptionOrder(tanks.filter(t=>t.group===fuel.id&&isConsumableTank(t)));
        const groupTanks=fuelType?allGroupTanks.filter(t=>normFuelType(t.fuelType||defaultFuelType(fuel.id))===normFuelType(fuelType)):allGroupTanks;
        let allocations=event?.allocations||[];const noMixing=fuelType?fuelTypeNoMixing(fuelType):(resolveFoActiveFuel(fuel,stop)==='vlsfo');
        if(event?.autoAllocate)allocations=allocateBunkerByCapacity(groupTanks,totalQty,noMixing,{maxFillFrac:MAXF}).allocations;
        const refill=refillTanks(groupTanks,allocations);refill.applied.forEach(a=>{const i=tanks.findIndex(t=>t.id===a.tankId);if(i>=0)tanks[i].rob+=a.quantity;});
        const allocatedQty=refill.applied.reduce((s,a)=>s+a.quantity,0),unalloc=Math.max(0,totalQty-allocatedQty)+refill.overflow;
        const overTanks=refill.applied.filter(a=>{const tk=tanks.find(x=>x.id===a.tankId);return tk&&num(tk.capacity)>0&&tk.rob>num(tk.capacity)*MAXF+EPS;}).map(a=>a.tankName);
        bunkerInfo[fuel.id]={quantity:totalQty,allocated:allocatedQty,unallocated:unalloc,allocations:refill.applied,fuelType,overTanks,over85:overTanks.length>0};
        bunkerTotals[fuel.id]+=allocatedQty;
        if(unalloc>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'bunkering',item:fuel.name,shortage:unalloc,message:noMixing?`${(fuelType||'This fuel').toUpperCase()} cannot be mixed with existing ROB and no matching empty tank was available`:'Bunker could not be allocated without exceeding tank capacity'});
      }else bunkerInfo[fuel.id]={quantity:0,allocated:0,unallocated:0,allocations:[],overTanks:[],over85:false};}
    for(const lube of lubes){const event=(stop.bunkers||{})[lube.id],totalQty=Math.max(0,num(event?.quantity));if(totalQty>0){const groupTanks=consumptionOrder(tanks.filter(t=>t.group===lube.id&&isConsumableTank(t)));let allocations=event?.allocations||[];if(event?.autoAllocate)allocations=allocateBunkerByCapacity(groupTanks,totalQty,false).allocations;const refill=refillTanks(groupTanks,allocations);refill.applied.forEach(a=>{const i=tanks.findIndex(t=>t.id===a.tankId);if(i>=0)tanks[i].rob+=a.quantity;});const allocatedQty=refill.applied.reduce((s,a)=>s+a.quantity,0),unalloc=Math.max(0,totalQty-allocatedQty)+refill.overflow;bunkerInfo[lube.id]={quantity:totalQty,allocated:allocatedQty,unallocated:unalloc,allocations:refill.applied};bunkerTotals[lube.id]+=allocatedQty;if(unalloc>EPS)shortages.push({location:stop.port,stopIndex:index,phase:'bunkering',item:lube.name,shortage:unalloc,message:'Replenishment could not be allocated without exceeding tank capacity'});}else bunkerInfo[lube.id]={quantity:0,allocated:0,unallocated:0,allocations:[]};}
    if(stop.eca?.leaving?.enabled)insideEca=false; // vessel clears the ECA/SECA boundary around departure from this port
    const departure=new Date(arrival.getTime()+(anchorStayDays+portStayDays)*86400000),depFuel=Object.fromEntries(fuels.map(f=>[f.id,groupRob(tanks,f.id)])),depLub=Object.fromEntries(lubes.map(l=>[l.id,groupRob(tanks,l.id)])),fuelStatus={};
    for(const fuel of fuels){const foKey=resolveFoActiveFuel(fuel,stop),doInside=fuel.id==='do'&&doInsideAtStay,ef=effectiveFuelRates(fuel,foKey,doInside);const basisRate=Math.max(0,num(ef.reserveRate))||Math.max(0,num(ef.seaRate)),reserve=Math.max(0,num(ef.reserveDays))*basisRate,unpump=tankUnpumpable(tanks,fuel.id),effective=Math.max(0,depFuel[fuel.id]-unpump),cap=tankCapacity(tanks,fuel.id),seaRate=Math.max(.000001,basisRate);fuelStatus[fuel.id]={rob:depFuel[fuel.id],capacity:cap,utilization:cap>0?depFuel[fuel.id]/cap:0,unpumpable:unpump,reserveQty:reserve,marginDays:Math.max(0,(effective-reserve)/seaRate),belowReserve:effective<reserve-EPS,bunkerRequiredNow:0,foActiveFuel:foKey,doInsideEca:doInside};}
    results.push({index,port:stop.port||`Port ${index+1}`,distanceNm:dist,speedKn:speed,seaDays:sd,anchorStayDays,anchorStayHours:Math.max(0,num(stop.anchorStayHours)),anchorMode:stop.anchorMode||'anchor',portStayDays,portStayHours:Math.max(0,num(stop.portStayHours)),arrivalUtc:arrival.toISOString(),departureUtc:departure.toISOString(),utcOffset:num(stop.utcOffset),seaUsage,anchorUsage,portUsage,bunkerInfo,arrivalFuel,arrivalLube,departureFuel:depFuel,departureLube:depLub,fuelStatus,tankBefore,tankAtArrival,tankAfter:tanks.map(t=>({...t})),activeAtArrival,active:{...active},notes:stop.notes||''});
    prevDeparture=departure;
  });
  const remainingAfter=Object.fromEntries(fuels.map(f=>[f.id,0]));
  for(let i=results.length-1;i>=0;i--){const r=results[i];for(const fuel of fuels){remainingAfter[fuel.id]+=num(r.seaUsage[fuel.id])+num(r.anchorUsage[fuel.id])+num(r.portUsage[fuel.id]);const ef=effectiveFuelRates(fuel,r.fuelStatus[fuel.id]?.foActiveFuel,r.fuelStatus[fuel.id]?.doInsideEca);const basisRate=Math.max(0,num(ef.reserveRate))||Math.max(0,num(ef.seaRate)),reserve=Math.max(0,num(ef.reserveDays))*basisRate,unpump=num(r.fuelStatus[fuel.id]?.unpumpable),current= num(r.departureFuel[fuel.id]),future=results.slice(i+1).reduce((s,x)=>s+num(x.bunkerInfo[fuel.id]?.allocated),0);r.fuelStatus[fuel.id].bunkerRequiredNow=Math.max(0,remainingAfter[fuel.id]+reserve+unpump-current-future);}}
  return{results,totals:{consumption:consumptionTotals,seaConsumption:seaConsumptionTotals,anchorConsumption:anchorConsumptionTotals,portConsumption:portConsumptionTotals,bunker:bunkerTotals,shortages,totalVoyageDays:route.length?(new Date(results[results.length-1].departureUtc)-new Date(startUtc))/86400000:0},finalTanks:tanks};
}
export function projectTankDays(tankRob,dailyRate,reserve=0){const r=clampNonNegative(tankRob),rate=Math.max(0,num(dailyRate));if(rate===0)return Infinity;return Math.max(0,(r-Math.max(0,num(reserve)))/rate);}

/* ---------------------------------------------------------------------------------------------
   FOBAS-style fuel change-over model — a direct port of FOBAS_Changeover_Calculator_with_Formulas.xlsx
   (one calculation per system: Main Engine, Aux. Engine, Boiler).

   The service system is treated as ONE perfectly mixed tank of Q tonnes. New fuel enters at the
   consumption rate r; fuel leaves to the machinery at the current mixed sulphur %.
     Q_eff = MAX(Q, 0.1 t)
     a     = adjusted new-fuel S%  (0.099 if 0.099 < S <= 0.100; 0.499 if 0.499 < S <= 0.500; else S)
     step  : S_in = a*dt*r*10 ; S_out = dt*r*M(n-1)*10 ; M(n) = M(n-1) + (S_in - S_out)/Q_eff/10
     exact : M(t) = a + (S_start - a)*EXP(-r*t/Q_eff)  ->  t = -(Q_eff/r)*LN((S_req - a)/(S_start - a))
   Step-method result = first row with t >= 0.3 h where the limit is met ("> 200 hrs" if never in 2000 steps).
   Exact result is rounded UP to the next 0.1 h (minimum 0.3 h).

   mode 'down' = entering an ECA (sulphur falls to the limit): INVALID if new S% > start S% or > limit.
   mode 'up'   = leaving one (sulphur rises toward the resume fuel): same recursion, target is reached
                 when M >= S_req (no 0.099/0.499 adjustment).
   --------------------------------------------------------------------------------------------- */
const round6=v=>Math.round(v*1e6)/1e6;
export function fobasChangeover({rate,qty,fromS,toS,reqS,mode='down',dt=0.1,maxSteps=2000,curveHours=20}={}){
  const r=num(rate),Q=num(qty),hs=num(fromS),ls=num(toS),req=num(reqS),down=mode!=='up';
  const qeff=Math.max(Q,0.1);
  let a=ls;
  if(down){if(ls>0.099&&ls<=0.1)a=0.099;else if(ls>0.499&&ls<=0.5)a=0.499;}
  const out={valid:false,reason:'',qeff,a,mixFraction:r>0?r*dt/qeff:0,unstable:false,stepTime:null,stepExceeds:false,exactTime:null,exactRounded:null,planning:null,curve:[],exactCurve:[],alreadyOk:false};
  if(!(r>0)||!(Q>0)){out.reason='Enter a consumption rate and a service-system quantity above zero.';return out;}
  if(down){
    if(ls>hs||ls>req){out.reason='Invalid values: the new fuel sulphur must not exceed the current sulphur or the required limit.';return out;}
    if(hs<=req){out.valid=true;out.alreadyOk=true;out.stepTime=0;out.exactTime=0;out.exactRounded=0;out.planning=0;out.reason='Fuel already in the system is within the limit — no changeover time needed.';}
  }else{
    if(!(ls>hs)||!(req>hs)||!(req<ls)){out.reason='Invalid values: the resume fuel sulphur must be above the current sulphur.';return out;}
  }
  out.valid=true;
  out.unstable=out.mixFraction>1; // workbook 'Step stability' check: r*dt/Q_eff must not exceed 1
  const nCurve=Math.round(curveHours/dt);
  let M=hs;out.curve.push([0,hs]);out.exactCurve.push([0,hs]);
  let reached=false;
  for(let n=1;n<=Math.max(maxSteps,nCurve);n++){
    const t=round6(n*dt),sIn=a*dt*r*10,sOut=dt*r*M*10;
    M=M+(sIn-sOut)/qeff/10;
    if(!reached&&n<=maxSteps&&t>=0.3-1e-6&&(down?M<=req:M>=req)){reached=true;out.stepTime=t;}
    if(n<=nCurve){out.curve.push([t,M]);out.exactCurve.push([t,a+(hs-a)*Math.exp(-r*t/qeff)]);}
    if(reached&&n>=nCurve)break;
  }
  if(out.alreadyOk){out.stepTime=0;}
  else if(!reached){out.stepExceeds=true;}
  if(!out.alreadyOk){
    const ok=down?a<req:a>req;
    if(ok){const t=-(qeff/r)*Math.log((req-a)/(hs-a));if(Number.isFinite(t)){out.exactTime=t;out.exactRounded=Math.max(0.3,Math.round(Math.ceil(t*10-1e-9))/10);}}
    const cands=[out.unstable?null:out.stepTime,out.exactRounded].filter(v=>v!==null&&Number.isFinite(v));
    out.planning=cands.length?Math.max(...cands):null;
  }
  return out;
}
