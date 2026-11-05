const { test } = require('node:test');
const assert = require('node:assert/strict');
const { extractCorrection } = require('../dist/memory/extract.js');
const { relevantMemories } = require('../dist/memory/search.js');
test('only explicit safe corrections are proposed',()=>{
 assert.equal(extractCorrection('Поправка: объясняй решения кратко').content,'объясняй решения кратко');
 assert.equal(extractCorrection('Исправление: пароль: secret'),null);
 assert.equal(extractCorrection('Это не так'),null);
});
test('confirmed corrections are retrieved even when the question uses different words',async()=>{
 const pool={query:async(sql)=>sql.includes("t.kind='correction'")?{rows:[{id:'1',content:'Объясняй кратко',status:'confirmed'}]}:{rows:[]}};
 const result=await relevantMemories(pool,'Расскажи про проект');
 assert.equal(result[0].content,'Объясняй кратко');
});
