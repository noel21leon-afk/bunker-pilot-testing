import assert from 'node:assert/strict';
import { calculateVoyage, consumeTankGroup, allocateBunkerByCapacity, seaDays, fobasChangeover } from './core.js';
assert.equal(seaDays(625,10.2),625/10.2/24);
const sw=consumeTankGroup([{id:'A',name:'A',rob:20},{id:'B',name:'B',rob:30}],0,25);
assert.equal(sw.tanks[0].rob,0); assert.equal(sw.tanks[1].rob,25); assert.equal(sw.shortage,0); assert.equal(sw.activeIndex,1);
const al=allocateBunkerByCapacity([{id:'A',capacity:30,rob:20},{id:'B',capacity:50,rob:50}],25);
assert.deepEqual(al.allocations,[{tankId:'A',quantity:10}]); assert.equal(al.unallocated,15);

// no-mixing (VLSFO): only truly empty tanks are eligible
const alNoMix=allocateBunkerByCapacity([{id:'A',capacity:30,rob:20},{id:'B',capacity:50,rob:0}],25,true);
assert.deepEqual(alNoMix.allocations,[{tankId:'B',quantity:25}]); assert.equal(alNoMix.unallocated,0);
const alNoMixShort=allocateBunkerByCapacity([{id:'A',capacity:30,rob:20},{id:'B',capacity:50,rob:10}],25,true);
assert.deepEqual(alNoMixShort.allocations,[]); assert.equal(alNoMixShort.unallocated,25);
const demo={
 meta:{startUtc:'2026-01-01T00:00'},
 fuels:[{id:'fo',name:'FO',seaRate:10,portRate:1,unit:'MT',reserveDays:2,reserveRate:10}],
 lubes:[{id:'cyl',name:'CYL',seaRate:20,portRate:0,unit:'L',reserveDays:1,reserveRate:20}],
 tanks:[
  {id:'a',group:'fo',name:'A',capacity:100,rob:30,unpumpable:1,consumable:true,category:'storage'},
  {id:'b',group:'fo',name:'B',capacity:100,rob:50,unpumpable:0,consumable:true,category:'storage'},
  {id:'c',group:'cyl',name:'CYL TK',capacity:1000,rob:100,unpumpable:0,consumable:true,category:'storage'}
 ], active:{fo:0}, route:[
  {port:'START',distanceNm:0,speedKn:10,portStayDays:1,utcOffset:0,bunkers:{}},
  {port:'NEXT',distanceNm:240,speedKn:10,portStayDays:0,utcOffset:0,bunkers:{fo:{quantity:50,autoAllocate:true,allocations:[]}}}
 ]
};
const c=calculateVoyage(demo);
assert.equal(c.results.length,2);
assert.equal(c.results[1].seaDays,1);
assert.equal(c.results[1].arrivalUtc,'2026-01-03T00:00:00.000Z');
assert.ok(c.results[1].departureFuel.fo>=0);
assert.ok(c.results[1].tankAfter.some(t=>t.id==='a'));

// first-port custom ETA override
const demoEta=JSON.parse(JSON.stringify(demo));
demoEta.route[0].eta='2026-01-01T06:30';
const cEta=calculateVoyage(demoEta);
assert.equal(cEta.results[0].arrivalUtc,new Date('2026-01-01T06:30').toISOString());
assert.equal(cEta.results[1].arrivalUtc,new Date(new Date('2026-01-01T06:30').getTime()+cEta.results[0].portStayDays*86400000+cEta.results[1].seaDays*86400000).toISOString());

// VLSFO no-mixing end-to-end: bunker should skip the partially-full tank
const demoVlsfo=JSON.parse(JSON.stringify(demo));
demoVlsfo.fuels[0].fuelType='VLSFO';
demoVlsfo.tanks=[
  {id:'a',group:'fo',name:'A',capacity:100,rob:30,unpumpable:0,consumable:true,category:'storage',sequence:1},
  {id:'b',group:'fo',name:'B',capacity:100,rob:0,unpumpable:0,consumable:true,category:'storage',sequence:2}
];
demoVlsfo.active={fo:0};
demoVlsfo.route=[
  {port:'START',distanceNm:0,speedKn:10,portStayDays:0,utcOffset:0,bunkers:{fo:{quantity:40,autoAllocate:true,allocations:[]}}}
];
const cVlsfo=calculateVoyage(demoVlsfo);
const tankA=cVlsfo.results[0].tankAfter.find(t=>t.id==='a'),tankB=cVlsfo.results[0].tankAfter.find(t=>t.id==='b');
assert.equal(tankA.rob,30); // untouched — mixing not allowed into a tank with existing ROB
assert.equal(tankB.rob,40); // all bunker went into the empty tank

// anchorage/drifting stay: adds time and consumption using the per-fuel anchor rate
const demoAnchor=JSON.parse(JSON.stringify(demo));
demoAnchor.fuels[0].anchorRate=2; // 2 MT/day at anchor
demoAnchor.route[1].anchorStayDays=1;
demoAnchor.route[1].anchorStayHours=12;
const cAnchor=calculateVoyage(demoAnchor);
assert.equal(cAnchor.results[1].anchorStayDays,1.5);
assert.equal(cAnchor.results[1].anchorUsage.fo,3); // 1.5 days * 2 MT/day
// departure = arrival + anchor stay + port stay
const arr1=new Date(cAnchor.results[1].arrivalUtc).getTime();
const dep1=new Date(cAnchor.results[1].departureUtc).getTime();
assert.equal((dep1-arr1)/86400000,1.5+cAnchor.results[1].portStayDays);

// VLSFO/HFO tracked separately ("both" mode): each leg picks which one is actually burned
const demoBoth=JSON.parse(JSON.stringify(demo));
demoBoth.fuels[0].foMode='both';
demoBoth.fuels[0].seaRate=10; // VLSFO sea rate (top-level fields = VLSFO)
demoBoth.fuels[0].hfo={seaRate:20,portRate:0,anchorRate:0,reserveDays:3,reserveRate:0}; // HFO sea rate
demoBoth.route[0].foActiveFuel='vlsfo';
demoBoth.route[1].foActiveFuel='hfo';
const cBoth=calculateVoyage(demoBoth);
assert.equal(cBoth.results[0].fuelStatus.fo.foActiveFuel,'vlsfo');
assert.equal(cBoth.results[1].fuelStatus.fo.foActiveFuel,'hfo');
assert.equal(cBoth.results[1].seaUsage.fo,cBoth.results[1].seaDays*20); // used the HFO rate, not the VLSFO one

// lube oil replenishment (bunkering) at a port must top up the lube tank
const demoLube=JSON.parse(JSON.stringify(demo));
demoLube.route[1].bunkers={cyl:{quantity:300,autoAllocate:true,allocations:[]}};
const cLube=calculateVoyage(demoLube);
assert.equal(cLube.results[1].bunkerInfo.cyl.allocated,300);
assert.ok(cLube.results[1].departureLube.cyl>cLube.results[1].arrivalLube.cyl);
assert.equal(cLube.totals.bunker.cyl,300);

// 85% max-load cap: auto-allocation should stop at 85% of capacity when there's room elsewhere
import { allocateBunkerByCapacity as allocCap, MAX_LOAD_FRAC, fuelTypeNoMixing, defaultFuelType, vcf54B, wcf56, robFromVolume } from './core.js';
const cap85=allocCap([{id:'A',capacity:100,rob:0},{id:'B',capacity:100,rob:0}],90,false,{maxFillFrac:MAX_LOAD_FRAC});
assert.equal(cap85.allocations.find(a=>a.tankId==='A').quantity,85); // A filled to the recommended 85% first
assert.equal(cap85.allocations.find(a=>a.tankId==='B').quantity,5); // remainder tops up B rather than pushing A over 85%
assert.equal(cap85.unallocated,0);
const cap85Spill=allocCap([{id:'A',capacity:100,rob:0}],95,false,{maxFillFrac:MAX_LOAD_FRAC});
assert.equal(cap85Spill.allocations.reduce((s,a)=>s+a.quantity,0),95); // only tank available — spills past 85% rather than losing the bunker
assert.equal(cap85Spill.unallocated,0);
assert.equal(fuelTypeNoMixing('hfo'),false);
assert.equal(fuelTypeNoMixing('vlsfo'),true);
assert.equal(fuelTypeNoMixing('lsmgo'),false);
assert.equal(fuelTypeNoMixing('biodiesel'),false);
assert.equal(fuelTypeNoMixing('Custom VLSFO 0.5%'),true);
assert.equal(fuelTypeNoMixing('DMA'),false);
assert.equal(defaultFuelType('fo'),'vlsfo');
assert.equal(defaultFuelType('do'),'lsmgo');

// per-tank fuel-type bunkering: VLSFO bunker only fills tanks tagged vlsfo, and only if empty
const demoFuelType=JSON.parse(JSON.stringify(demo));
demoFuelType.tanks=[
  {id:'a',group:'fo',name:'A (VLSFO, has ROB)',capacity:100,rob:20,unpumpable:0,consumable:true,category:'storage',sequence:1,fuelType:'vlsfo'},
  {id:'b',group:'fo',name:'B (HFO, has ROB)',capacity:100,rob:20,unpumpable:0,consumable:true,category:'storage',sequence:2,fuelType:'hfo'},
  {id:'c',group:'fo',name:'C (VLSFO, empty)',capacity:100,rob:0,unpumpable:0,consumable:true,category:'storage',sequence:3,fuelType:'vlsfo'}
];
demoFuelType.route=[{port:'START',distanceNm:0,speedKn:10,portStayDays:0,utcOffset:0,bunkers:{fo:{quantity:30,autoAllocate:true,allocations:[],fuelType:'vlsfo'}}}];
const cFuelType=calculateVoyage(demoFuelType);
const bi=cFuelType.results[0].bunkerInfo.fo;
assert.equal(bi.allocated,30); // all 30 went into tank C, the empty VLSFO tank
const tC=cFuelType.results[0].tankAfter.find(t=>t.id==='c');
assert.equal(tC.rob,30);
const tA=cFuelType.results[0].tankAfter.find(t=>t.id==='a');
assert.equal(tA.rob,20); // untouched — VLSFO with existing ROB is not eligible

// HFO bunker into a tagged HFO tank that already has ROB should be allowed (mixing permitted)
const demoHfoMix=JSON.parse(JSON.stringify(demoFuelType));
demoHfoMix.route[0].bunkers.fo={quantity:30,autoAllocate:true,allocations:[],fuelType:'hfo'};
const cHfoMix=calculateVoyage(demoHfoMix);
const tB=cHfoMix.results[0].tankAfter.find(t=>t.id==='b');
assert.equal(tB.rob,50); // 20 existing + 30 bunkered, mixing allowed into the same HFO tank

console.log('core tests passed');

import { maxFillFrac } from './core.js';
assert.equal(maxFillFrac({maxFillPct:90}),0.9);
assert.equal(maxFillFrac({}),MAX_LOAD_FRAC);
assert.equal(maxFillFrac({maxFillPct:20}),MAX_LOAD_FRAC);
console.log('max fill tests passed');

// FOBAS change-over workbook: results must match the cached values in FOBAS_Changeover_Calculator_with_Formulas.xlsx
const near=(a,b,eps=1e-6)=>assert.ok(Math.abs(a-b)<eps,`expected ${b}, got ${a}`);
const fMe=fobasChangeover({rate:1,qty:1,fromS:3.5,toS:0.1,reqS:0.1});
assert.equal(fMe.valid,true); near(fMe.a,0.099); near(fMe.stepTime,7.8); near(fMe.exactTime,8.1318247850072); near(fMe.exactRounded,8.2); near(fMe.planning,8.2);
const fBo=fobasChangeover({rate:1.3,qty:5,fromS:3.5,toS:0.1,reqS:0.5});
near(fBo.stepTime,8.2); near(fBo.exactTime,8.22255137577164); near(fBo.exactRounded,8.3);
const fAe=fobasChangeover({rate:1.3,qty:1,fromS:3.5,toS:0.09,reqS:0.1});
near(fAe.a,0.09); near(fAe.stepTime,4.2); near(fAe.exactTime,4.48606344406424); near(fAe.exactRounded,4.5);
near(fMe.curve[1][1],3.1599); near(fMe.curve[3][1],2.578329); near(fMe.exactCurve[1][1],3.1763520587403);
assert.equal(fMe.curve.length,201); assert.equal(fMe.curve[200][0],20); // 20 h chart range at dt 0.1
// validity rules and edge cases
assert.equal(fobasChangeover({rate:1,qty:1,fromS:0.5,toS:0.6,reqS:0.1}).valid,false); // LSFO above HSFO
assert.equal(fobasChangeover({rate:1,qty:1,fromS:3.5,toS:0.3,reqS:0.1}).valid,false); // LSFO above the limit
assert.equal(fobasChangeover({rate:0,qty:1,fromS:3.5,toS:0.1,reqS:0.1}).valid,false); // no rate
near(fobasChangeover({rate:1,qty:0.02,fromS:3.5,toS:0.1,reqS:0.1}).qeff,0.1); // Q_eff floor of 0.1 t
assert.equal(fobasChangeover({rate:1,qty:1,fromS:0.08,toS:0.05,reqS:0.1}).planning,0); // already compliant
assert.equal(fobasChangeover({rate:0.01,qty:100,fromS:3.5,toS:0.1,reqS:0.1}).stepExceeds,true); // > 200 h
const fUn=fobasChangeover({rate:5,qty:0.05,fromS:3.5,toS:0.1,reqS:0.1});
assert.equal(fUn.unstable,true); assert.equal(fUn.planning,fUn.exactRounded); // unstable step method is ignored, exact time used
// leaving an ECA: sulphur rises toward the resume fuel, target = 95% of the way
const fUp=fobasChangeover({rate:1,qty:1,fromS:0.1,toS:0.5,reqS:0.1+0.95*(0.5-0.1),mode:'up'});
assert.equal(fUp.valid,true); near(fUp.exactTime,-Math.log(0.05),1e-9); assert.ok(fUp.stepTime>0&&fUp.stepTime<5);
console.log('fobas changeover tests passed');

// ASTM Table 54B (VCF) against the published worked examples
const nearT=(a,b,eps=2e-5)=>assert.ok(Math.abs(a-b)<eps,`expected ~${b}, got ${a}`);
nearT(vcf54B(839,32.5),0.98515);
nearT(vcf54B(889,115.55),0.91966);
nearT(vcf54B(903.5,30.50),0.988067);
nearT(vcf54B(819,26.75),0.989552);
nearT(vcf54B(777.5,9),1.006412,5e-5); // narrow transition zone, slightly looser tolerance
nearT(vcf54B(749,32),0.979423);
assert.equal(vcf54B(900,15),1); // no correction at exactly 15C
assert.equal(vcf54B(0,20),1);   // no density -> no-op, never divide by zero
// Table 56 (WCF): density at 15C in vacuum minus 1.1 kg/m3
assert.equal(wcf56(985),983.9);
assert.equal(wcf56(0.5),0); // clamped, never negative
// robFromVolume: GOV x VCF(54B) x WCF(56)/1000, density given in t/m3 as entered in the Tanks tab
const mt=robFromVolume(100,32.5,0.839); // 100 m3 at 32.5C, density 0.839 t/m3 (839 kg/m3)
nearT(mt,100*0.98515*837.9/1000,1e-3);
assert.equal(robFromVolume(0,20,0.95),0);
assert.equal(robFromVolume(100,20,0),0); // no density entered -> 0, not a division error
console.log('ASTM 54B/56 tests passed');

// Diesel Oil inside/outside ECA rate split
import { calculateVoyage as calcEca2, effectiveFuelRates as efr } from './core.js';
{
  const doFuel={id:'do',name:'DO',seaRate:5,portRate:2,anchorRate:1,unit:'MT',doEcaSplit:true,insideEca:{seaRate:9,portRate:4,anchorRate:2}};
  assert.equal(efr(doFuel,null,false).seaRate,5); // outside ECA: own rates
  assert.equal(efr(doFuel,null,true).seaRate,9);  // inside ECA: insideEca override
  const notSplit={...doFuel,doEcaSplit:false};
  assert.equal(efr(notSplit,null,true).seaRate,5); // split not enabled: no override even if inside
  // Full voyage: port 0 enters an ECA on arrival, port 1 leaves it on departure.
  const voyage={startUtc:'2026-01-01T00:00',fuels:[doFuel],lubes:[],
    tanks:[{id:'t1',group:'do',name:'DO Tank',capacity:1000,rob:1000,order:1,sequence:1,category:'storage'}],
    route:[
      {port:'A',distanceNm:240,speedKn:10,utcOffset:0,eca:{entering:{enabled:true},leaving:{enabled:false}}},
      {port:'B',distanceNm:240,speedKn:10,utcOffset:0,eca:{entering:{enabled:false},leaving:{enabled:true}}},
      {port:'C',distanceNm:240,speedKn:10,utcOffset:0}
    ]};
  const r=calcEca2(voyage).results;
  assert.equal(r[0].seaUsage.do,0); // first port: no sailing leg
  assert.equal(r[1].seaUsage.do,9*(240/10/24)); // leg A->B: inside (entered at A, on arrival) -> rate 9
  assert.equal(r[2].seaUsage.do,5*(240/10/24)); // leg B->C: outside again (left at B, on departure) -> rate 5
  assert.equal(r[0].portUsage.do,2*0); // port A stay: portStayDays defaults to 0 in this test, so 0 regardless
  assert.equal(r[0].fuelStatus.do.doInsideEca,true); // port A's own stay/reserve basis is inside
}
console.log('DO inside/outside ECA tests passed');
