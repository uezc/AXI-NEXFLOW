/**
 * 激活码验证服务（升级版）
 *
 * 新格式：NXF-等级(PRO/BASIC)-序列号(6位)-签名(8位)
 * 示例：NXF-PRO-ABC123-A1B2C3D4
 *
 * 防伪核心：签名 = SHA256("NXF" + 等级 + 序列号 + MASTER_SECRET) 的前 8 位十六进制
 * 存储安全：不直接存 activated: true，而是存加密后的 license_info，每次启动重新验签
 * 硬件预留：校验成功后记录 machineId 到 store，用于后期审计（当前不强制绑定）
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { store } from './store.js';

// ---------------------------------------------------------------------------
// 私有常量（请勿泄露；用于签名与加密）
// ---------------------------------------------------------------------------
const MASTER_SECRET = 'NEXFLOW_SEC_2026_JF';

/** 允许的授权等级 */
const VALID_LEVELS = ['PRO', 'BASIC'] as const;
export type LicenseLevel = (typeof VALID_LEVELS)[number];

/** 校验结果（含权限信息） */
export interface ActivationResult {
  valid: boolean;
  message?: string;
  /** 校验通过时的授权等级 */
  level?: LicenseLevel;
  /** PRO 时带上的权限标识，供业务侧判断 */
  permissions?: { pro: boolean };
}

/** 解密后的授权信息（仅主进程内部使用） */
export interface LicenseInfo {
  activationCode: string;
  activatedAt: number;
  level: LicenseLevel;
}

/** 签名长度（SHA256 十六进制的前 8 位） */
const SIGN_LEN = 8;
/** 序列号长度 */
const SERIAL_LEN = 6;

// ---------------------------------------------------------------------------
// 签名校验（SHA256）
// ---------------------------------------------------------------------------

/**
 * 计算激活码签名：SHA256("NXF" + level + serial + MASTER_SECRET) 的前 8 位十六进制（大写）
 */
function computeSignature(level: string, serial: string): string {
  const payload = 'NXF' + level + serial + MASTER_SECRET;
  const hash = crypto.createHash('sha256').update(payload, 'utf8').digest('hex');
  return hash.slice(0, SIGN_LEN).toUpperCase();
}

/**
 * 验证激活码（新算法）
 * 格式：NXF-等级-序列号(6位)-签名(8位)，等级仅允许 PRO / BASIC
 */
export function validateActivationCode(activationCode: string): ActivationResult {
  const code = activationCode.trim().toUpperCase();

  const parts = code.split('-');
  if (parts.length !== 4) {
    return {
      valid: false,
      message: '激活码格式错误，应为：NXF-等级-序列号(6位)-签名(8位)，例如 NXF-PRO-ABC123-A1B2C3D4',
    };
  }

  const [prefix, level, serial, sign] = parts;

  if (prefix !== 'NXF') {
    return { valid: false, message: '前缀错误，必须为 NXF' };
  }

  if (!VALID_LEVELS.includes(level as LicenseLevel)) {
    return { valid: false, message: '等级错误，仅支持 PRO 或 BASIC' };
  }

  if (serial.length !== SERIAL_LEN || !/^[A-Z0-9]+$/.test(serial)) {
    return { valid: false, message: '序列号必须为 6 位字母或数字' };
  }

  if (sign.length !== SIGN_LEN || !/^[A-F0-9]+$/.test(sign)) {
    return { valid: false, message: '签名必须为 8 位十六进制字符' };
  }

  const expectedSign = computeSignature(level, serial);
  if (sign !== expectedSign) {
    return { valid: false, message: '签名校验失败，激活码无效' };
  }

  const result: ActivationResult = {
    valid: true,
    message: '激活码验证成功',
    level: level as LicenseLevel,
  };
  if (level === 'PRO') {
    result.permissions = { pro: true };
  }
  return result;
}

// ---------------------------------------------------------------------------
// 管理员用：生成激活码（请勿打包到生产；可单独提取为生成器脚本）
// ---------------------------------------------------------------------------

// /**
//  * 根据等级与序列号生成合法激活码（仅管理员内部使用）
//  * 使用方式：generateLicenseForAdmin('PRO', 'ABC123') => 'NXF-PRO-ABC123-XXXXXXXX'
//  */
// function generateLicenseForAdmin(level: LicenseLevel, serial: string): string {
//   const s = serial.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, SERIAL_LEN);
//   if (s.length !== SERIAL_LEN) throw new Error('序列号必须为 6 位字母或数字');
//   const sign = computeSignature(level, s);
//   return `NXF-${level}-${s}-${sign}`;
// }

// ---------------------------------------------------------------------------
// 硬件指纹（轻绑定预留，仅记录不强制校验）
// ---------------------------------------------------------------------------

/**
 * 获取当前机器简单指纹（用于审计与后续可选绑定）
 * 基于 hostname、platform、arch 生成，不涉及网卡等敏感信息
 */
export function getMachineId(): string {
  const raw = [os.hostname(), os.platform(), os.arch()].join('|');
  const hash = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  return hash.slice(0, 16);
}

// ---------------------------------------------------------------------------
// 授权信息加密存储（防止用户直接改配置文件伪造 activated）
// ---------------------------------------------------------------------------

function getEncryptionKey(): Buffer {
  return crypto.createHash('sha256').update(MASTER_SECRET, 'utf8').digest();
}

function getIV(): Buffer {
  return crypto.createHash('sha256').update(MASTER_SECRET + 'iv', 'utf8').digest().subarray(0, 16);
}

const ALGO = 'aes-256-cbc';

/**
 * 将授权信息加密为可存储字符串
 */
function encryptLicenseInfo(licenseInfo: LicenseInfo): string {
  const key = getEncryptionKey();
  const iv = getIV();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const json = JSON.stringify(licenseInfo);
  const enc = Buffer.concat([cipher.update(json, 'utf8'), cipher.final()]);
  return enc.toString('hex');
}

/**
 * 从存储的密文解密出授权信息；解密失败或格式错误返回 null
 */
function decryptLicenseInfo(encryptedHex: string): LicenseInfo | null {
  try {
    const key = getEncryptionKey();
    const iv = getIV();
    const buf = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    const json = decipher.update(buf) + decipher.final('utf8');
    const info = JSON.parse(json) as LicenseInfo;
    if (!info.activationCode || !info.level || typeof info.activatedAt !== 'number') {
      return null;
    }
    return info;
  } catch {
    return null;
  }
}

const STORE_KEY_ENCRYPTED = 'license_info_encrypted';
const STORE_KEY_MACHINE_ID = 'machine_id';

/**
 * 校验通过后写入：加密的 license_info + 当前 machineId（审计用）
 */
export function saveLicenseInfo(licenseInfo: LicenseInfo, machineId: string): void {
  const encrypted = encryptLicenseInfo(licenseInfo);
  store.set(STORE_KEY_ENCRYPTED, encrypted);
  store.set(STORE_KEY_MACHINE_ID, machineId);
  // 不再写入 activated / activationCode，以加密数据为准
}

/**
 * 从 store 读取并验签：解密 license_info，再对激活码做一次签名校验
 * 防止用户篡改配置文件或复制他人 license 后直接改 activated
 * @returns 验签通过返回 LicenseInfo，否则返回 null
 */
export function loadAndVerifyLicense(): LicenseInfo | null {
  const encrypted = store.get(STORE_KEY_ENCRYPTED) as string | undefined;
  if (!encrypted || typeof encrypted !== 'string') {
    return null;
  }

  const licenseInfo = decryptLicenseInfo(encrypted);
  if (!licenseInfo) {
    return null;
  }

  // 每次读取都重新验签
  const result = validateActivationCode(licenseInfo.activationCode);
  if (!result.valid) {
    return null;
  }

  return licenseInfo;
}

/**
 * 获取当前已记录的机器 ID（仅用于审计展示，不参与校验）
 */
export function getStoredMachineId(): string | undefined {
  return store.get(STORE_KEY_MACHINE_ID) as string | undefined;
}
