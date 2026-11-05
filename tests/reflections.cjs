const {test}=require('node:test');const assert=require('node:assert/strict');
const {reflectOneConversation,recentReflections}=require('../dist/history/reflections.js');
const {evaluateMemory}=require('../dist/history/evaluate.js');
test('local review waits for inactivity and skips in-progress responses',async()=>{
 const calls=[];const client={query:async sql=>{calls.push(sql);if(sql.includes('pg_try_advisory'))return {rows:[{locked:true}]};return {rows:[]}},release(){}};
 await reflectOneConversation({connect:async()=>client});
 const query=calls.find(sql=>sql.includes('INSERT INTO conversation_reflections'));assert.match(query,/10 minutes/);assert.match(query,/status='streaming'/);assert.equal(calls.at(-1),'COMMIT');
});
test('reflections show bounded records and filter obvious secrets from questions',async()=>{
 let i=0;const responses=[{rows:[{id:'3',title:'Разговор'}]},{rows:[{conversation_id:'3',content:'Факт',status:'confirmed'}]},{rows:[{conversation_id:'3',id:'4',content:'Как дела?'},{conversation_id:'3',id:'5',content:'Какой пароль: secret?'}]}];
 const result=await recentReflections({query:async()=>responses[i++]});assert.equal(result.sessions[0].memories.length,1);assert.equal(result.sessions[0].questions.length,1);assert.equal(result.sessions[0].questions[0].id,'4');
});
test('local evaluation runs representative checks without network',()=>{const result=evaluateMemory();assert.equal(result.total,5);assert.equal(result.passed,5)});
