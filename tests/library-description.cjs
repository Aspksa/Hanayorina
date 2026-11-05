const {test}=require('node:test');const assert=require('node:assert/strict');const {describeDocument}=require('../dist/library/index.js');
test('local document description points to exact line and bounded topic hints',()=>{
 const result=describeDocument('Первая строка\nПамять PostgreSQL и документы\nЗавершение','PostgreSQL');assert.equal(result.line,2);assert.equal(result.excerpt,'Память PostgreSQL и документы');assert(result.topics.length<=5);assert.equal(describeDocument('Данные','отсутствует').line,null);
});
