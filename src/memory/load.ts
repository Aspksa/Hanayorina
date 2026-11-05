import { cpus } from 'node:os';
type Sample={idle:number;total:number};
export function cpuSample():Sample {
 let idle=0,total=0;for(const cpu of cpus()){idle+=cpu.times.idle;total+=Object.values(cpu.times).reduce((a,b)=>a+b,0);}return {idle,total};
}
export function isSystemBusy(before:Sample,after:Sample,threshold=0.75):boolean {
 const total=after.total-before.total,idle=after.idle-before.idle;
 return total>0&&idle>=0&&(1-idle/total)>threshold;
}
let previous:Sample|undefined;
/** Pauses background work under sustained system CPU use; no input monitoring. */
export function backgroundAllowed():boolean {
 const current=cpuSample(),prior=previous;previous=current;
 return !prior||!isSystemBusy(prior,current);
}
