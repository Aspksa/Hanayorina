import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';

const allowed = new Set(['.txt','.md','.csv','.json','.ts','.tsx','.js','.py','.html','.css','.yaml','.yml']);
const ignore = new Set(['node_modules','dist','build','vendor','__pycache__','data','.runtime']);
export function rootPath(): string {
  const configured = process.env.HANAYORINA_WORKSPACE_ROOT;
  if (configured && !isAbsolute(configured)) throw new Error('Путь к рабочей папке должен быть абсолютным.');
  const fallback = join(process.cwd(),'data','library');
  if (!configured) { mkdirSync(fallback,{recursive:true,mode:0o700}); if (lstatSync(fallback).isSymbolicLink()) throw new Error('Папка библиотеки не может быть символической ссылкой.'); }
  const root = realpathSync(configured || fallback);
  if (!lstatSync(root).isDirectory()) throw new Error('Рабочая папка не найдена.');
  return root;
}
function components(name: string): string[] {
  const bits = name.split(/[\\/]/);
  if (!name || name.length>500 || isAbsolute(name) || bits.some(x=>!x || x==='.' || x==='..' || x.startsWith('.') || /[<>:"|?*\x00-\x1f]/.test(x) || /[. ]$/.test(x) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(x))) throw new Error('Укажите относительный путь внутри рабочей папки.');
  if (bits.some(x=>ignore.has(x.toLowerCase()) || /(?:^|[-_.])(secrets?|passwords?|credentials?|tokens?|keys?)(?:[-_.]|$)/i.test(x))) throw new Error('Доступ к служебным папкам и файлам с ключами запрещён.');
  if (!allowed.has(extname(bits[bits.length-1]).toLowerCase())) throw new Error('Этот тип файла не поддерживается.');
  return bits;
}
export function target(root: string, name: string, creating: boolean): string {
  const parts = components(name); let at = root;
  for (let i=0;i<parts.length;i++) {
    at=join(at,parts[i]); const last=i===parts.length-1;
    if (creating && last && !existsSync(at)) break;
    const stat=lstatSync(at); if (stat.isSymbolicLink()) throw new Error('Символические ссылки не поддерживаются.');
    if (!last && !stat.isDirectory()) throw new Error('Папка не найдена.');
    if (last && !stat.isFile()) throw new Error('Нужен обычный файл.');
    const actual=realpathSync(at), rel=relative(root,actual);
    if (rel==='..' || rel.startsWith('..'+sep) || isAbsolute(rel)) throw new Error('Путь за пределами рабочей папки.');
  }
  return at;
}
export function readSafe(root: string, name: string): string {
  const path=target(root,name,false); const fd=openSync(path,constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try { if (fstatSync(fd).size>200_000) throw new Error('Файл слишком большой для чтения в чате.'); const text=readFileSync(fd,'utf8'); if(text.includes('\0')) throw new Error('Файл не является текстовым.'); return text; }
  finally {closeSync(fd)}
}
function search(root:string, query:string): string {
  const phrase=query.trim().toLocaleLowerCase(); if(phrase.length<3||phrase.length>120)throw new Error('Для поиска введите от 3 до 120 символов.');
  const pending=[{directory:root,depth:0}], results:string[]=[];let scanned=0;
  while(pending.length && scanned<200 && results.length<20){
    const next=pending.shift()!;
    for(const entry of readdirSync(next.directory,{withFileTypes:true})){
      if(entry.name.startsWith('.')||ignore.has(entry.name.toLowerCase())||/(?:^|[-_.])(secrets?|passwords?|credentials?|tokens?|keys?)(?:[-_.]|$)/i.test(entry.name)||entry.isSymbolicLink())continue;
      const path=join(next.directory,entry.name);
      if(entry.isDirectory()&&next.depth<6){pending.push({directory:path,depth:next.depth+1});continue;}
      if(!entry.isFile()||!allowed.has(extname(entry.name).toLowerCase()))continue;
      if(++scanned>200)break;
      const name=relative(root,path);try{const text=readSafe(root,name);const line=text.split(/\r?\n/).find(x=>x.toLocaleLowerCase().includes(phrase));if(line||basename(name).toLocaleLowerCase().includes(phrase))results.push(`${name}: ${(line||'совпадение в имени файла').trim().slice(0,180)}`);}catch{}
      if(results.length>=20)break;
    }
  }
  return results.length ? `Найдено совпадений: ${results.length} (проверено файлов: ${scanned}; максимум 200).\n`+results.join('\n') : `Совпадения не найдены среди ${scanned} проверенных файлов (максимум 200).`;
}
function gitSummary(root:string): string {
  const run=(args:string[])=>spawnSync('git',['-c','core.fsmonitor=false','-C',root,...args],{encoding:'utf8',timeout:3000,maxBuffer:100000,windowsHide:true,env:{...process.env,GIT_CONFIG_NOSYSTEM:'1',GIT_OPTIONAL_LOCKS:'0',GIT_TERMINAL_PROMPT:'0'}});
  const inside=run(['rev-parse','--is-inside-work-tree']);if(inside.status!==0||inside.stdout.trim()!=='true')throw new Error('Рабочая папка не является локальным Git-репозиторием или Git недоступен.');
  const branch=run(['branch','--show-current']),status=run(['status','--short','--untracked-files=no']);
  if(branch.status!==0||status.status!==0)throw new Error('Не удалось прочитать состояние Git.');
  return `Локальный Git-проект\nВетка: ${branch.stdout.trim()||'(отдельный коммит)'}\nИзменения отслеживаемых файлов:\n${status.stdout.trim().slice(0,6000)||'нет'}`;
}
/** Explicit user commands only; no model-controlled tool execution. */
export function runWorkspaceCommand(input:string): string | null {
  const match=input.match(/^\/(прочитать|найти|создать|проект)(?:[ \t]+([^\r\n]*))?(?:\r?\n([\s\S]*))?$/i);if(!match)return null;
  const command=match[1].toLocaleLowerCase('ru'),arg=(match[2]||'').trim();const root=rootPath();
  if(command==='прочитать'){if(!arg)throw new Error('Укажите файл после /прочитать.');return `Файл ${arg}:\n${readSafe(root,arg).slice(0,12000)}`;}
  if(command==='найти')return search(root,arg);
  if(command==='проект'){if(arg||match[3])throw new Error('Команда /проект не принимает параметры.');return gitSummary(root);}
  if(!arg||!match[3]||match[3].length>100000)throw new Error('Укажите путь после /создать, а содержимое — со следующей строки.');
  const path=target(root,arg,true);writeFileSync(path,match[3],{encoding:'utf8',flag:'wx',mode:0o600});return `Создан файл ${arg} в рабочей папке.`;
}
