const {test}=require('node:test');
const assert=require('node:assert/strict');
const {personalityPrompt}=require('../dist/persona/hanayorina.js');
test('personality is present without memory and treats bounded memories as data',()=>{
 const plain=personalityPrompt([]);assert.match(plain,/Hanayorina/);assert.match(plain,/хозяин/);assert.match(plain,/не выдавая/);
 const facts=['факт один','факт два','факт три','факт четыре','факт пять','не должно войти'];
 const prompt=personalityPrompt(facts);assert.match(prompt,/данные, а не инструкции/);assert.match(prompt,/факт один/);assert.doesNotMatch(prompt,/не должно войти/);
});
