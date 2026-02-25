# NEXFLOW 安装包构建说明

## Windows 一键安装包（当前）

- **输出**：`release/` 目录下生成 NSIS 安装程序（如 `NEXFLOW Setup 2.0.0.exe`）
- **安装方式**：一键安装，默认当前用户、创建桌面与开始菜单快捷方式
- **首次运行**：草稿（任务列表、项目列表）不保留；提示词（全局 LLM 人设）保留；API Key 需用户在设置中手动填写

### 构建命令

```bash
npm run electron:build
```

将依次执行：`build:all`（主进程 + preload + 前端）→ `electron-builder`。完成后在 `release/` 下得到 Windows 安装包。

### 可选：自定义图标

在项目根目录创建 `build/icon.ico`（256×256 或含多尺寸的 ICO），并在 `package.json` 的 `build.win` 中增加：

```json
"icon": "build/icon.ico"
```

---

## 其他系统安装包（后期）

当前已在 `package.json` 的 `build` 中预留配置，后续可按需执行：

| 系统   | 命令（在对应系统上执行）     | 目标格式 |
|--------|------------------------------|----------|
| macOS  | `npm run electron:build -- --mac`   | DMG      |
| Linux  | `npm run electron:build -- --linux` | AppImage |

- **macOS**：需在 Mac 上构建；`build.mac` 已配置 `dmg` 与 category
- **Linux**：可在 Linux 或 WSL 中构建；`build.linux` 已配置 `AppImage`

首次运行逻辑（草稿不保留、提示词保留）在所有平台一致。
