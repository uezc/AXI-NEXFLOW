# NEXFLOW V2 架构概览报告

## 📊 Current State: 当前数据流向图

### 数据流架构

```
用户输入/交互
    ↓
React Flow 节点组件 (MinimalistTextNode)
    ↓
节点内部状态 (useState: text, size)
    ↓
updateNodeData() → setNodes() (React Flow Hook)
    ↓
Workspace 组件状态 (useNodesState, useEdgesState)
    ↓
useEffect 监听 (500ms 防抖)
    ↓
IPC: saveProjectData(projectId, nodes, edges)
    ↓
主进程: electron-store
    ↓
本地持久化 (project-data-${projectId})
```

### 关键数据模型

#### 1. 节点数据结构 (Node.data)

**MinimalistTextNode:**
```typescript
interface MinimalistTextNodeData {
  text?: string;        // 文本内容
  width?: number;       // 节点宽度
  height?: number;      // 节点高度
  _isResizing?: boolean; // 内部状态标记（不持久化）
}
```

**CustomNode:**
```typescript
interface CustomNodeData {
  label: string;
  preview?: string;     // 预览图 URL
}
```

#### 2. 持久化存储结构

**electron-store 存储键:**
- `projects`: 项目列表
- `project-data-${projectId}`: 项目数据（节点和边）
  ```typescript
  {
    nodes: Node[],
    edges: Edge[],
    lastModified: number
  }
  ```

### 状态管理方式

**React Flow 状态管理:**
- ✅ 使用 `useNodesState` 和 `useEdgesState` (React Flow 内置 Hook)
- ✅ 状态提升到 `Workspace` 组件
- ❌ 未使用 Zustand/Redux（当前为简单 useState）

**数据更新机制:**
1. **节点内部更新**: `updateNodeData()` → `setNodes()` (React Flow)
2. **自动持久化**: `useEffect` 监听 `nodes/edges` 变化 → IPC 保存
3. **加载机制**: `useEffect` 监听 `projectId` 变化 → IPC 加载

---

## 🔌 Integration Points: AI API 接入建议

### 推荐架构: 分层服务模式

```
┌─────────────────────────────────────┐
│   React 渲染进程 (Renderer)          │
│  ┌───────────────────────────────┐  │
│  │  useAICore Hook (建议创建)     │  │
│  │  - 管理 AI 任务状态            │  │
│  │  - 触发 API 调用               │  │
│  │  - 更新节点数据                │  │
│  └───────────────────────────────┘  │
│              ↓ IPC                  │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   Electron 主进程 (Main)            │
│  ┌───────────────────────────────┐  │
│  │  AI Service Layer              │  │
│  │  - GeminiService               │  │
│  │  - NanoBananaProService        │  │
│  │  - Sora2Service                │  │
│  │  (继承 ApiService 基类)        │  │
│  └───────────────────────────────┘  │
│              ↓ HTTP                 │
└─────────────────────────────────────┘
              ↓
┌─────────────────────────────────────┐
│   外部 AI API                        │
│  - Google Gemini                    │
│  - Nano Banana Pro                  │
│  - Sora 2 (BLTCY)                   │
└─────────────────────────────────────┘
```

### 建议实现位置

#### 1. 创建 `useAICore` Hook (推荐)

**位置**: `src/renderer/hooks/useAICore.ts`

```typescript
interface UseAICoreOptions {
  nodeId: string;
  model: 'gemini' | 'nanobanana' | 'sora2';
  onProgress?: (progress: number) => void;
  onComplete?: (result: any) => void;
  onError?: (error: Error) => void;
}

export const useAICore = (options: UseAICoreOptions) => {
  const [status, setStatus] = useState<'idle' | 'processing' | 'completed' | 'error'>('idle');
  const [result, setResult] = useState<any>(null);
  
  const execute = useCallback(async (input: any) => {
    setStatus('processing');
    try {
      const response = await window.electronAPI.callAIModel({
        model: options.model,
        input,
        nodeId: options.nodeId,
      });
      setResult(response);
      setStatus('completed');
      options.onComplete?.(response);
    } catch (error) {
      setStatus('error');
      options.onError?.(error as Error);
    }
  }, [options]);
  
  return { status, result, execute };
};
```

#### 2. 创建 AI Service 层

**位置**: `src/main/services/ai/`

```
ai/
├── index.ts              # AI 服务统一入口
├── gemini.ts             # Gemini 服务
├── nanobanana.ts         # Nano Banana Pro 服务
└── sora2.ts              # Sora 2 服务
```

#### 3. 在节点组件中集成

**MinimalistTextNode 扩展示例:**
```typescript
// 添加 AI 执行按钮
const { status, execute } = useAICore({
  nodeId: id,
  model: 'gemini',
  onComplete: (result) => {
    updateNodeData({ 
      text: result.text,
      aiResult: result 
    });
  }
});
```

---

## 📐 Schema Suggestions: 节点数据扩展建议

### 最小化扩展方案

#### 方案 A: 类型联合 (推荐)

```typescript
// src/renderer/types/node.ts

// 基础节点数据
interface BaseNodeData {
  width?: number;
  height?: number;
  _isResizing?: boolean; // 内部状态，不持久化
}

// 文本节点
interface TextNodeData extends BaseNodeData {
  type: 'text';
  text?: string;
  aiModel?: 'gemini' | 'nanobanana' | null;
  aiStatus?: 'idle' | 'processing' | 'completed' | 'error';
  aiResult?: {
    text?: string;
    timestamp?: number;
  };
}

// 图像生成节点
interface ImageNodeData extends BaseNodeData {
  type: 'image';
  prompt?: string;
  aiModel?: 'nanobanana' | 'sora2' | null;
  aiStatus?: 'idle' | 'processing' | 'completed' | 'error';
  aiResult?: {
    imageUrl?: string;
    imagePath?: string; // 本地路径
    timestamp?: number;
  };
}

// 视频生成节点
interface VideoNodeData extends BaseNodeData {
  type: 'video';
  prompt?: string;
  referenceImage?: string; // 参考图片 URL/路径
  aiModel?: 'sora2' | null;
  aiStatus?: 'idle' | 'processing' | 'completed' | 'error';
  aiResult?: {
    videoUrl?: string;
    videoPath?: string; // 本地路径
    thumbnailUrl?: string;
    timestamp?: number;
  };
}

// 联合类型
type NodeData = TextNodeData | ImageNodeData | VideoNodeData;
```

#### 方案 B: 扁平化扩展 (更简单)

```typescript
interface MinimalistTextNodeData {
  // 现有字段
  text?: string;
  width?: number;
  height?: number;
  
  // AI 扩展字段（可选）
  nodeType?: 'text' | 'image' | 'video'; // 节点类型
  aiModel?: 'gemini' | 'nanobanana' | 'sora2' | null;
  aiStatus?: 'idle' | 'processing' | 'completed' | 'error';
  aiInput?: {
    prompt?: string;
    referenceImage?: string;
  };
  aiResult?: {
    text?: string;
    imageUrl?: string;
    imagePath?: string;
    videoUrl?: string;
    videoPath?: string;
    thumbnailUrl?: string;
    timestamp?: number;
  };
}
```

**推荐**: 使用方案 B（扁平化），向后兼容，易于迁移。

---

## 🔍 Safety Check: 安全检查结果

### ✅ 已修复问题

1. **nodeDragHandleClassName**: ✅ 已正确使用
   - 位置: `src/renderer/components/Canvas/FlowContent.tsx:121`
   - 状态: 正确，无警告

2. **非受控缩放同步**: ✅ 已全局覆盖
   - `MinimalistTextNode.tsx`: `onMouseUp` 中调用 `updateNodeInternals(id)`
   - `onMouseUp` 中调用 `handleSizeChange(finalSize)` 更新 React 状态
   - 状态: 完整实现

### ⚠️ 潜在问题

1. **类型安全**: 
   - 当前 `Node.data` 使用 `any` 类型
   - 建议: 创建统一的 `NodeData` 类型定义

2. **错误处理**:
   - AI API 调用失败时的错误处理需要完善
   - 建议: 在 `useAICore` 中添加重试机制

3. **性能优化**:
   - 大量节点时的自动保存可能影响性能
   - 建议: 考虑使用 Web Worker 或批量保存

---

## 🚀 实施建议

### Phase 1: 基础架构 (1-2 天)
1. 创建 `src/renderer/types/node.ts` 定义统一节点数据类型
2. 创建 `src/renderer/hooks/useAICore.ts` Hook
3. 在主进程中创建 `src/main/services/ai/` 目录结构

### Phase 2: API 集成 (2-3 天)
1. 实现 Gemini Service
2. 实现 Nano Banana Pro Service
3. 实现 Sora 2 Service
4. 添加 IPC 处理器

### Phase 3: UI 集成 (1-2 天)
1. 在节点组件中添加 AI 执行按钮
2. 添加进度指示器
3. 添加结果预览

### Phase 4: 测试与优化 (1 天)
1. 端到端测试
2. 错误处理完善
3. 性能优化

---

## 📝 总结

**当前架构优势:**
- ✅ 清晰的数据流向
- ✅ 自动持久化机制
- ✅ 良好的组件隔离

**需要改进:**
- ⚠️ 类型定义需要统一
- ⚠️ AI API 调用层需要创建
- ⚠️ 错误处理需要完善

**推荐下一步:**
1. 创建统一的节点数据类型定义
2. 实现 `useAICore` Hook
3. 在主进程中创建 AI Service 层
