const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {rootPath}=require('../dist/tools/workspace.js');
test('creates only the default local library and preserves explicit workspace',()=>{
 const old=process.cwd(),env=process.env.HANAYORINA_WORKSPACE_ROOT,dir=fs.mkdtempSync(path.join(os.tmpdir(),'hana-auto-'));
 try{process.chdir(dir);delete process.env.HANAYORINA_WORKSPACE_ROOT;assert.equal(rootPath(),fs.realpathSync(path.join(dir,'data','library')));const chosen=path.join(dir,'chosen');fs.mkdirSync(chosen);process.env.HANAYORINA_WORKSPACE_ROOT=chosen;assert.equal(rootPath(),fs.realpathSync(chosen));process.env.HANAYORINA_WORKSPACE_ROOT=path.join(dir,'offline');assert.throws(()=>rootPath());assert.equal(fs.existsSync(path.join(dir,'offline')),false)}finally{process.chdir(old);if(env===undefined)delete process.env.HANAYORINA_WORKSPACE_ROOT;else process.env.HANAYORINA_WORKSPACE_ROOT=env;fs.rmSync(dir,{recursive:true,force:true})}
});
