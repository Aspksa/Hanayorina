const {test}=require('node:test');const assert=require('node:assert/strict');
const settings=require('../dist/settings/keys.js'),ai=require('../dist/memory/ai.js');
settings.load=()=>({endpoint:'https://example.test/v1',model:'test',keys:[{id:'1',secret:'private'}],activeId:'1'});ai.aiMemorySettings=()=>({enabled:true});
const {analyzeConversation}=require('../dist/history/model-review.js');
test('shares budget and excludes messages with obvious secrets before provider request',async()=>{
 const calls=[];const client={release(){},query:async(sql,args)=>{calls.push({sql,args});if(sql.includes('pg_try_advisory_lock'))return {rows:[{locked:true}]};if(sql.includes('count(*)::int'))return {rows:[{n:0}]};if(sql.includes('FROM conversation_reflections r'))return {rowCount:1,rows:[{conversation_id:'1',last_message_id:'3'}]};if(sql.includes('FROM (\n     SELECT id'))return {rows:[{id:'1',role:'user',content:'Как настроить память PostgreSQL?'},{id:'2',role:'user',content:'пароль: secret'}]};return {rows:[],rowCount:1}}};
 const original=global.fetch;let payload;global.fetch=async(url,options)=>{payload=JSON.parse(options.body);return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({summary:'Вопрос о памяти.',questions:[{messageId:'1',quote:'настроить память PostgreSQL',text:'Как настроить память?'}]})}}]}))};
 try{await analyzeConversation({connect:async()=>client});assert(payload);assert(!JSON.stringify(payload).includes('пароль'));assert(calls.some(c=>c.sql.includes('INSERT INTO memory_ai_calls')));assert(calls.some(c=>c.sql.includes("status='done'")))}finally{global.fetch=original}
});
