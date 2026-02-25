/**
 * 节点连线兼容规则：谁可以连到谁
 * - 用于拖线创建菜单过滤（不显示不兼容的模块）
 * - 用于 isValidConnection（禁止连到不兼容节点 + 红色节点框）
 */

/** 菜单/创建用类型与节点 type 的对应 */
export const MENU_TYPE_TO_NODE_TYPE: Record<string, string> = {
  text: 'minimalistText',
  llm: 'llm',
  textSplit: 'textSplit',
  image: 'image',
  video: 'video',
  character: 'character',
  audio: 'audio',
  cameraControl: 'cameraControl',
};

export const NODE_TYPE_TO_MENU_TYPE: Record<string, string> = {
  minimalistText: 'text',
  llm: 'llm',
  textSplit: 'textSplit',
  image: 'image',
  video: 'video',
  character: 'character',
  audio: 'audio',
  cameraControl: 'cameraControl',
};

/** 从源节点类型看：不能作为“新建目标”的菜单类型（拖线创建菜单中要隐藏） */
const FORBIDDEN_TARGET_MENU_TYPES_BY_SOURCE: Record<string, string[]> = {
  text: ['text', 'character', 'cameraControl'], // text 不能接入 text
  minimalistText: ['text', 'character', 'cameraControl'],
  llm: ['text', 'character', 'cameraControl'],
  textSplit: ['text', 'character', 'cameraControl'],
  image: ['text', 'textSplit', 'character', 'audio'],
  video: ['text', 'image', 'llm', 'textSplit', 'audio', 'cameraControl'], // video 不能接入 llm、文本拆分、声音
  character: ['text', 'llm', 'textSplit', 'image', 'video', 'character', 'audio', 'cameraControl'], // 角色无输出节点，拖出时不展示任何创建项
  audio: ['text', 'llm', 'textSplit', 'image', 'character', 'cameraControl'],
  cameraControl: ['text', 'llm', 'textSplit', 'video', 'character', 'audio', 'cameraControl'], // 3D 只能接入图片，不能接入 3D
};

/** 从源节点类型看：不能连到的目标节点 type（用于 isValidConnection） */
const FORBIDDEN_TARGET_NODE_TYPES_BY_SOURCE: Record<string, string[]> = {
  minimalistText: ['minimalistText', 'character', 'cameraControl'], // text 不能接入 text
  text: ['minimalistText', 'character', 'cameraControl'],
  llm: ['minimalistText', 'character', 'cameraControl'],
  textSplit: ['minimalistText', 'character', 'cameraControl'],
  image: ['minimalistText', 'textSplit', 'character', 'audio'],
  video: ['minimalistText', 'image', 'llm', 'textSplit', 'audio', 'cameraControl'], // video 不能接入 llm、文本拆分、声音
  character: ['minimalistText', 'llm', 'textSplit', 'image', 'video', 'character', 'audio', 'cameraControl'], // 角色无输出
  audio: ['minimalistText', 'llm', 'textSplit', 'image', 'character', 'cameraControl'],
  cameraControl: ['minimalistText', 'llm', 'textSplit', 'video', 'character', 'audio', 'cameraControl'], // 3D 不能接入 3D
};

/** 角色节点：已去除输出节点，不允许从角色连出 */
const CHARACTER_OUTPUT_ALLOWED_TARGETS: string[] = [];

/** 3D 视角控制器：输出只能连到 image */
const CAMERA_CONTROL_OUTPUT_ALLOWED_TARGETS = ['image'];

const ALL_MENU_TYPES = ['text', 'llm', 'textSplit', 'image', 'video', 'character', 'audio', 'cameraControl'];

/**
 * 拖线创建菜单：根据源节点 type 返回禁止出现的菜单类型（菜单项中要隐藏）
 */
export function getForbiddenMenuTypesBySourceNodeType(sourceNodeType: string): string[] {
  const normalized = sourceNodeType === 'minimalistText' ? 'text' : sourceNodeType;
  return FORBIDDEN_TARGET_MENU_TYPES_BY_SOURCE[normalized] ?? [];
}

/**
 * 拖线创建菜单：根据源节点 type 返回允许创建的菜单类型；null 表示全部展示
 */
export function getAllowedMenuTypes(sourceNodeType: string | null): string[] | undefined {
  if (sourceNodeType == null) return undefined;
  const forbidden = getForbiddenMenuTypesBySourceNodeType(sourceNodeType);
  return ALL_MENU_TYPES.filter((t) => !forbidden.includes(t));
}

/** 角色节点：只能由 video 作为输入 */
const CHARACTER_INPUT_ALLOWED_SOURCES = ['video'];

/**
 * 判断从 source 连到 target 是否允许（用于 isValidConnection）
 */
export function isConnectionAllowed(
  sourceNodeType: string,
  targetNodeType: string,
  _sourceHandleId?: string | null,
  _targetHandleId?: string | null
): boolean {
  const src = sourceNodeType === 'minimalistText' ? 'minimalistText' : sourceNodeType;
  const tgt = targetNodeType;

  // 角色节点：只能输入来自 video；已去除输出节点，不能连到任何目标
  if (tgt === 'character') {
    return CHARACTER_INPUT_ALLOWED_SOURCES.includes(src);
  }
  if (src === 'character') {
    return CHARACTER_OUTPUT_ALLOWED_TARGETS.length > 0 && CHARACTER_OUTPUT_ALLOWED_TARGETS.includes(tgt);
  }
  // 3D 视角控制器：输出只能连到 image
  if (src === 'cameraControl') {
    return CAMERA_CONTROL_OUTPUT_ALLOWED_TARGETS.includes(tgt);
  }

  const forbidden = FORBIDDEN_TARGET_NODE_TYPES_BY_SOURCE[src];
  if (!forbidden) return true;
  return !forbidden.includes(tgt);
}
