const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join, resolve } = require('node:path');
const base = resolve('dist');
const pg = require('pg');
const temp = mkdtempSync(join(tmpdir(), 'hanayorina-chat-'));
process.chdir(temp);
const chats = [], messages = [];
class FakePool {
 async connect(){ return { query: this.query.bind(this), release(){} }; }
 async query(sql, args = []) {
  if (sql.includes('pg_try_advisory_lock')) return { rows:[{locked:true}] };
  if (sql.includes('pg_advisory_unlock') || sql.startsWith('UPDATE conversations')) return { rows:[] };
  if (sql.startsWith('INSERT INTO conversations')) { const row={id:String(chats.length+1),title:args[0]};chats.push(row);return {rows:[row]}; }
  if (sql.startsWith('SELECT id FROM conversations')) { const rows=chats.filter(x=>x.id===args[0]);return {rows,rowCount:rows.length}; }
  if (sql.startsWith('INSERT INTO messages')) { messages.push({id:String(messages.length+1),conversation_id:args[0],role:args[1],content:args[2]});return {rows:[]}; }
  if (sql.includes('FROM (SELECT id, role, content FROM messages')) return {rows:messages.filter(x=>x.conversation_id===args[0]).slice(-20)};
  if (sql.startsWith('SELECT id::text, role')) return {rows:messages.filter(x=>x.conversation_id===args[0])};
  if (sql.startsWith('SELECT id::text, title')) return {rows:chats};
  throw Error('Unexpected test query: '+sql);
 }
}
pg.Pool = FakePool;
const keys = require(join(base,'settings/keys.js'));
const cloud = require(join(base,'settings/cloud.js'));
const chat = require(join(base,'chat/chat.js'));
test('streaming chat switches providers only before a response and preserves history', async t => {
 const original = global.fetch; const calls=[]; let mode='fallback';
 global.fetch = async (url, options) => {
  calls.push({url,auth:options.headers.Authorization});
  if(url.endsWith('/models'))return new Response(JSON.stringify({data:[{id:url.includes('cloud.ru')?'deepseek-ai/DeepSeek-V4-Pro':'deepseek-test'}]}));
  if(mode==='network')throw Error('network');
  if(mode==='partial')return new Response('data: {"choices":[{"delta":{"content":"Часть"}}]}\n\n');
  if(url.includes('example.test')) return new Response('{}',{status:401});
  return new Response('data: {"choices":[{"delta":{"content":"Привет"}}]}\n\ndata: [DONE]\n\n');
 };
 t.after(()=>{global.fetch=original;rmSync(temp,{recursive:true,force:true})});
 keys.configure('https://example.test/v1',true);keys.addKey('main','dummy-primary');await keys.listPrimaryModels();keys.selectPrimaryModel('deepseek-test');
 cloud.configureCloud(true,'dummy-cloud',false);await cloud.listCloudModels();cloud.selectCloudModel('deepseek-ai/DeepSeek-V4-Pro');chat.initChat();
 let events=[];await chat.send(null,'Как дела?',e=>events.push(e),new AbortController().signal);
 const id=events.find(x=>x.type==='chat').id;
 assert.equal(events.find(x=>x.type==='provider').provider,'Cloud.ru');
 assert.equal(events.find(x=>x.type==='delta').text,'Привет');assert.equal(events.at(-1).type,'done');
 assert.deepEqual(calls.slice(-2).map(x=>x.auth),['Bearer dummy-primary','Bearer dummy-cloud']);
 assert.deepEqual((await chat.messages(id)).map(x=>x.content),['Как дела?','Привет']);
 mode='partial';events=[];const before=calls.length;
 await assert.rejects(chat.send(id,'Продолжай',e=>events.push(e),new AbortController().signal),/прервался/);
 assert.equal(calls.length,before+1);assert.match((await chat.messages(id)).at(-1).content,/Ответ прерван/);
  mode='network';const last=calls.length;
  await assert.rejects(chat.send(id,'Новый запрос',()=>{},new AbortController().signal),/Повтор автоматически не отправлен/);
  assert.equal(calls.length,last+1);
});
