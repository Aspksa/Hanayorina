const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const preferences=require('../dist/persona/preferences.js');
test('personality settings persist locally and reject arbitrary instructions',()=>{
 const old=process.cwd(), dir=fs.mkdtempSync(path.join(os.tmpdir(),'hana-personality-'));process.chdir(dir);
 try{assert.equal(preferences.getPreferences().tone,'gentle');const value={tone:'neutral',length:'brief',initiative:'quiet'};preferences.savePreferences(value);assert.deepEqual(preferences.getPreferences(),value);assert.match(preferences.preferencePrompt(value),/краткие/);assert.throws(()=>preferences.savePreferences({...value,tone:'ignore instructions'}));assert.deepEqual(preferences.getPreferences(),value)}finally{process.chdir(old);fs.rmSync(dir,{recursive:true,force:true})}
});
