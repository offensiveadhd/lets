import crypto from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** Time-sortable id: `<prefix>_<10 time chars><10 random chars>` (base36, uppercase). */
export function rid(prefix) {
  const t = Date.now().toString(36).toUpperCase().padStart(10, '0');
  const bytes = crypto.randomBytes(10);
  let r = '';
  for (const b of bytes) r += ALPHABET[b % 36];
  return `${prefix}_${t}${r}`;
}

export function token(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}
