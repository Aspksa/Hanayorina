export type Fact = { content: string; normalized: string; subject: string | null };
export function extractExplicit(text: string): Fact | null {
  const match = text.trim().match(/^(?:пожалуйста[, ]+)?запомни(?:те)?[,:! ]+(?:что[ ,]+)?([\s\S]+)$/i);
  const plain = text.trim();
  if (!match && !/^(?:меня зовут\s+|я предпочитаю\s+|мой проект называется\s+)/i.test(plain)) return null;
  const content = (match ? match[1] : plain).trim().replace(/\s+/g, ' ').slice(0, 1000);
  if (content.length < 4 || /(?:sk-[a-z0-9-]{12,}|bearer\s+\S+|пароль\s*[:=]|api[ _-]?key\s*[:=])/i.test(content)) return null;
  const normalized = content.toLocaleLowerCase('ru').replace(/ё/g, 'е').replace(/[.!?]+$/, '').replace(/\s+/g, ' ').trim();
  let subject: string | null = null;
  if (/^меня зовут\s+/i.test(content)) subject = 'user.name';
  else if (/^мой часовой пояс\s*[:—-]?\s+/i.test(content)) subject = 'user.timezone';
  return { content, normalized, subject };
}
const stop = new Set(['который','которая','которые','проект','проекта','проекте','использует','использовать','нужно','важно','потому','чтобы','можно','меня','мой','моя','работает','работать','предпочитаю','только','хозяин','нельзя','всегда']);
export function topics(text: string): string[] {
  return [...new Set((text.toLocaleLowerCase('ru').match(/[a-zа-яё0-9][a-zа-яё0-9._-]{4,}/giu) || []).filter(word => !stop.has(word)).slice(0, 12))];
}
