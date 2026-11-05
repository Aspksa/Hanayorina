const {test}=require('node:test');
const assert=require('node:assert/strict');
const {extractDecision}=require('../dist/memory/extract.js');
test('explicit decisions are extracted locally without treating casual text or secrets as decisions',()=>{
 assert.equal(extractDecision('Решение: использовать PostgreSQL').content,'использовать PostgreSQL');
 assert.equal(extractDecision('решили: выбрать TypeScript').content,'выбрать TypeScript');
 assert.equal(extractDecision('решили поработать'),null);
 assert.equal(extractDecision('Решение: пароль: secret'),null);
});
