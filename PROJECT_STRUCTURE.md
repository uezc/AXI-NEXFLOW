# NEXFLOW V2 项目结构说明

## 📁 目录结构

```
NEXFLOW/
├── src/
│   ├── main/                    # 主进程代码（Node.js 环境）
│   │   ├── index.ts            # Electron 主进程入口
│   │   └── services/           # API 请求服务层
│   │       ├── api.ts          # API 服务基类（使用 axios）
│   │       └── store.ts        # 本地存储服务（使用 electron-store）
│   │
│   ├── preload/                 # 预加载脚本（IPC 桥梁）
│   │   └── index.ts            # 暴露安全的 API 给渲染进程
│   │
│   └── renderer/                # React 前端界面（浏览器环境）
│       ├── index.html          # HTML 入口
│       ├── main.tsx            # React 应用入口
│       ├── App.tsx             # 主组件
│       ├── index.css           # 全局样式（Tailwind CSS）
│       └── vite-env.d.ts       # Vite 类型定义
│
├── package.json                 # 项目配置和依赖
├── tsconfig.json               # TypeScript 基础配置
├── tsconfig.main.json          # 主进程 TypeScript 配置
├── tsconfig.preload.json       # 预加载脚本 TypeScript 配置
├── tsconfig.node.json          # Node.js 环境 TypeScript 配置
├── vite.config.ts              # Vite 构建配置（渲染进程）
├── tailwind.config.js          # Tailwind CSS 配置
├── postcss.config.js           # PostCSS 配置
├── .editorconfig               # 编辑器配置（UTF-8 无 BOM）
├── .gitignore                  # Git 忽略文件
└── README.md                   # 项目说明文档
```

## 🔧 核心依赖说明

### 运行时依赖
- **axios**: HTTP 客户端，在主进程中使用，避免跨域问题
- **electron-store**: 本地数据存储，用于保存 API Key 等配置
- **reactflow**: 流程图/节点编辑器组件
- **lucide-react**: 图标库
- **clsx**: 条件类名工具
- **tailwind-merge**: Tailwind CSS 类名合并工具

### 开发依赖
- **electron**: Electron 框架
- **vite**: 快速构建工具
- **typescript**: TypeScript 编译器
- **tailwindcss**: CSS 框架
- **concurrently**: 并发运行多个命令
- **cross-env**: 跨平台环境变量设置

## 🚀 开发流程

### 1. 安装依赖
```bash
npm install
```

### 2. 启动开发服务器
```bash
npm run electron:dev
```

这个命令会：
1. 编译主进程和预加载脚本（TypeScript → JavaScript）
2. 启动 Vite 开发服务器（渲染进程）
3. 等待服务器就绪后启动 Electron 应用

### 3. 构建生产版本
```bash
npm run build:all
```

## 📝 编码规范

- **所有文件必须使用 UTF-8 无 BOM 格式保存**
- 使用 2 个空格缩进
- 使用 LF 换行符
- 文件末尾保留空行

## 🏗️ 架构说明

### 主进程（src/main）
- 负责所有 Node.js API 调用
- 处理文件读写操作
- 管理窗口生命周期
- **所有 API 请求都在主进程发起**，避免跨域问题

### 预加载脚本（src/preload）
- 作为主进程和渲染进程之间的安全桥梁
- 通过 `contextBridge` 暴露受保护的 API
- 确保渲染进程无法直接访问 Node.js API

### 渲染进程（src/renderer）
- React 前端界面
- 通过 IPC 与主进程通信
- 使用 Tailwind CSS 进行样式设计

## 🔐 安全原则

1. **contextIsolation**: 启用上下文隔离
2. **nodeIntegration**: 禁用 Node.js 集成（渲染进程）
3. **所有 API 请求在主进程发起**，避免 CORS 问题
4. **敏感数据存储在 electron-store**，确保安全
