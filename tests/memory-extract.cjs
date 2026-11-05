const {test}=require('node:test');
const assert=require('node:assert/strict');
const {extractExplicit,topics}=require('../dist/memory/extract.js');
test('extracts explicit facts while ignoring unrelated text and obvious secrets',()=>{
 assert.equal(extractExplicit('Привет как дела?'),null);
 const f=extractExplicit('Запомни: мой проект использует PostgreSQL.');assert.equal(f.content,'мой проект использует PostgreSQL.');assert.match(f.normalized,/postgresql/);
 assert.equal(extractExplicit('Меня зовут Анна').subject,'user.name');
 assert.equal(extractExplicit('Запомни: пароль: example'),null);
 assert.equal(extractExplicit('Запомни: sk-abcdefghijklmnopqrstuvwxyz'),null);
 assert(topics('проект использует PostgreSQL').includes('postgresql'));
});
