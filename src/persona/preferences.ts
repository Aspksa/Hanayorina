import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Preferences = { tone: 'gentle' | 'neutral'; length: 'brief' | 'balanced' | 'detailed'; initiative: 'quiet' | 'balanced' | 'active' };
const defaults: Preferences = { tone: 'gentle', length: 'balanced', initiative: 'balanced' };
function valid(value: unknown): value is Preferences {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  return ['gentle','neutral'].includes(String(p.tone)) && ['brief','balanced','detailed'].includes(String(p.length)) && ['quiet','balanced','active'].includes(String(p.initiative));
}
function file() { return join(process.cwd(), 'data', 'personality.json'); }
export function getPreferences(): Preferences {
  try { const p: unknown = JSON.parse(readFileSync(file(), 'utf8')); if (!valid(p)) throw Error(); return p; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ...defaults }; throw new Error('Не удалось прочитать настройки характера.'); }
}
export function savePreferences(value: unknown): void {
  if (!valid(value)) throw new Error('Некорректные настройки характера.');
  const folder=join(process.cwd(),'data'); mkdirSync(folder,{recursive:true,mode:0o700});
  const temp=join(folder,`.personality-${randomUUID()}.tmp`);
  try { writeFileSync(temp,JSON.stringify(value),{encoding:'utf8',flag:'wx',mode:0o600}); renameSync(temp,file()); }
  catch {try { unlinkSync(temp); } catch {} throw new Error('Не удалось сохранить настройки характера.');}
}
export function preferencePrompt(p: Preferences): string {
  const tone={gentle:'Говори мягко и заботливо.',neutral:'Говори спокойно и сдержанно.'}[p.tone];
  const length={brief:'Предпочитай краткие ответы.',balanced:'Подбирай длину ответа по сложности вопроса.',detailed:'По возможности объясняй подробно и по шагам.'}[p.length];
  const initiative={quiet:'Предлагай дополнительные шаги только когда они необходимы.',balanced:'Предлагай следующий шаг, если он полезен.',active:'Проявляй инициативу в предложениях, учитывая контекст.'}[p.initiative];
  return `${tone} ${length} ${initiative} Эти предпочтения можно изменить; конкретная просьба пользователя имеет приоритет.`;
}
