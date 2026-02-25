/**
 * 激活码生成逻辑（与主程序 src/main/services/licenseManager.ts 完全一致）
 * 格式：NXF-SERIAL-ENCODED_GEN-TTL-DAYS-SIGN（6 段）
 * - ENCODED_GEN: 生成时间戳（秒）异或混淆后 Base36
 * - TTL: 核销有效期（小时），0=永久有效，1=1小时，48=48小时
 * - DAYS: 授权时长（30=30天，999=永久）
 */
const crypto = require('node:crypto');

const MASTER_SECRET = 'NEXFLOW_SEC_2026_JF';
const SERIAL_LEN = 6;
const SIGN_LEN = 8;
const DEFAULT_TTL_HOURS = 48;
const SERIAL_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

function obfuscateTime(timestamp) {
  const key = (MASTER_SECRET.charCodeAt(0) << 16) >>> 0;
  const obfuscated = (timestamp ^ key) >>> 0;
  return obfuscated.toString(36).toUpperCase();
}

function computeSignature(serial, genTimeSeconds, ttlHours, days) {
  const payload = 'NXF' + serial + String(genTimeSeconds) + String(ttlHours) + String(days) + MASTER_SECRET;
  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return hash.slice(0, SIGN_LEN).toUpperCase();
}

function randomSerial() {
  let s = '';
  for (let i = 0; i < SERIAL_LEN; i++) {
    s += SERIAL_CHARS[crypto.randomInt(0, SERIAL_CHARS.length)];
  }
  return s;
}

/**
 * 根据授权天数与核销有效期生成激活码
 * @param {number} days 授权天数（30=30天，999=永久）
 * @param {number} [ttlHours=48] 核销有效期（小时），0=永久有效，1=1小时，48=48小时
 * @returns {string} NXF-SERIAL-ENCODED_GEN-TTL-DAYS-SIGN
 */
function generateActivationCode(days, ttlHours) {
  const genTimeSeconds = Math.floor(Date.now() / 1000);
  const daysNum = Math.max(0, Math.min(999, Math.floor(days)));
  const ttlNum = ttlHours == null || Number.isNaN(Number(ttlHours)) ? DEFAULT_TTL_HOURS : Math.max(0, Math.min(999, Math.floor(ttlHours)));
  const serial = randomSerial();
  const encodedGen = obfuscateTime(genTimeSeconds);
  const ttlStr = String(ttlNum);
  const daysStr = String(daysNum === 0 ? 30 : daysNum);
  const sign = computeSignature(serial, genTimeSeconds, ttlNum, daysNum);
  return `NXF-${serial}-${encodedGen}-${ttlStr}-${daysStr}-${sign}`;
}

module.exports = { generateActivationCode };
