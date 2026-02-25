#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const buildIcon = path.join(__dirname, '..', 'build', 'icon.png');
const publicDir = path.join(__dirname, '..', 'public');
const publicIcon = path.join(publicDir, 'icon.png');
if (fs.existsSync(buildIcon)) {
  try {
    fs.mkdirSync(publicDir, { recursive: true });
    fs.copyFileSync(buildIcon, publicIcon);
    console.log('[copy-icon] build/icon.png -> public/icon.png');
  } catch (e) {
    console.warn('[copy-icon]', e.message);
  }
}
