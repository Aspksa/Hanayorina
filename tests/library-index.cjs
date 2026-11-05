const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const lib=require('../dist/library/index.js');
test('indexes only selected safe text files and filters stale results',async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hana-index-')),out=fs.mkdtempSync(path.join(os.tmpdir(),'hana-out-'));
 const oldRoot=process.env.HANAYORINA_WORKSPACE_ROOT,oldEnabled=process.env.HANAYORINA_LIBRARY_INDEX;
 process.env.HANAYORINA_WORKSPACE_ROOT=root;process.env.HANAYORINA_LIBRARY_INDEX='1';
 const items=new Map();let reads=0;
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT size_bytes')){const x=items.get(args[1]);return {rowCount:x?1:0,rows:x?[x]:[]}}
  if(sql.includes('INSERT INTO library_index')){reads++;items.set(args[1],{path:args[1],size_bytes:args[2],mtime_ms:args[3],content:args[4]});return {rowCount:1,rows:[]}}
  if(sql.startsWith('DELETE FROM library_index')){items.delete(args[1]);return {rowCount:1,rows:[]}}
  if(sql.includes('SELECT path,size_bytes'))return {rows:[...items.values()].filter(x=>x.content.includes(args[1])||x.path.includes(args[1]))};
  throw Error('Unexpected query '+sql);
 }};
 try{fs.writeFileSync(path.join(root,'заметки.md'),'Память PostgreSQL');fs.writeFileSync(path.join(root,'credentials.md'),'Память секрет');fs.writeFileSync(path.join(root,'private.md'),'пароль: secret');fs.writeFileSync(path.join(out,'outside.md'),'Память снаружи');if(process.platform!=='win32')fs.symlinkSync(out,path.join(root,'link'));
  await lib.indexLibraryStep(pool);assert.equal(reads,1);assert.deepEqual([...items.keys()],['заметки.md']);assert.equal((await lib.searchLibrary(pool,'Память')).matches.length,1);
  fs.writeFileSync(path.join(root,'заметки.md'),'Память обновлена совсем иначе');assert.equal((await lib.searchLibrary(pool,'Память')).matches.length,0);
 }finally{if(oldRoot===undefined)delete process.env.HANAYORINA_WORKSPACE_ROOT;else process.env.HANAYORINA_WORKSPACE_ROOT=oldRoot;if(oldEnabled===undefined)delete process.env.HANAYORINA_LIBRARY_INDEX;else process.env.HANAYORINA_LIBRARY_INDEX=oldEnabled;fs.rmSync(root,{recursive:true,force:true});fs.rmSync(out,{recursive:true,force:true})}
});
