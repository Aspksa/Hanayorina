const {test}=require('node:test');const assert=require('node:assert/strict');
const {personalHistory}=require('../dist/history/history.js');
test('personal history is bounded and does not include rejected entries',async()=>{
 let query='';const pool={query:async(sql)=>{query=sql;return {rows:Array.from({length:51},(_,i)=>({id:String(i+1)}))}}};
 const history=await personalHistory(pool);assert.equal(history.entries.length,50);assert.equal(history.truncated,true);assert.match(query,/needs_review/);assert.doesNotMatch(query,/'rejected'/);
});
