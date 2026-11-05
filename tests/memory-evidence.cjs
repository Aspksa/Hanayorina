const {test}=require('node:test');const assert=require('node:assert/strict');const {inspectEvidence}=require('../dist/memory/evidence.js');
test('evidence is bounded, secret-containing messages are hidden and conflicts remain visible',async()=>{
 let calls=[];const rows=[[{id:'1',status:'needs_review',kind:'correction'}],[{conversation_id:'2',message_id:'3',content:'пароль: secret'}],[{id:'4',content:'Другая версия',status:'confirmed'}]];
 const pool={query:async(sql,args)=>{calls.push({sql,args});const r=rows.shift();return {rowCount:r.length,rows:r}}};
 const result=await inspectEvidence(pool,'1');assert.match(result.sources[0].content,/скрыто/);assert.equal(result.conflicts[0].id,'4');assert.match(calls[1].sql,/LIMIT 20/);assert.match(calls[2].sql,/LIMIT 10/);await assert.rejects(inspectEvidence(pool,'../1'));
});
