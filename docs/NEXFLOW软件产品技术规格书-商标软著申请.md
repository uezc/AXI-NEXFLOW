# NEXFLOW 软件产品技术规格书

**版本：** 2.0  
**用途：** 商标注册及计算机软件著作权申请  
**编制日期：** 2025 年

---

## 一、产品概述

NEXFLOW 是一款面向 AI 图像/视频生成领域的可视化工作流编排平台。该软件通过节点化、连线式的交互方式，将图像生成、视频生成、大语言模型（LLM）、音频处理等 AI 能力有机整合，并独创性地提供基于 WebGL 的 3D 交互视角控制器，实现将用户的空间操作实时转化为符合摄影语义的提示词（Prompt），为多机位、多角度、参数化的 AI 内容生成提供标准化控制能力。

---

## 二、核心功能描述

### 2.1 基于 WebGL 的 3D 交互视角控制器

NEXFLOW 的核心创新功能为**3D 视角控制器**，其技术特点如下：

- **3D 可视化交互：** 采用 Three.js 构建 3D 立方体场景，将用户输入的参考图片作为纹理贴图映射到立方体表面，用户可通过鼠标拖拽、滚轮缩放等方式在三维空间中直观调节观察视角。
- **空间坐标系映射：** 控制器内部维护统一的相机参数体系，包括水平旋转角（Yaw）、垂直俯仰角（Pitch）、相机距离（Scale）及视场角（FOV），所有交互操作实时映射为上述参数的数值变化。
- **实时语义化输出：** 控制器将 3D 坐标和空间参数实时转化为摄影行业通用的语义化描述，输出多种格式的提示词，供下游 AI 图像/视频生成节点消费。

### 2.2 3D 坐标到摄影语义提示词的实时转化

系统内置**参数-语义映射引擎**，实现从空间参数到自然语言指令的无损转换，主要输出包括：

| 参数维度 | 语义映射规则 | 输出示例 |
|---------|-------------|---------|
| 水平方位 | \|Yaw\|≤10° 正面，10°<\|Yaw\|≤45° 斜侧面，\|\|Yaw\|>45° 侧面 | front view / three-quarter view / side view |
| 垂直高度 | Pitch>15° 俯视，Pitch<-15° 仰视，其他 平视 | high angle shot / low angle shot / eye-level shot |
| 景别距离 | Scale 小=推近=特写，Scale 大=推远=全景 | close-up shot / medium shot / wide shot |

输出格式支持：

- **标签式（view_tags）：** 如 `front view, eye-level shot`
- **组合式（formatted_output）：** 如 `front view, eye-level shot, medium shot`
- **自然语言指令（qwen_instruction）：** 面向 Qwen-Multiangle 等多角度 LoRA 模型，如 `Rotate the camera 45 degrees to the left. Eye-level shot. Turn the camera to a close-up.`

上述输出通过 `prompt_payload` 协议统一封装，经节点连线自动传递给下游 Image、Video 等 AI 生成节点，实现“所见即所得”的镜头语言控制。

---

## 三、技术架构

### 3.1 技术栈

| 层级 | 技术选型 | 说明 |
|-----|---------|-----|
| 应用框架 | Electron | 跨平台桌面应用，主进程与渲染进程分离 |
| 前端框架 | React 18 | 组件化 UI，配合 React Router 实现路由 |
| 3D 渲染 | Three.js + React Three Fiber + Drei | WebGL 封装，声明式 3D 组件集成 |
| 流程编排 | ReactFlow | 节点-边图编辑，支持拖拽、连线、缩放 |
| 构建工具 | Vite + TypeScript | 模块打包与类型安全 |

### 3.2 React + Three.js 集成方案

- **React Three Fiber（R3F）：** 将 Three.js 场景以 React 组件形式组织，3D 视角控制器封装为 `CubeCameraController` 组件，内部使用 `Canvas`、`OrbitControls`、`useThree` 等 R3F API 管理相机与场景。
- **状态同步：** 用户交互产生的相机参数通过 `onChange` 回调上报至父节点 `CameraControlNode`，由 `getPhotographyPrompt()` 引擎计算语义化输出并更新节点数据。
- **纹理加载与优化：** 支持 `local-resource://`、`file://`、`http(s)://` 等多种图片来源，对超限纹理进行下采样（如最大边长 1024px），降低显存压力，保障渲染进程稳定。

### 3.3 “按需渲染”与“数据解耦”的流畅度优化策略

- **按需渲染（On-Demand Rendering）：**
  - 3D 场景采用 `requestAnimationFrame` 驱动的 `invalidate()` 机制，仅在相机或场景发生变化时触发重绘。
  - 拖拽/缩放过程中启用阻尼（damping）与节流，将参数更新频率控制在约 60fps，避免过度渲染。

- **数据解耦（Data Decoupling）：**
  - 节点数据与 3D 渲染状态分离，节点 `prompt_payload` 作为独立数据结构持久化，3D 控制器仅负责交互与参数采样。
  - 下游 Image/Video 节点通过 `prompt_payload.qwen_instruction`、`formatted_output` 等字段消费语义，与 3D 实现解耦，便于扩展其他语义协议。

- **性能模式：** 支持 `performanceMode`，在画布缩放或低性能设备上可切换为低分辨率 3D 预览，保证整体操作流畅。

---

## 四、应用领域

NEXFLOW 明确服务于以下领域：

1. **AI 图像生成：** 为 Stable Diffusion、DALL·E、Midjourney 等模型的提示词提供参数化的镜头语言控制，支持多机位、多角度的角色与场景生成。
2. **AI 视频生成：** 通过 3D 视角控制器输出的语义提示词，驱动视频生成模型实现镜头推拉、角度变换、景别切换等专业摄影效果。
3. **工作流编排：** 将 LLM、图像、视频、音频等节点以可视化方式连接，形成从创意输入到多模态输出的完整管线。
4. **参数化创作：** 为设计师、内容创作者提供“可视化调节 + 语义化输出”的标准化工具，降低 AI 生成场景下的提示词编写门槛。

---

## 五、创新点

### 5.1 视角语义化输出（Perspective Semantic Output）

NEXFLOW 独创**视角语义化输出**能力，其核心逻辑参考并扩展了 Qwen-Multiangle-Camera 等多角度生成模型的设计思路：

- **参数到语义的确定性映射：** 将 3D 空间参数（旋转、距离、俯仰）通过规则引擎映射为摄影术语，输出格式与 Qwen-Edit、dx8152 LoRA 等模型兼容。
- **多协议输出：** 同时输出 `view_tags`、`formatted_output`、`qwen_instruction` 及 `QwenCameraAPI` 参数，满足不同下游模型的接口要求。
- **实时反馈：** 用户调节 3D 视角时，语义提示词即时更新并同步至连线节点，无需手工编写或复制粘贴。

### 5.2 与现有方案的差异

| 对比项 | 传统方式 | NEXFLOW |
|-------|---------|---------|
| 视角控制 | 手写英文提示词，易出错 | 3D 可视化拖拽，自动生成语义 |
| 多机位生成 | 逐条修改提示词 | 一键切换预设（正面/右45°/仰拍等），批量生成 |
| 语义一致性 | 依赖人工经验 | 规则引擎保证术语统一、格式规范 |
| 工作流集成 | 单一工具 | 与图像/视频/LLM 节点无缝连线，端到端编排 |

### 5.3 技术独创性总结

- 将 **WebGL 3D 交互** 与 **AI 提示词语义化** 深度融合，形成“空间操作 → 语义输出”的闭环。
- 采用 **Qwen-Multiangle 逻辑** 的语义映射规范，兼容业界多角度生成模型，具备良好的扩展性。
- 在 React + Electron 架构下实现 **按需渲染** 与 **数据解耦**，保障复杂工作流下的流畅交互体验。

---

## 六、运行环境

- **操作系统：** Windows 10/11（64 位）、macOS、Linux
- **运行环境：** Electron 28+，内置 Chromium 渲染引擎
- **硬件建议：** 4GB 及以上内存，支持 WebGL 的显卡（可选软件光栅化降级）

---

## 七、文档说明

本技术规格书用于 NEXFLOW 软件的商标注册及计算机软件著作权申请，所述功能与技术架构均基于当前产品实现，如有版本更新，以实际发布版本为准。

---

**NEXFLOW 开发团队**  
*2025 年*
