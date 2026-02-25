/* eslint-disable react/forbid-dom-props */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Save, Play, Trash2 } from 'lucide-react';
import { useAI } from '../../hooks/useAI';
import { getImageReversePrice } from '../../utils/priceCalc';

interface LLMInputPanelProps {
  nodeId: string;
  isDarkMode: boolean;
  inputText: string;
  userInput: string;
  // 当 true 且存在来自 Text 节点的连线时，底部"用户输入"框变为只读灰色，显示 Text 文本
  isInputLocked?: boolean;
  savedPrompts: Array<{
    id: string;
    name: string;
    content: string;
  }>;
  isImageReverseMode?: boolean;
  imageUrlForReverse?: string;
  /** 图像反推模型：gpt-4o | joy-caption-two */
  reverseCaptionModel?: 'gpt-4o' | 'joy-caption-two';
  onReverseCaptionModelChange?: (value: 'gpt-4o' | 'joy-caption-two') => void;
  projectId?: string;
  // 节点标题，用于资源保存
  nodeTitle?: string;
  onUserInputChange: (value: string) => void;
  onInputTextChange: (value: string) => void;
  onSavedPromptsChange: (prompts: Array<{ id: string; name: string; content: string }>) => void;
  onOutputTextChange: (text: string) => void;
  // 当选择的人设变化时，用于同步到 LLM 节点小标题
  onPersonaChange?: (personaName: string | null) => void;
}

/** LLM 快捷标签：点击可快速填入系统人设文案 */
const LLM_QUICK_TAGS: { label: string; content: string; color: string }[] = [
  {
    label: '剧本改写',
    color: 'bg-emerald-500/90 hover:bg-emerald-500 text-white border-emerald-400/50',
    content: `你是：
顶级导演 + 影视分镜师 + 叙事结构设计师 + SORA2 视频提示工程专家

你的唯一使命：
将用户输入的 小说片段 / 剧本 / 对话，自动拆解为【可直接用于 SORA2 文生视频】的专业级分镜稿。

你必须严格遵守以下全部规则执行，不得省略、不得解释。剧本中的对话不可省略。人物的外形穿着不用描述。

【用户可选参数】

用户在输入时可以选择：

视频片段时长 = 10 秒 / 15 秒（默认 15 秒）

你必须根据时长差异，自动调整镜头密度、运镜节奏与台词预留时间。

【镜头时长总控规则】

当用户选择 15 秒：

单镜头可容纳：

1 句中句台词（30～60 字）

或 2 句短句（≤30 字）

运镜允许完整展开（推进 / 拉远 / 过肩 / 环绕）

允许 1～2 秒情绪停留镜头（无台词）

总时长为15秒

当用户选择 10 秒：

单镜头原则：

1 句 = 1 镜头

运镜必须简化（推进或固定为主）

情绪停留 ≤0.5 秒

禁止同镜头内多次景别变化

总时长为10秒

【镜头数量计算规则（强制）】

① 基础镜头数
基础镜头 = 台词总字数 ÷ 40（向上取整）

② 按句强制拆镜头

每一句台词 = 至少 1 个镜头

45 字 = 必须独立镜头

80 字 = 拆为 2 个镜头（自然断点）

③ 最终镜头数
最终镜头数 = max（基础镜头数，按句镜头数）

【特殊台词长度处理】

≤30 字（短句）
→ 可与其他短句合并（仅限 15 秒模式）
→ 视频提示词中必须标明口型分段

30～60 字（中句）
→ 必须独立镜头

60 字（长句）
→ 拆为 2 个镜头

100 字（极长句）
→ 拆为 3 个镜头（强制）

所有台词：
不可修改、不可扩写、不可删减、不可重排
台词前必须用小括号标注说话人。

【镜头语言使用强制规则】

你必须根据台词功能，自动匹配镜头语言：

交代信息 → 中景 / 稳定镜头

情绪开始变化 → 近景 + 轻推

情绪明确 → 特写

决定 / 压迫 → 推镜特写

留白 / 结尾 → 拉远 / 全景

禁止无意义切镜。


【每个分镜固定输出结构（不可更改）】

分镜X
视频提示词：

【视频提示词生成规则】

每个视频提示词必须拆成 连续时间段（每段 2～2.5 秒），并包含：

镜头类型

运镜方式

人物动作（表情、呼吸、肢体）

光线特征

氛围

环境音

台词准确出现的时间点

示例结构（仅结构示例）：

0-2s：广角全景，建立环境……
2-4s：中景推进，人物进入画面……
4-6s：近景，人物开口说话（台词开始）
6-8s：特写，口型对应台词后半句……
8-10s：镜头轻推停留，呼吸声保留……

【场景拆解规则】

在生成任何镜头前，你必须先在脑中完成以下分析（不输出）：

时间

地点

光线来源

环境状态

人物站位与关系

并将其转化为可直接视觉生成的画面元素。

禁止抽象、不可视内容。


【人物一致性锁定规则】

同一角色：

外形

年龄

发型

服装

气质

在所有镜头中必须保持一致，不得变化。

【图片提示词规则（如需要）】

图片提示词只用于构图基准，必须包含：

具体场景位置

时间

光线来源

主体构图

景深

氛围

禁止使用抽象词（如“愤怒”“紧张”）。


【输出风格强制要求】

高度结构化、逻辑严谨、运镜连贯。
只输出用户要的镜头，不评价、不解释、不废话。
每个镜头的信息同行输出，不同镜头之间空一行，不要输出任何符号。

每个分镜头之间用"&&&"符号来分隔
每个分镜前，交代画风，场景信息
保持中文输出。
输出的内容必须符合Sora2和Nano banana2的内容规范。

案例：
分镜1
台词：中文
画风：仙侠CG动画
场景信息：
1. 妖域森林：幽暗、潮湿、发光植被、暴雨、泥泞、紫黑色调。
2. 木屋：简陋、温暖烛光、木质纹理、床榻、暧昧暖黄色调。
人物一致性设定：
1. 洛如缨（女主）：参考图1，白衣银饰，黑长直发，清冷高贵，衣衫带血污。
2. 宁夜辰（男主）：参考图4，黑袍，长发散落，剑眉星目，魔尊气质但目前伪装凡人。
3. 仙界使者1：参考图2，金甲壮汉，骑紫晶犀牛。
4. 仙界使者2：参考图3，银袍法师，骑金晶蝎。
视频提示词：
0-2s：低角度跟拍，暴雨夜，妖域森林地面泥泞，洛如缨（白衣）跌跌撞撞奔跑入画，衣摆破碎。
2-5s：近景侧拍，洛如缨面色苍白，嘴角带血，眼神涣散但坚定，雨水顺着脸颊滑落。
5-10s：特写镜头，洛如缨咬牙坚持，眼神痛苦，内心独白（洛如缨 os：该死……这淫毒已侵入心脉……再不尽快逼出恐怕……），无口型动作，仅表情抽搐。
10-15s：后拉镜头，洛如缨身形踉跄，前方荆棘密布，她强行提气加速。

&&&

分镜2
台词：中文
画风：仙侠CG动画
场景信息：
1. 妖域森林：幽暗、潮湿、发光植被、暴雨、泥泞、紫黑色调。
2. 木屋：简陋、温暖烛光、木质纹理、床榻、暧昧暖黄色调。
人物一致性设定：
1. 洛如缨（女主）：参考图1，白衣银饰，黑长直发，清冷高贵，衣衫带血污。
2. 宁夜辰（男主）：参考图4，黑袍，长发散落，剑眉星目，魔尊气质但目前伪装凡人。
3. 仙界使者1：参考图2，金甲壮汉，骑紫晶犀牛。
4. 仙界使者2：参考图3，银袍法师，骑金晶蝎。
视频提示词：
0-3s：广角追逐镜头，两名仙界使者骑着巨大的紫晶犀牛与金晶蝎撞破树木冲出。
3-8s：中景推进，金甲使者（使者1）一脸狰狞，挥舞兵器，开口说话（仙界使者 1：女帝，别白费力气了！这毒可是我用多种六阶妖兽的淫毒所制……）。
8-12s：镜头切换至洛如缨背部，一道金光在身旁炸开，泥土飞溅，洛如缨被气浪掀飞。
12-15s：特写金甲使者狂笑，口型继续对应台词（……除非与男子交合，否则半个时辰内必经脉爆裂而亡！）。`,
  },
  {
    label: '角色替换',
    color: 'bg-violet-500/90 hover:bg-violet-500 text-white border-violet-400/50',
    content: `系统人设：SORA2 分镜人名替换器

你的任务：
负责把用户输入的角色名，按照 @角色名 的格式，自动替换到分镜脚本中所有出现的角色位置。保持原文不变。

规则：

用户输入的角色名必须统一转为 @xxxx 格式

若用户输入：晨风
→ 输出中全部替换为：@redhoc.chenfeng（用户给出的映射）

若用户输入：A
→ 输出：@A

分镜中所有人物名称都必须统一替换为用户提供的角色名。

若脚本中存在多个角色，则根据用户提供的角色列表按顺序替换。

禁止额外添加角色，只能替换，不可扩写。

输出格式保持分镜风格不变，只对角色名做替换。

示例：

用户输入角色映射：

[晨风] → [@redhoc.chenfeng]

原分镜：

镜头1：晨风站在废墟中央，抬头看向天空。

替换后：

镜头1：@redhoc.chenfeng 站在废墟中央，抬头看向天空。`,
  },
  {
    label: '人物分析',
    color: 'bg-amber-500/90 hover:bg-amber-500 text-white border-amber-400/50',
    content: `分析剧中出现的人物，并且设计他的形象提示词，包括性别，身材，年龄，发型发色，穿着，配饰（例如：眼睛，戒指，项链，耳环，皮带，手表），每个人物单独一行。你是一个沉默的专家，只回复内容相关的内容，内容中不出现符号。

格式案例：
周一川：男性  中等偏瘦，略显单薄，肌肉线条不明显，稍显疲。26岁。黑色短发，贴着额头，因雨水显得凌乱。湿透的黄色外卖服，肩膀和背部有明显雨水痕迹，裤脚沾泥，运动鞋老旧但干净，未佩戴任何饰品，脸颊有刮胡血痕，双眼布满血丝但神情冷静，手上握着手机，手机屏幕有裂痕`,
  },
];

const LLMInputPanel: React.FC<LLMInputPanelProps> = ({
  nodeId,
  isDarkMode,
  inputText,
  userInput,
  isImageReverseMode,
  imageUrlForReverse,
  reverseCaptionModel = 'gpt-4o',
  onReverseCaptionModelChange,
  isInputLocked,
  savedPrompts,
  projectId,
  nodeTitle,
  onUserInputChange,
  onInputTextChange,
  onSavedPromptsChange,
  onOutputTextChange,
  onPersonaChange,
}) => {
  const userInputRef = useRef<HTMLTextAreaElement>(null);
  const promptInputRef = useRef<HTMLInputElement>(null);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [savePromptName, setSavePromptName] = useState('');
  const [showPersonaDropdown, setShowPersonaDropdown] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [personaToDelete, setPersonaToDelete] = useState<{ id: string; name: string } | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // 获取光标颜色样式（caretColor 必须通过内联样式设置，CSS 类无法实现）
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const getCaretColorStyle = useCallback(() => ({
    caretColor: isDarkMode ? '#0A84FF' : '#22c55e',
  }), [isDarkMode]);

  /** 将快捷标签内容填入系统人设（追加） */
  const appendQuickTagToPersona = useCallback((content: string) => {
    const sep = userInput.trim() ? '\n\n' : '';
    onUserInputChange(userInput + sep + content);
    userInputRef.current?.focus();
  }, [userInput, onUserInputChange]);

  // AI Hook
  const { status: aiStatus, execute: executeAI } = useAI({
    nodeId,
    modelId: 'chat',
    onStatusUpdate: (packet) => {
      // 调试日志：记录所有状态更新
      const hasPayload = !!packet.payload;
      const hasText = !!(packet.payload as any)?.text;
      const textLength = (packet.payload as any)?.text?.length || 0;
      const hasLocalPath = !!(packet.payload as any)?.localPath;
      const localPath = (packet.payload as any)?.localPath || 'none';
      const progress = (packet.payload as any)?.progress;
      
      console.log(`[LLMInputPanel] 收到状态更新: nodeId=${nodeId}, status=${packet.status}, hasPayload=${hasPayload}, hasText=${hasText}, textLength=${textLength}, hasLocalPath=${hasLocalPath}, localPath=${localPath}, progress=${progress}`);
      
      // START 和 PROCESSING 状态：确保进度条显示（通过 Workspace 的全局更新）
      // 这里不需要手动更新，因为 Workspace 会处理全局更新
      
      // 更新输出文本（仅在 SUCCESS 时）
      // 放弃路径依赖：有文本就先上文本，不再等待 localPath 读取
      if (packet.status === 'SUCCESS') {
        const text = (packet.payload as any)?.text;
        // 优先使用 text 字段，确保是字符串且已 trim
        const trimmedText = text ? String(text).trim() : '';
        if (trimmedText) {
          console.log(`[LLMInputPanel] SUCCESS 状态，text 长度: ${trimmedText.length}, 调用 onOutputTextChange（放弃路径依赖）`);
          onOutputTextChange(trimmedText);
        } else {
          // 如果没有 text，记录警告但不等待 localPath
          console.warn(`[LLMInputPanel] SUCCESS 状态但没有有效的 text 字段，payload keys:`, packet.payload ? Object.keys(packet.payload) : []);
          console.warn(`[LLMInputPanel] 放弃路径依赖：不再等待 localPath 读取`);
        }
      }
    },
    onComplete: (result) => {
      console.log(`[LLMInputPanel] 收到 onComplete 回调:`, {
        hasResult: !!result,
        hasText: !!result?.text,
        textLength: result?.text?.length || 0,
        hasLocalPath: !!result?.localPath,
        localPath: result?.localPath || 'none',
        keys: result ? Object.keys(result) : [],
      });
      
      // 放弃路径依赖：有文本就先上文本，不再等待 localPath 读取
      const text = result?.text;
      const trimmedText = text ? String(text).trim() : '';
      if (trimmedText) {
        console.log(`[LLMInputPanel] onComplete 调用 onOutputTextChange，text 长度: ${trimmedText.length}（放弃路径依赖）`);
        onOutputTextChange(trimmedText);
      } else {
        console.warn(`[LLMInputPanel] onComplete 回调但没有有效的 text 字段，result keys:`, result ? Object.keys(result) : []);
        console.warn(`[LLMInputPanel] 放弃路径依赖：不再等待 localPath 读取`);
      }
    },
  });

  // 保存人设提示词（userInput区域的内容）
  const handleSavePrompt = useCallback(() => {
    if (!userInput.trim()) return;
    setShowSaveDialog(true);
    setSavePromptName('');
  }, [userInput]);

  // 确认保存人设提示词
  const handleConfirmSave = useCallback(async () => {
    if (!savePromptName.trim() || !userInput.trim()) {
      return;
    }
    
    const newPrompt = {
      id: `prompt-${Date.now()}`,
      name: savePromptName.trim(),
      content: userInput.trim(),
    };
    
    // 保存到全局人设列表
    if (window.electronAPI) {
      try {
        await window.electronAPI.saveGlobalLLMPersona(newPrompt);
      } catch (error) {
        console.error('保存全局人设失败:', error);
      }
    }
    
    // 更新本地状态
    onSavedPromptsChange([...savedPrompts, newPrompt]);
    setShowSaveDialog(false);
    setSavePromptName('');
  }, [savePromptName, userInput, savedPrompts, onSavedPromptsChange]);

  // 取消保存
  const handleCancelSave = useCallback(() => {
    setShowSaveDialog(false);
    setSavePromptName('');
  }, []);

  // 加载提示词（加载到 userInput 区域）
  const handleLoadPrompt = useCallback((content: string) => {
    onUserInputChange(content);
    setShowPersonaDropdown(false);
  }, [onUserInputChange]);

  // 处理删除人设
  const handleDeletePersona = useCallback((e: React.MouseEvent, personaId: string, personaName: string) => {
    e.stopPropagation(); // 阻止下拉菜单关闭
    setPersonaToDelete({ id: personaId, name: personaName });
    setShowDeleteConfirm(true);
  }, []);

  // 确认删除人设
  const handleConfirmDelete = useCallback(async () => {
    if (!personaToDelete) return;

    try {
      if (window.electronAPI) {
        await window.electronAPI.deleteGlobalLLMPersona(personaToDelete.id);
      }
      
      // 更新本地状态
      const updatedPrompts = savedPrompts.filter((p) => p.id !== personaToDelete.id);
      onSavedPromptsChange(updatedPrompts);

      // 如果删除的是当前选中的人设，清空 userInput
      const currentSelectedId = savedPrompts.find((p) => p.content === userInput)?.id;
      if (currentSelectedId === personaToDelete.id) {
        onUserInputChange('');
        if (onPersonaChange) {
          onPersonaChange(null);
        }
      }

      setShowDeleteConfirm(false);
      setPersonaToDelete(null);
    } catch (error) {
      console.error('删除人设失败:', error);
    }
  }, [personaToDelete, savedPrompts, onSavedPromptsChange, userInput, onUserInputChange, onPersonaChange]);

  // 取消删除
  const handleCancelDelete = useCallback(() => {
    setShowDeleteConfirm(false);
    setPersonaToDelete(null);
  }, []);

  // 点击外部关闭下拉菜单
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPersonaDropdown(false);
      }
    };

    if (showPersonaDropdown) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => {
        document.removeEventListener('mousedown', handleClickOutside);
      };
    }
  }, [showPersonaDropdown]);


  // 执行 AI
  const handleExecuteAI = useCallback(async () => {
    // 图像反推模式：构造带 image_url 的消息
    if (isImageReverseMode && imageUrlForReverse) {
      const question = (userInput.trim() || '这张图片有什么？').trim();
      const model = reverseCaptionModel || 'gpt-4o';

      const messages: Array<{ role: 'user'; content: any }> = [
        {
          role: 'user',
          content: [
            { type: 'text', text: question },
            {
              type: 'image_url',
              image_url: {
                url: imageUrlForReverse,
              },
            },
          ],
        },
      ];

      try {
        await executeAI({
          model,
          messages,
          max_tokens: 400,
          stream: false,
          projectId: projectId,
          nodeTitle: nodeTitle || 'llm',
        });
      } catch (error) {
        console.error('AI 调用失败:', error);
      }
      return;
    }

    // 普通文本对话模式
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [];

    if (userInput.trim()) {
      messages.push({
        role: 'system',
        content: userInput.trim(),
      });
    }

    const finalUserInput = inputText.trim();
    if (finalUserInput) {
      messages.push({
        role: 'user',
        content: finalUserInput,
      });
    }

    if (messages.length === 0) {
      return;
    }

    try {
      await executeAI({
        model: 'gpt-3.5-turbo',
        messages,
        temperature: 0.7,
        max_tokens: 2000,
        stream: false,
        projectId: projectId, // 传递项目ID用于资源保存
        nodeTitle: nodeTitle || 'llm', // 传递节点标题用于资源保存
      });
    } catch (error) {
      console.error('AI 调用失败:', error);
    }
  }, [userInput, inputText, executeAI, isImageReverseMode, imageUrlForReverse, reverseCaptionModel, projectId, nodeTitle]);

  const hasUserContent =
    (isImageReverseMode ? !!imageUrlForReverse : false) ||
    userInput.trim().length > 0 ||
    inputText.trim().length > 0;
  // 处理运行中状态：除了 idle/SUCCESS/ERROR 之外的状态都视为运行中（包括 START / PROCESSING）
  // 按钮禁用逻辑：只基于当前模块自己的状态
  const isProcessing = aiStatus !== 'idle' && aiStatus !== 'SUCCESS' && aiStatus !== 'ERROR';
  const isRunDisabled =
    isProcessing || (!hasUserContent && !(isImageReverseMode && imageUrlForReverse));
  
  // 调试日志：确认每个模块的状态是独立的
  useEffect(() => {
    console.log(`[LLMInputPanel ${nodeId}] aiStatus: ${aiStatus}, isProcessing: ${isProcessing}, isRunDisabled: ${isRunDisabled}`);
  }, [nodeId, aiStatus, isProcessing, isRunDisabled]);

  return (
    <div 
      className={`${isDarkMode ? 'bg-[#1C1C1E]' : 'llm-panel-glass'} rounded-2xl border-2 border-green-500 p-3 transform transition-all duration-300 ease-out h-full flex flex-col overflow-hidden`}
    >
      {/* 顶部按钮栏：保存按钮+选择人设框（左侧），运行按钮（右侧） */}
      <div className={`flex items-center justify-between px-2 py-1.5 border-b flex-shrink-0 gap-2 ${isDarkMode ? 'border-gray-700/50' : 'border-gray-300/50'}`}>
        {/* 左侧：保存按钮 + 选择人设框 */}
        <div className="flex items-center gap-2 flex-1">
          <button
            onClick={handleSavePrompt}
            disabled={!userInput.trim()}
            className={`px-2 py-1 rounded-lg text-xs flex items-center gap-1 flex-shrink-0 ${
              !userInput.trim()
                ? 'opacity-50 cursor-not-allowed'
                : isDarkMode 
                  ? 'bg-green-500/20 text-green-400 hover:bg-green-500/30' 
                  : 'bg-green-500/10 text-green-600 hover:bg-green-500/20'
            } transition-colors`}
          >
            <Save className="w-3 h-3" />
            保存
          </button>
          {/* 选择人设下拉菜单（自定义） */}
          <div className="relative flex-1 min-w-0" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setShowPersonaDropdown(!showPersonaDropdown)}
              className={`w-full px-2 py-1 rounded-lg text-xs text-left flex items-center justify-between ${
                isDarkMode 
                  ? 'bg-black/30 text-white border border-gray-600/50' 
                  : 'bg-white/90 text-gray-900 border border-gray-300'
              } outline-none hover:opacity-80 transition-opacity`}
              title="选择人设"
            >
              <span className="truncate">
                {savedPrompts.find((p: { id: string; content: string }) => p.content === userInput)?.name || '选择人设'}
              </span>
              <span className={`ml-2 transition-transform ${showPersonaDropdown ? 'rotate-180' : ''}`}>▼</span>
            </button>
            
            {/* 下拉菜单列表 */}
            {showPersonaDropdown && (
              <div className="absolute top-full left-0 right-0 mt-1 rounded-lg border z-50 max-h-60 overflow-y-auto bg-[#1C1C1E] border-white/15 shadow-lg">
                <div
                  className="px-2 py-1.5 text-xs cursor-pointer hover:bg-opacity-50 hover:bg-white/10 text-white/60"
                  onClick={() => {
                    onUserInputChange('');
                    if (onPersonaChange) {
                      onPersonaChange(null);
                    }
                    setShowPersonaDropdown(false);
                  }}
                >
                  选择人设
                </div>
                {savedPrompts.map((saved: { id: string; name: string; content: string }) => {
                  const isSelected = saved.content === userInput;
                  return (
                    <div
                      key={saved.id}
                      className={`px-2 py-1.5 text-xs flex items-center justify-between group ${
                        isSelected ? 'bg-green-500/20 text-green-400' : 'hover:bg-white/10 text-white'
                      } cursor-pointer`}
                      onClick={() => {
                        handleLoadPrompt(saved.content);
                        if (onPersonaChange) {
                          onPersonaChange(saved.name);
                        }
                      }}
                    >
                      <span className="flex-1 truncate">{saved.name}</span>
                      <button
                        type="button"
                        onClick={(e) => handleDeletePersona(e, saved.id, saved.name)}
                        className="ml-2 p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/20 text-red-400"
                        title="删除人设"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
        {/* 图像反推模式下：反推模型选择 */}
        {isImageReverseMode && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <span className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>反推模型:</span>
            <select
              value={reverseCaptionModel}
              onChange={(e) => onReverseCaptionModelChange?.(e.target.value as 'gpt-4o' | 'joy-caption-two')}
              className={`px-2 py-1 rounded-lg text-xs ${
                isDarkMode ? 'bg-black/30 text-white border border-gray-600/50' : 'bg-white/90 text-gray-900 border border-gray-300'
              } outline-none`}
              title="选择图像反推模型"
            >
              <option value="gpt-4o">GPT 4o (可改人设提示词)</option>
              <option value="joy-caption-two">Joy Caption Two</option>
            </select>
          </div>
        )}
        {isImageReverseMode && (() => {
          const reversePrice = getImageReversePrice(reverseCaptionModel);
          return reversePrice !== null ? (
            <span
              className={`text-xs font-medium px-2 py-1 rounded flex-shrink-0 ${
                isDarkMode ? 'text-white/50 bg-white/10' : 'text-gray-500 bg-gray-100'
              }`}
              title="单次反推预估价格"
            >
              ¥{reversePrice.toFixed(4)}/次
            </span>
          ) : null;
        })()}
        {/* 右侧：运行按钮 */}
        <button
          onClick={handleExecuteAI}
          disabled={isRunDisabled}
          className={`px-3 py-1 rounded-lg text-xs flex items-center gap-1.5 flex-shrink-0 ${
            isRunDisabled
              ? 'bg-gray-500/50 text-white/50 cursor-not-allowed'
              : isProcessing
                ? 'bg-green-500 text-white'
                : 'bg-green-500 text-white hover:bg-green-600'
          } transition-colors`}
        >
          {isProcessing ? (
            <div className="w-3 h-3 border-2 border-white border-t-transparent rounded-full animate-spin" />
          ) : (
            <Play className="w-3 h-3" />
          )}
          {isImageReverseMode ? '图像反推' : '运行'}
        </button>
      </div>

      {/* 删除确认对话框 */}
      {showDeleteConfirm && personaToDelete && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 rounded-2xl">
          <div className={`${isDarkMode ? 'bg-[#1C1C1E]' : 'bg-white/90'} rounded-lg p-4 w-80 border-2 ${isDarkMode ? 'border-gray-600' : 'border-gray-300'}`}>
            <div className="mb-4">
              <h3 className={`text-sm font-medium mb-2 ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                确认删除
              </h3>
              <p className={`text-xs ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`}>
                确定要删除人设 "{personaToDelete.name}" 吗？此操作无法撤销。
              </p>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelDelete}
                className={`px-4 py-2 rounded-lg text-sm ${
                  isDarkMode 
                    ? 'bg-gray-700/50 text-white hover:bg-gray-700/70' 
                    : 'bg-gray-200 text-gray-900 hover:bg-gray-300'
                } transition-colors`}
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className={`px-4 py-2 rounded-lg text-sm ${
                  isDarkMode
                    ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30'
                    : 'bg-red-500 text-white hover:bg-red-600'
                } transition-colors`}
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 保存人设名称输入弹窗 */}
      {showSaveDialog && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-50 rounded-2xl">
          <div className="bg-[#1C1C1E] rounded-lg p-4 w-80 border-2 border-white/15">
            <div className="mb-4">
              <label className="block text-sm font-medium mb-2 text-white">
                输入人设名称
              </label>
              {/* eslint-disable-next-line react/forbid-dom-props */}
              <input
                type="text"
                value={savePromptName}
                onChange={(e) => setSavePromptName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handleConfirmSave();
                  } else if (e.key === 'Escape') {
                    handleCancelSave();
                  }
                }}
                className="w-full px-3 py-2 rounded-lg text-sm border bg-black/30 text-white border-white/15 focus:border-green-500 outline-none placeholder-white/40"
                placeholder="输入人设名称..."
                autoFocus
                style={getCaretColorStyle()}
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={handleCancelSave}
                className="px-4 py-2 rounded-lg text-sm bg-white/10 text-white hover:bg-white/15 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmSave}
                disabled={!savePromptName.trim()}
                className={`px-4 py-2 rounded-lg text-sm ${
                  !savePromptName.trim()
                    ? 'opacity-50 cursor-not-allowed bg-gray-500/50 text-white/50'
                    : 'bg-green-500 text-white hover:bg-green-600'
                } transition-colors`}
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 系统提示词输入区域 */}
      <div className="p-3 flex-1 min-h-0 flex flex-col">
        {/* 系统人设提示词标签 */}
        <div className="mb-2 flex-shrink-0">
          <label className={`text-xs font-medium ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
            系统人设提示词
          </label>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {LLM_QUICK_TAGS.map((tag) => (
              <button
                key={tag.label}
                type="button"
                onClick={() => appendQuickTagToPersona(tag.content)}
                className={`px-2 py-1 text-xs rounded border font-medium transition-colors ${tag.color}`}
                title={tag.label}
              >
                {tag.label}
              </button>
            ))}
          </div>
        </div>
        {/* 系统提示词输入框 */}
        {/* eslint-disable-next-line react/forbid-dom-props */}
        <textarea
          ref={userInputRef}
          value={userInput}
          onChange={(e) => onUserInputChange(e.target.value)}
          className={`w-full flex-1 custom-scrollbar bg-transparent resize-none outline-none text-sm rounded-lg p-2 border ${
            isDarkMode 
              ? 'text-white placeholder:text-white/40 border-gray-600/50' 
              : 'text-gray-900 placeholder:text-gray-500 border-gray-300/50'
          }`}
          placeholder={isImageReverseMode ? '这张图片有什么？' : '在这里输入系统人设提示词……'}
          title="系统人设提示词输入"
          style={getCaretColorStyle()}
        />
        {/* 底部用户输入框（可手动输入或由 Text 节点连线自动填充，图像反推模式下隐藏） */}
        <div className={`mt-2 flex-shrink-0 ${isImageReverseMode ? 'hidden' : ''}`}>
          <label className={`block text-xs font-medium mb-1 ${isDarkMode ? 'text-white/80' : 'text-gray-900'} flex items-center gap-2`}>
            <span>用户输入</span>
            {isImageReverseMode && (
              <span className={`px-2 py-0.5 rounded text-[11px] ${isDarkMode ? 'bg-purple-500/20 text-purple-200' : 'bg-purple-100 text-purple-700'}`}>
                【图片】
              </span>
            )}
          </label>
          {/* eslint-disable-next-line react/forbid-dom-props */}
          <input
            ref={promptInputRef}
            type="text"
            value={inputText || ''}
            onChange={(e) => {
              if (isInputLocked) return;
              onInputTextChange(e.target.value);
            }}
            className={`w-full px-2 py-1.5 rounded-lg text-xs ${
              isInputLocked
                ? isDarkMode
                  ? 'bg-black/40 text-white/70 border border-gray-700/70 cursor-not-allowed'
                  : 'bg-gray-100 text-gray-500 border border-gray-300 cursor-not-allowed'
                : isDarkMode 
                  ? 'bg-black/30 text-white placeholder:text-white/40 border border-gray-600/50' 
                  : 'bg-white/90 text-gray-900 placeholder:text-gray-500 border border-gray-300'
            } outline-none`}
            placeholder={isInputLocked ? '来自文本模块的提示词（已锁定）' : '输入用户提示词...'}
            disabled={!!isInputLocked}
            style={getCaretColorStyle()}
          />
        </div>
      </div>
    </div>
  );
};

export default LLMInputPanel;
