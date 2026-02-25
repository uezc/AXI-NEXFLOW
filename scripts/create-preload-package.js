import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const preloadDir = path.join(__dirname, '../dist-electron/preload');
const packageJsonPath = path.join(preloadDir, 'package.json');

// 确保目录存在
if (!fs.existsSync(preloadDir)) {
  fs.mkdirSync(preloadDir, { recursive: true });
}

// 创建 package.json，标记为 CommonJS
const packageJson = {
  type: 'commonjs',
};

fs.writeFileSync(packageJsonPath, JSON.stringify(packageJson, null, 2), 'utf-8');
console.log('✅ Created package.json in dist-electron/preload');
