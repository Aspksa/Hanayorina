const { test } = require('node:test');
const assert = require('node:assert/strict');
const chat = require('../dist/chat/chat.js');
const keys = require('../dist/settings/keys.js');
const cloud = require('../dist/settings/cloud.js');
keys.publicSettings = () => ({ endpoint:'https://example.test/v1',model:'model',keys:[{id:'1',name:'main'}] });
cloud.cloudSettings = () => ({ enabled:true,hasKey:true,model:'deepseek' });
const {assistantStatus}=require('../dist/assistant/status.js');
test('reports configuration and database counts without contacting providers',async()=>{
 const original=global.fetch;global.fetch=()=>{throw Error('provider should not be contacted')};
 try {
  chat.databasePool=()=>({query:async()=>({rows:[{chats:2,memories:3,links:1,pending:4,failed:0}]})});
  let result=await assistantStatus();assert.equal(result.database,true);assert.deepEqual(result.services,{primary:true,cloud:true});assert.equal(result.counts.pending,4);
  chat.databasePool=()=>{throw Error('database unavailable')};result=await assistantStatus();assert.equal(result.database,false);assert.equal(result.counts,null);assert.equal(result.services.primary,true);
 } finally {global.fetch=original}
});
