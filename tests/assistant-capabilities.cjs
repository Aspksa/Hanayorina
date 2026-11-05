const {test}=require('node:test');const assert=require('node:assert/strict');
const {assistantCapabilities}=require('../dist/assistant/capabilities.js');
const {personalityPrompt}=require('../dist/persona/hanayorina.js');
test('capabilities reflect database and configured model without claiming sensors or actions',()=>{
 const states=(db,model)=>Object.fromEntries(assistantCapabilities(db,model).map(x=>[x.id,x.state]));
 assert.equal(states(false,false).text,'not_configured');assert.equal(states(true,true).text,'available');
 assert.equal(states(false,true).memory,'not_configured');assert.equal(states(true,false).reasoning,'not_configured');
 for(const id of ['sight','hearing','actions'])assert.equal(states(true,true)[id],'not_implemented');
 assert.match(personalityPrompt([]),/Зрение, слух/);assert.match(personalityPrompt([]),/не утверждай|Не утверждай/i);
});
