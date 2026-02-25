#!/usr/bin/env node
/**
 * 将 build/icon.jpg 或 build/icon.png 转为 build/icon.ico（256x256 等多尺寸），供 Windows 安装包使用。
 * 若已存在 build/icon.ico 且未提供 --force，则跳过。
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildDir = path.join(__dirname, '..', 'build');
const icoPath = path.join(buildDir, 'icon.ico');

const force = process.argv.includes('--force');

async function main() {
  if (!force && fs.existsSync(icoPath)) {
    console.log('[convert-icon] build/icon.ico 已存在，跳过。使用 --force 强制重新生成。');
    return;
  }
  const jpgPath = path.join(buildDir, 'icon.jpg');
  const pngPath = path.join(buildDir, 'icon.png');
  const srcPath = fs.existsSync(jpgPath) ? jpgPath : (fs.existsSync(pngPath) ? pngPath : null);
  if (!srcPath) {
    console.warn('[convert-icon] 未找到 build/icon.jpg 或 build/icon.png，跳过。');
    return;
  }
  const sharp = (await import('sharp')).default;
  const pngToIco = (await import('png-to-ico')).default;
  const sizes = [256, 48, 32, 16];
  const tempPngs = [];
  try {
    for (const size of sizes) {
      const out = path.join(buildDir, `_icon_${size}.png`);
      await sharp(srcPath)
        .resize(size, size)
        .png()
        .toFile(out);
      tempPngs.push(out);
    }
    const buf = await pngToIco(tempPngs);
    fs.writeFileSync(icoPath, buf);
    console.log('[convert-icon] 已生成 build/icon.ico（含 256/48/32/16 尺寸）');
  } finally {
    for (const p of tempPngs) {
      try { fs.unlinkSync(p); } catch (_) {}
    }
  }
}

main().catch((e) => {
  console.error('[convert-icon]', e);
  process.exit(1);
});
