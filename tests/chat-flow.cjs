const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const base = resolve('dist');
const pg = require('pg');
const temp = mkdtempSync(join(tmpdir(), 'hanayorina-chat-'));
process.chdir(temp);
const chats = [], messages = [], requests = [];
class FakePool {
 on() {} async end() {} async connect(){ return { query: this.query.bind(this), release(){} }; }
 async query(sql, args = []) {
  if (['BEGIN','COMMIT','ROLLBACK'].includes(sql) || sql.includes('pg_advisory_xact_lock') || sql.includes('pg_advisory_unlock') || sql.startsWith('UPDATE conversations')) return {rows:[]};
  if (sql.startsWith("UPDATE messages SET status='interrupted'") || sql.startsWith("UPDATE chat_requests SET status='interrupted'")) return {rows:[]};
  if (sql.includes('pg_try_advisory_lock')) return { rows:[{locked:true}] };
  if (sql.startsWith('SELECT conversation_id::text, status FROM chat_requests')) { const rows=requests.filter(x=>x.request_id===args[0]);return {rows,rowCount:rows.length}; }
  if (sql.startsWith('INSERT INTO conversations')) { const row={id:String(chats.length+1),title:args[0]};chats.push(row);return {rows:[row]}; }
  if (sql.startsWith('SELECT id FROM conversations')) { const rows=chats.filter(x=>x.id===args[0]);return {rows,rowCount:rows.length}; }
  if (sql.startsWith('INSERT INTO messages')) { const row={id:String(messages.length+1),conversation_id:args[0],role:args[1],content:args[2],status:args[3]};messages.push(row);return {rows:[row]}; }
  if (sql.startsWith('INSERT INTO memory_jobs')) return {rows:[]};
  if (sql.startsWith('INSERT INTO chat_requests')) { requests.push({request_id:args[0],conversation_id:args[1],assistant_message_id:args[2],status:args[3]});return {rows:[]}; }
  if (sql.startsWith('UPDATE messages SET content=$1, status=$2')) { const m=messages.find(x=>x.id===args[2]);m.content=args[0];m.status=args[1];return {rows:[]}; }
  if (sql.startsWith('UPDATE messages SET content=$1 WHERE')) { const m=messages.find(x=>x.id===args[1]);m.content=args[0];return {rows:[]}; }
  if (sql.startsWith('UPDATE chat_requests SET status=$1')) { requests.find(x=>x.request_id===args[1]).status=args[0];return {rows:[]}; }
  if (sql.startsWith("UPDATE messages SET status=CASE") || sql.startsWith('UPDATE chat_requests SET status=(SELECT')) return {rows:[]};
  if (sql.includes('FROM (SELECT id, role, content FROM messages')) return {rows:messages.filter(x=>x.conversation_id===args[0]&&x.status==='completed').slice(-20)};
  if (sql.startsWith('SELECT id::text, role')) { let rows=messages.filter(x=>x.conversation_id===args[0]&&(!args[1]||BigInt(x.id)<BigInt(args[1])));return {rows:rows.slice().reverse().slice(0,51)}; }
  if (sql.startsWith('SELECT id::text, title')) return {rows:chats};
  throw Error('Unexpected test query: '+sql);
 }
}
pg.Pool = FakePool;
const keys = require(join(base,'settings/keys.js'));
const cloud = require(join(base,'settings/cloud.js'));
const chat = require(join(base,'chat/chat.js'));
test('streamed chat stores statuses, avoids duplicate submissions and preserves partial text', async t => {
 const original = global.fetch; const calls=[]; let mode='fallback';
 global.fetch = async (url, options) => {
  calls.push({url,auth:options.headers.Authorization});
  if(url.endsWith('/models'))return new Response(JSON.stringify({data:[{id:url.includes('cloud.ru')?'deepseek-ai/DeepSeek-V4-Pro':'deepseek-test'}]}));
  if(mode==='partial')return new Response('data: {"choices":[{"delta":{"content":"Часть"}}]}\n\n');
  if(url.includes('example.test')) return new Response('{}',{status:401});
  return new Response('data: {"choices":[{"delta":{"content":"Привет"}}]}\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{global.fetch=original;rmSync(temp,{recursive:true,force:true})});
 keys.configure('https://example.test/v1',true);keys.addKey('main','dummy-primary');await keys.listPrimaryModels();keys.selectPrimaryModel('deepseek-test');
 cloud.configureCloud(true,'dummy-cloud',false);await cloud.listCloudModels();cloud.selectCloudModel('deepseek-ai/DeepSeek-V4-Pro');await chat.initChat();
 const rid='123e4567-e89b-42d3-a456-426614174111';let events=[];
 await chat.send(null,'Как дела?',e=>events.push(e),new AbortController().signal,rid);
 const id=events.find(x=>x.type==='chat').id;assert.equal(events.find(x=>x.type==='provider').provider,'Cloud.ru');assert.equal(events.at(-1).type,'done');
 assert.deepEqual(calls.slice(-2).map(x=>x.auth),['Bearer dummy-primary','Bearer dummy-cloud']);
 assert.deepEqual((await chat.messages(id)).messages.map(x=>x.content),['Как дела?','Привет']);
 events=[];const count=calls.length;await chat.send(id,'Как дела?',e=>events.push(e),new AbortController().signal,rid);assert.equal(events[0].type,'duplicate');assert.equal(calls.length,count);
 mode='partial';events=[];await assert.rejects(chat.send(id,'Продолжай',e=>events.push(e),new AbortController().signal,'123e4567-e89b-42d3-a456-426614174112'),/прервался/);
 const stored=(await chat.messages(id)).messages.at(-1);assert.equal(stored.content,'Часть');assert.equal(stored.status,'interrupted');
});
