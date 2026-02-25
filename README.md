# NEXFLOW V2

AI Workflow Platform built with Electron + Vite + React + TypeScript

## 技术栈

- **Electron**: 跨平台桌面应用框架
- **Vite**: 快速的前端构建工具
- **React**: UI 框架
- **TypeScript**: 类型安全的 JavaScript
- **Tailwind CSS**: 实用优先的 CSS 框架

## 核心依赖

- `axios`: HTTP 客户端（主进程使用）
- `electron-store`: 本地数据存储
- `reactflow`: 流程图/节点编辑器
- `lucide-react`: 图标库
- `clsx`: 条件类名工具
- `tailwind-merge`: Tailwind 类名合并工具

## 项目结构

```
src/
├── main/              # 主进程代码
│   ├── services/      # API 请求服务
│   └── index.ts       # 主进程入口
├── preload/           # 预加载脚本（IPC 桥梁）
│   └── index.ts
└── renderer/          # React 前端界面
    ├── App.tsx
    ├── main.tsx
    ├── index.html
    └── index.css
```

## 开发

```bash
# 安装依赖
npm install

# 启动开发服务器
npm run electron:dev
```

## 构建

```bash
# 构建应用
npm run build
```

## 编码规范

所有文件必须使用 **UTF-8 无 BOM** 格式保存。

## 环境配置

### 阿里云 OSS 配置

项目使用阿里云 OSS 存储临时图片文件。请按以下步骤配置：

1. **复制配置模板**：
   ```bash
   cp .env.example .env
   ```

2. **编辑 `.env` 文件**，填入你的阿里云 OSS 配置：
   ```env
   OSS_ACCESS_KEY_ID=your_access_key_id_here
   OSS_ACCESS_KEY_SECRET=your_access_key_secret_here
   OSS_REGION=oss-cn-hongkong
   OSS_BUCKET=nexflow-temp-images
   ```

3. **注意事项**：
   - `.env` 文件已添加到 `.gitignore`，不会被提交到版本控制
   - 如果未配置 `.env` 文件，程序会尝试从应用设置中读取（如果已配置）
   - 如果两者都未配置，OSS 上传功能将无法使用。
