const {test}=require('node:test');const assert=require('node:assert/strict');const {validateReview}=require('../dist/history/model-review.js');
test('model review keeps only user questions with exact supported quotes',()=>{
 const sources=[{id:'1',role:'user',content:'Как правильно настроить память PostgreSQL?'},{id:'2',role:'assistant',content:'Нужна настройка базы и пароля.'}];
 const result=validateReview({summary:'Обсуждалась память.',questions:[{messageId:'1',quote:'настроить память PostgreSQL',text:'Как настроить память?'},{messageId:'2',quote:'настройка базы и пароля',text:'Вопрос?'},{messageId:'1',quote:'несуществующий фрагмент',text:'Вопрос?'}]},sources);
 assert.equal(result.questions.length,1);assert.equal(result.questions[0].messageId,'1');
 assert.throws(()=>validateReview({summary:'пароль: secret',questions:[]},sources));
});
