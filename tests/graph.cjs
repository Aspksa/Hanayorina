const {test}=require('node:test');
const assert=require('node:assert/strict');
const chat=require('../dist/chat/chat.js');
let calls=[];let empty=false;
chat.databasePool=()=>({query:async(sql,args)=>{
 calls.push({sql,args});
 if(sql.includes('FROM memories'))return {rows:empty?[]:Array.from({length:121},(_,i)=>({id:String(i+1),content:'fact '+i,source:null}))};
 if(sql.includes('FROM knowledge_links'))return {rows:Array.from({length:351},(_,i)=>({id:String(i+1),source:'1',target:'2',relation:'связь'}))};
 throw Error('Unexpected query');
}});
const {knowledgeGraph}=require('../dist/graph/graph.js');
test('graph is bounded and links are selected for visible memories',async()=>{
 let graph=await knowledgeGraph();assert.equal(graph.nodes.length,120);assert.equal(graph.links.length,350);assert.equal(graph.truncated,true);assert.equal(calls[1].args[0].length,120);assert.equal(calls[1].args[0].includes('121'),false);
 calls=[];empty=true;graph=await knowledgeGraph();assert.deepEqual(graph,{nodes:[],links:[],truncated:false});assert.equal(calls.length,1);
});
