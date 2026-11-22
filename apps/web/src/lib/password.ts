const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS = '23456789';
const SYMBOLS = '!@#$%*-_+?';

function pick(alphabet: string): string {
  const buf = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / alphabet.length) * alphabet.length;
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0] < limit) return alphabet[buf[0] % alphabet.length];
  }
}

/** A strong random password without look-alike characters (no 0/O, 1/l/I). */
export function generatePassword(length = 18): string {
  const all = LOWER + UPPER + DIGITS + SYMBOLS;
  const chars = [pick(LOWER), pick(UPPER), pick(DIGITS), pick(SYMBOLS)];
  while (chars.length < length) chars.push(pick(all));
  // Fisher–Yates shuffle so the guaranteed characters are not always first
  for (let i = chars.length - 1; i > 0; i--) {
    const buf = new Uint32Array(1);
    crypto.getRandomValues(buf);
    const j = buf[0] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
