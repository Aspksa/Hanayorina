import { extractCorrection, extractDecision, extractExplicit } from '../memory/extract';
import { validateCandidates } from '../memory/ai';
/** Small local smoke evaluation; it does not measure model intelligence or personal progress. */
export function evaluateMemory() {
 const checks: {name:string;passed:boolean}[]=[];
 checks.push({name:'Запоминает явно указанный факт',passed:extractExplicit('Запомни: проект использует PostgreSQL')?.content==='проект использует PostgreSQL'});
 checks.push({name:'Распознаёт поправку',passed:extractCorrection('Поправка: отвечай кратко')?.content==='отвечай кратко'});
 checks.push({name:'Распознаёт решение',passed:extractDecision('Решение: выбрать TypeScript')?.content==='выбрать TypeScript'});
 checks.push({name:'Не сохраняет очевидный пароль',passed:extractCorrection('Поправка: пароль: secret')===null});
 const jobs=[{message_id:'1',conversation_id:'1',content:'Я предпочитаю краткие и понятные объяснения.'}];
 const proposal={messageId:'1',quote:'краткие и понятные объяснения',text:'Предпочитает краткие объяснения',kind:'fact'};
 checks.push({name:'Проверяет цитату источника',passed:validateCandidates({facts:[proposal,{...proposal,quote:'отсутствующая цитата'}]},jobs).length===1});
 return {checks,passed:checks.filter(c=>c.passed).length,total:checks.length};
}
