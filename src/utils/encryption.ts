import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * AES-256-GCM による対称鍵暗号化。
 *
 * 鍵は環境変数 WP_APP_PW_ENC_KEY から取得する（base64 / hex / 任意文字列を SHA-256 で 32 byte に正規化）。
 * 出力フォーマット: base64( IV(12) | TAG(16) | CIPHERTEXT )
 *
 * KMS 移行時は本ファイルの実装を Cloud KMS Cryptography に差し替える。
 */
const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const raw = process.env.WP_APP_PW_ENC_KEY;
  if (!raw) {
    throw new Error('WP_APP_PW_ENC_KEY is not set');
  }
  // 任意の入力を 32 byte に正規化
  return createHash('sha256').update(raw, 'utf-8').digest();
}

export function encryptSecret(plain: string): string {
  if (!plain) return '';
  const key = getKey();
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf-8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString('base64');
}

export function decryptSecret(encoded: string): string {
  if (!encoded) return '';
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LEN + TAG_LEN) {
    throw new Error('encrypted payload is too short');
  }
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN + TAG_LEN);
  const key = getKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const dec = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return dec.toString('utf-8');
}
