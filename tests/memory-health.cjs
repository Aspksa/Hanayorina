const {test}=require('node:test');const assert=require('node:assert/strict');
const {analyzeMemory}=require('../dist/memory/health.js');
test('flags only similar active records and old records without changing them',()=>{
 const old='2024-01-01T00:00:00Z', fresh='2026-11-01T00:00:00Z';
 const rows=[{id:'1',content:'Настроить PostgreSQL хранение памяти',kind:'fact',status:'confirmed',updated_at:old},{id:'2',content:'Настроить PostgreSQL хранение памяти снова',kind:'fact',status:'reported',updated_at:fresh},{id:'3',content:'Настроить PostgreSQL хранение памяти',kind:'fact',status:'rejected',updated_at:old}];
 const before=JSON.stringify(rows),findings=analyzeMemory(rows,Date.parse('2026-11-06T00:00:00Z'));
 assert(findings.some(x=>x.type==='similar'&&x.ids.includes('1')&&x.ids.includes('2')));assert(findings.some(x=>x.type==='stale'&&x.ids[0]==='1'));assert(!findings.some(x=>x.ids.includes('3')));assert.equal(JSON.stringify(rows),before);
});
