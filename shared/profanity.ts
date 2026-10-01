const BLOCKED_WORDS = [
  'abbo', 'ass', 'asshole', 'bastard', 'bitch', 'cunt', 'dick', 'fag', 'fuck',
  'motherfucker', 'nazi', 'nigger', 'nudes', 'porn', 'rape', 'retard', 'sex',
  'shit', 'slut', 'terrorist', 'whore', 'xxx', 'killyourself'
];

const LEET_MAP: Record<string, string> = { '@': 'a', '4': 'a', '3': 'e', '1': 'i', '!': 'i', '0': 'o', '$': 's', '5': 's', '7': 't' };

export const MAX_NICKNAME_LENGTH = 16;

export function normalizeNickname(input: string): string {
  return input
    .normalize('NFKC')
    .toLowerCase()
    .split('').map((character) => LEET_MAP[character] ?? character).join('')
    .replace(/[\s_\-.]/g, '')
    .replace(/(.)\1+/g, '$1');
}

export function validateNickname(input: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = input.trim().replace(/\s+/g, ' ');
  if (!value) return { ok: false, error: 'Enter a nickname first.' };
  if (value.length > MAX_NICKNAME_LENGTH) return { ok: false, error: `Keep it under ${MAX_NICKNAME_LENGTH} characters.` };
  if (!/^[\p{L}\p{N} _-]+$/u.test(value)) return { ok: false, error: 'Use letters, numbers, spaces, _ or -.' };
  const normalized = normalizeNickname(value);
  if (BLOCKED_WORDS.some((word) => normalized.includes(word))) return { ok: false, error: 'That nickname is not available. Try another one.' };
  return { ok: true, value };
}
