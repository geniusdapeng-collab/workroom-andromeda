/**
 * accounts/totp —— 平台运营二次验证（RFC 6238 TOTP，Node crypto 零依赖）
 * 平台域 MFA 硬要求：邮箱+密码+TOTP 三要素；break-glass 前强制重验。
 */
import { createHmac, randomBytes } from "node:crypto";

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpSecret(): string {
  const bytes = randomBytes(20);
  let out = "";
  for (const b of bytes) out += B32[b % 32];
  return out;
}

function b32decode(s: string): Buffer {
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const c of s.toUpperCase().replace(/=+$/, "")) {
    const idx = B32.indexOf(c);
    if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}

export function totpCode(secret: string, timeMs = Date.now(), stepSec = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / stepSec);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", b32decode(secret)).update(buf).digest();
  const offset = h[h.length - 1]! & 0x0f;
  const code = ((h.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits);
  return String(code).padStart(digits, "0");
}

/** 校验（容忍前后各一个时间窗的时钟漂移） */
export function verifyTotp(secret: string, code: string, timeMs = Date.now()): boolean {
  for (const drift of [-30_000, 0, 30_000]) {
    if (totpCode(secret, timeMs + drift) === code) return true;
  }
  return false;
}

/** otpauth URI（供认证器扫码绑定） */
export function totpUri(secret: string, account: string, issuer = "WorkLoom-Andromeda"): string {
  return `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}`;
}
