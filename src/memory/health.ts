import { Pool } from 'pg';
import { topics } from './extract';

type Item={id:string;content:string;kind:string;status:string;updated_at:Date|string};
type Finding={type:'similar'|'correction'|'stale';ids:string[];description:string;contents:string[]};
export function analyzeMemory(items: Item[],now=Date.now()): Finding[] {
 const out:Finding[]=[];
 const visible=items.filter(x=>['reported','confirmed','needs_review'].includes(x.status)).slice(0,200);
 for(let i=0;i<visible.length;i++){
  const a=visible[i];const date=new Date(a.updated_at).getTime();
  if(Number.isFinite(date)&&now-date>180*86400000&&out.filter(x=>x.type==='stale').length<10)
   out.push({type:'stale',ids:[a.id],description:'Давно не обновлялось: проверьте, актуально ли это.',contents:[a.content]});
  const aw=new Set(topics(a.content));if(aw.size<2)continue;
  for(let j=i+1;j<visible.length;j++){
   const b=visible[j],bw=new Set(topics(b.content));if(bw.size<2)continue;
   const shared=[...aw].filter(w=>bw.has(w)).length,union=new Set([...aw,...bw]).size;
   if(shared<2||shared/union<0.65)continue;
   const type=a.kind==='correction'&&b.kind==='correction'?'correction':'similar';
   if(out.filter(x=>x.type===type).length>=10)continue;
   out.push({type,ids:[a.id,b.id],description:type==='correction'?'Похожие поправки: возможно, повторяется одна тема.':'Похожие записи: проверьте, не дублируют ли они друг друга.',contents:[a.content,b.content]});
  }
 }
 return out;
}
let cached:{updatedAt:string|null;findings:Finding[];scanned:number}={updatedAt:null,findings:[],scanned:0};
let last=0,running=false;
export function memoryHealth(){return cached;}
/** Read-only, bounded local scan; no conclusions are applied automatically. */
export async function updateMemoryHealth(pool:Pool):Promise<void>{
 if(running||Date.now()-last<300000)return;running=true;
 try{const r=await pool.query(`SELECT m.id::text,left(m.content,500) AS content,t.kind,t.status,m.updated_at
  FROM memories m JOIN memory_metadata t ON t.memory_id=m.id
  WHERE t.status IN ('reported','confirmed','needs_review') ORDER BY m.updated_at DESC,m.id DESC LIMIT 200`);
  cached={updatedAt:new Date().toISOString(),findings:analyzeMemory(r.rows),scanned:r.rows.length};last=Date.now();
 } finally {running=false;}
}
