# NEXFLOW 项目记忆（供 AI 恢复上下文）

本文档用于在新对话中恢复「之前 AI 已知道的 NEXFLOW 软件设定与架构」，便于继续开发时保持记忆一致。

## 如何使用

- 在新开 Cursor Agent 对话时，可 **@ 引用本文件** 或 **@chat_history_export** 下的导出文件，让 AI 加载项目背景。
- 项目内已有规则时，Cursor 会自动参考 `.cursor/rules`；本文件可作为补充的「项目设定摘要」。

## 项目是什么

- **NEXFLOW V2**：基于 Electron + Vite + React 的 **AI 工作流平台**，画布为 React Flow，节点类型包括文本、图片、视频、音频、LLM 等。
- **数据流**：前端 React 只负责 UI 与交互，所有 API/联网由 **Electron 主进程** 通过 IPC 直连（无跨域 fetch）。
- **持久化**：画布节点/边用 **electron-store** 按项目 ID 存储（`project-data-${projectId}`），含节点位置、大小、内容等；**画布内容需实时保存**（文字、图片、视频、模块大小位置）。

## 关键设定与约定（此前对话中已确立）

- **架构**：详见 `ARCHITECTURE_OVERVIEW.md`（数据流、节点数据模型、electron-store 键、AI 接入建议、节点类型扩展等）。
- **产品方向与阶段**：详见 `NEXFLOW设计蓝图.txt`（直连架构、配置驱动节点工厂、双平台 BLTCY/RunningHub、草稿与工程打包等）。
- **技术栈**：主进程 TypeScript、渲染进程 React + React Flow、Vite 构建、Tailwind；AI 相关在主进程 `src/main/ai/` 及渲染层 `useAI` 等。

## 历史对话导出位置

- **聊天记录导出目录**：`chat_history_export/`
  - `nexflow_chat_*.md`：工作区内所有 Composer 会话的元数据与标题。
  - `nexflow_composer_data_raw.json`：完整 `composer.composerData` 原始 JSON（含 allComposers 等）。
  - `nexflow_conversations_*.md`：从 Cursor 全局库导出的部分对话正文（如「归档项目访问问题」等）。
- **重要历史会话**（从元数据可知）：
  - **「画布里面的内容实时保存，包括内容文字图片视频，模块的大小位置。」** — 该会话中曾大量改动（约 26089 行添加、77 个文件），对应此前 AI 对画布持久化与节点设计的深入设定；其对话正文若需从本地恢复，可参考上述导出或 Cursor 的 `workspaceStorage` / 全局 `cursorDiskKV`。

## 后续对话中如何「继续保持记忆」

1. **优先阅读**：`ARCHITECTURE_OVERVIEW.md`、`NEXFLOW设计蓝图.txt`。
2. **需要「之前聊过什么」时**：打开或 @ 引用 `chat_history_export/` 下最新导出的 `.md` / `nexflow_composer_data_raw.json`。
3. **做新功能或改架构时**：先对齐上述文档与导出中的结论，再在对话中说明当前目标，即可在「已知设定」基础上继续。

---

*本文件由 Cursor 聊天导出脚本与项目文档自动整理，便于在新会话中恢复 NEXFLOW 的项目记忆。*
