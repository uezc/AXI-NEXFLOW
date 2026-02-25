# NEXFLOW 激活码生成器

独立小应用，用于生成 NEXFLOW 主程序可识别的激活码。黑底白字极简界面。

## 使用步骤

1. **安装依赖**（首次或更新后）  
   在项目根目录执行：
   ```bash
   cd activation-generator
   npm install
   ```

2. **运行**  
   ```bash
   npm start
   ```

3. **界面操作**  
   - 在「授权天数」输入框填写天数（默认 30）。  
   - 点击「生成并复制」。  
   - 激活码会出现在下方输入框，并已自动复制到系统剪贴板。  
   - 打开 NEXFLOW 主程序，在激活页粘贴该激活码即可完成激活。

## 打包为 exe（可选）

```bash
npm run dist
```

生成结果在 `dist` 目录，可单独分发该 exe，无需安装 Node。

## 算法说明

与主程序 `src/main/services/licenseManager.ts` 一致：同一 `MASTER_SECRET`，相同签名与时间混淆算法，生成的码可直接在主程序中验证通过。
