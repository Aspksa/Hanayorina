import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, realpathSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, sep } from 'node:path';
import { Pool } from 'pg';
import { rootPath, readSafe, target } from '../tools/workspace';
import { containsSensitive, topics } from '../memory/extract';

const extensions=new Set(['.txt','.md','.csv','.json','.ts','.tsx','.js','.py','.html','.css','.yaml','.yml']);
const ignored=new Set(['node_modules','dist','build','vendor','__pycache__','data','.runtime']);
const secretName=/(?:^|[-_.])(secrets?|passwords?|credentials?|tokens?|keys?)(?:[-_.]|$)/i;
type Entry={name:string;depth:number};
let root='',pending:Entry[]=[],nextCycle=0,active=false;
function hashRoot(r:string):string{return createHash('sha256').update(r).digest('hex')}
function safeDirectory(base:string,name:string):string { let at=base; for(const part of name.split(/[\\/]/).filter(Boolean)){at=join(at,part);if(lstatSync(at).isSymbolicLink())throw new Error('Символические ссылки запрещены.');}const actual=realpathSync(at),rel=relative(base,actual);if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel))throw new Error('Путь за пределами рабочей папки.');return actual;}
function validEntry(name:string):boolean{return !name.startsWith('.')&&!ignored.has(name.toLowerCase())&&!secretName.test(name)}
/** Bounded local scan: no network calls, no traversal through symlinks. */
export async function indexLibraryStep(pool:Pool):Promise<void>{
 if(active)return;active=true;
 try{
  const current=rootPath();if(current!==root){root=current;pending=[{name:'',depth:0}];nextCycle=0;}
  if(!pending.length){if(Date.now()<nextCycle)return;pending=[{name:'',depth:0}];}
  const rootHash=hashRoot(root);let processed=0,visited=0;
  while(pending.length&&processed<10&&visited<100){
   const item=pending.shift()!;visited++;
   try{
    const path=item.name?join(root,item.name):root;const st=lstatSync(path);if(st.isSymbolicLink())continue;
    if(st.isDirectory()){
     if(item.depth>=6)continue;
     const directory=safeDirectory(root,item.name);
     for(const entry of readdirSync(directory,{withFileTypes:true}).slice(0,1000)){
      if(!validEntry(entry.name)||entry.isSymbolicLink())continue;
      if(entry.isDirectory()||entry.isFile()&&extensions.has(extname(entry.name).toLowerCase())){
       if(pending.length<5000)pending.push({name:relative(root,join(path,entry.name)),depth:item.depth+1});
      }
     }continue;
    }
    if(!st.isFile()||!extensions.has(extname(item.name).toLowerCase()))continue;
    processed++;target(root,item.name,false);
    if(st.size>200000){await pool.query('DELETE FROM library_index WHERE root_hash=$1 AND path=$2',[rootHash,item.name]);continue;}
    const previous=await pool.query('SELECT size_bytes,mtime_ms FROM library_index WHERE root_hash=$1 AND path=$2',[rootHash,item.name]);
    if(previous.rowCount&&Number(previous.rows[0].size_bytes)===st.size&&Number(previous.rows[0].mtime_ms)===st.mtimeMs)continue;
    const content=readSafe(root,item.name);const after=lstatSync(path);
    if(after.size!==st.size||after.mtimeMs!==st.mtimeMs)continue;
    if(containsSensitive(content)){await pool.query('DELETE FROM library_index WHERE root_hash=$1 AND path=$2',[rootHash,item.name]);continue;}
    await pool.query(`INSERT INTO library_index(root_hash,path,size_bytes,mtime_ms,content) VALUES($1,$2,$3,$4,$5)
      ON CONFLICT(root_hash,path) DO UPDATE SET size_bytes=EXCLUDED.size_bytes,mtime_ms=EXCLUDED.mtime_ms,content=EXCLUDED.content,indexed_at=now()`,[rootHash,item.name,st.size,st.mtimeMs,content]);
   }catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT'||(error as NodeJS.ErrnoException).code==='EACCES')continue;throw error;}
  }
  if(!pending.length)nextCycle=Date.now()+300000;
 }finally{active=false;}
}
/** Local excerpts and topic hints are derived from text; they are not model-generated summaries. */
export function describeDocument(content:string,query:string){
 const lines=content.split(/\r?\n/);const needle=query.toLocaleLowerCase('ru');
 const index=lines.findIndex(line=>line.toLocaleLowerCase('ru').includes(needle));
 const line=index>=0?lines[index].trim().slice(0,300):'';
 return {line:index>=0?index+1:null,excerpt:line,topics:topics(content).slice(0,5)};
}
export async function searchLibrary(pool:Pool,input:unknown){
 if(typeof input!=='string'||input.trim().length<3||input.length>120)throw new Error('Введите от 3 до 120 символов.');
 const current=rootPath(),phrase=input.trim(),hash=hashRoot(current);
 const results=await pool.query(`SELECT path,size_bytes,mtime_ms,content FROM library_index WHERE root_hash=$1
 AND (strpos(lower(path),lower($2))>0 OR strpos(lower(content),lower($2))>0) ORDER BY indexed_at DESC LIMIT 100`,[hash,phrase]);
 const matches=[];
 for(const row of results.rows){try{const path=target(current,row.path,false),st=lstatSync(path);if(st.isFile()&&st.size===Number(row.size_bytes)&&st.mtimeMs===Number(row.mtime_ms)){matches.push({path:row.path,title:basename(row.path),...describeDocument(row.content,phrase)});if(matches.length===30)break}}catch{}}
 return {matches,limit:30};
}
