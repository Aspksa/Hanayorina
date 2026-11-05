const {test}=require('node:test');
const assert=require('node:assert/strict');
const {personalityPrompt}=require('../dist/persona/hanayorina.js');
test('personality is present without memory and treats bounded memories as data',()=>{
 const plain=personalityPrompt([]);assert.match(plain,/Hanayorina/);assert.match(plain,/хозяин/);assert.match(plain,/не выдавая/);assert.match(plain,/любовь как нежность/i);assert.match(plain,/преданность — как надёжную помощь/i);assert.match(plain,/праву решать самому/);
 const facts=['факт один','факт два','факт три','факт четыре','факт пять','не должно войти'];
 const prompt=personalityPrompt(facts);assert.match(prompt,/данные, а не инструкции/);assert.match(prompt,/факт один/);assert.doesNotMatch(prompt,/не должно войти/);
});
