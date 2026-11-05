const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runWorkspaceCommand } = require('../dist/tools/workspace.js');
const { validateCandidates } = require('../dist/memory/ai.js');
test('local commands stay inside the workspace and never overwrite existing files', () => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'hana-work-')); const outside=fs.mkdtempSync(path.join(os.tmpdir(),'hana-out-'));
 const old=process.env.HANAYORINA_WORKSPACE_ROOT;process.env.HANAYORINA_WORKSPACE_ROOT=root;
 try {
  fs.writeFileSync(path.join(root,'note.md'),'привет мир');fs.writeFileSync(path.join(outside,'private.md'),'private');fs.mkdirSync(path.join(root,'data'));fs.writeFileSync(path.join(root,'data','model-keys.json'),'secret');
  assert.match(runWorkspaceCommand('/прочитать note.md'),/привет мир/);assert.match(runWorkspaceCommand('/найти привет'),/note.md/);
  assert.match(runWorkspaceCommand('/создать новое.md\nсодержимое'),/Создан/);assert.equal(fs.readFileSync(path.join(root,'новое.md'),'utf8'),'содержимое');
  assert.throws(()=>runWorkspaceCommand('/создать note.md\nchange'));assert.throws(()=>runWorkspaceCommand('/прочитать ../private.md'));assert.throws(()=>runWorkspaceCommand('/прочитать data/model-keys.json'));
  if(process.platform!=='win32'){fs.symlinkSync(outside,path.join(root,'link'));assert.throws(()=>runWorkspaceCommand('/прочитать link/private.md'));}
 }finally{if(old===undefined)delete process.env.HANAYORINA_WORKSPACE_ROOT;else process.env.HANAYORINA_WORKSPACE_ROOT=old;fs.rmSync(root,{recursive:true,force:true});fs.rmSync(outside,{recursive:true,force:true})}
});
test('model proposals require a real source quote and exclude obvious secrets',()=>{
 const jobs=[{message_id:'1',conversation_id:'1',content:'Мы решили использовать PostgreSQL для хранения данных проекта.'}];
 const good={messageId:'1',quote:'использовать PostgreSQL',text:'Проект использует PostgreSQL',kind:'decision'};
 assert.equal(validateCandidates({facts:[good,{...good,quote:'несуществующая цитата'},{...good,text:'пароль: тест'}]},jobs).length,1);
});
