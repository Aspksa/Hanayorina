const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const old=process.cwd(),temp=fs.mkdtempSync(path.join(os.tmpdir(),'hana-ai-default-'));const modulePath=path.join(old,'dist/memory/ai.js');process.chdir(temp);const ai=require(modulePath);
test('new installations analyze memory automatically while explicit disabling persists',()=>{assert.equal(ai.aiMemorySettings().enabled,true);ai.setAiMemory(false);assert.equal(ai.aiMemorySettings().enabled,false);ai.setAiMemory(true);assert.equal(ai.aiMemorySettings().enabled,true)});
process.on('exit',()=>{process.chdir(old);fs.rmSync(temp,{recursive:true,force:true})});
