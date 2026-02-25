import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Handle, NodeProps, Position, useReactFlow, useStore } from 'reactflow';
import CubeCameraController, { CameraControlValue } from './CubeCameraController';

/** 摄影语义映射输出协议，供下游 AI 节点消费 */
export interface CameraPromptMetadata {
  view_tags: string;
  shot_type: string;
  formatted_output: string;
  /** dx8152 Qwen-Edit-2509-Multiple-angles LoRA 自然语言指令（中英双语） */
  qwen_instruction: string;
}

export interface CameraParams {
  rot_h: number;
  rot_v: number;
  dist: number;
  fov: number;
}

/** Qwen-Multiangle-Camera API 参数（Replicate/fal.ai 兼容） */
export interface QwenCameraAPI {
  rotate_degrees: number; // ±180°，正=左转
  move_forward: number; // 0-5，高=推近
  vertical_tilt: number; // -1~1，俯视~仰视
  use_wide_angle: boolean;
}

export interface CameraOutputPayload {
  camera_params: CameraParams;
  qwen_api: QwenCameraAPI;
  prompt_metadata: CameraPromptMetadata;
}

interface CameraControlNodeData {
  title?: string;
  rotationX?: number; // deg
  rotationY?: number; // deg
  scale?: number; // camera distance
  fov?: number;
  wideAngle?: boolean;
  cameraControl?: {
    rotationX: number;
    rotationY: number;
    scale: number;
    fov: number;
  };
  rot_h?: number;
  rot_v?: number;
  dist?: number;
  inputImage?: string;
  prompt_payload?: {
    camera_params?: CameraParams;
    qwen_api?: QwenCameraAPI;
    prompt_metadata?: CameraPromptMetadata;
    camera_tags?: string;
    composition_tags?: string;
    full_camera_prompt?: string;
    qwen_instruction?: string;
  };
}

interface CameraControlNodeProps extends NodeProps<CameraControlNodeData> {
  isDarkMode?: boolean;
  performanceMode?: boolean;
}

interface Local3DErrorBoundaryProps {
  onError: () => void;
  fallback: React.ReactNode;
  children: React.ReactNode;
}

interface Local3DErrorBoundaryState {
  hasError: boolean;
}

class Local3DErrorBoundary extends React.Component<Local3DErrorBoundaryProps, Local3DErrorBoundaryState> {
  constructor(props: Local3DErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): Local3DErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

const DEFAULT_VALUE: CameraControlValue = {
  rotationX: 15,
  rotationY: 35,
  scale: 3.4,
  fov: 45,
};

const MIN_SCALE = 1.2;
const MAX_SCALE = 6.5;

/** 景别三档对应的 scale 值：推近=特写，推远=全景 */
const SCALE_CLOSEUP = 1.5;   // 特写
const SCALE_MEDIUM = 3.5;    // 中景
const SCALE_WIDE = 5.5;      // 全景

/**
 * Qwen-Multiangle-Camera 参数-语义映射引擎
 * - 水平: |Yaw|≤10° front, 10°<|Yaw|≤45° three-quarter, 45°<|Yaw| side
 * - 垂直: Pitch>15° 俯拍, Pitch<-15° 仰拍
 * - 景别: scale 小=推近=特写, scale 大=推远=全景
 */
function getPhotographyPrompt(value: CameraControlValue): {
  payload: CameraOutputPayload;
  statusText: string;
  isKeyPose: boolean;
} {
  const rotH = Math.round(value.rotationY * 10) / 10;
  const rotV = Math.round(value.rotationX * 10) / 10;
  const dist = Math.round(value.scale * 100) / 100;
  const fov = Math.round(value.fov);
  const absYaw = Math.abs(rotH);

  // Qwen API 参数（无广角，移除 use_wide_angle）
  const moveForward = Number(((MAX_SCALE - value.scale) / (MAX_SCALE - MIN_SCALE) * 5).toFixed(2));
  const verticalTilt = Number((rotV / 45).toFixed(2));
  const qwenApi: QwenCameraAPI = {
    rotate_degrees: rotH,
    move_forward: Math.max(0, Math.min(5, moveForward)),
    vertical_tilt: Math.max(-1, Math.min(1, verticalTilt)),
    use_wide_angle: false,
  };

  // 水平方位
  let viewTag = 'front view';
  let viewLabel = '正面';
  if (absYaw <= 10) {
    viewTag = 'front view';
    viewLabel = '正面';
  } else if (absYaw <= 45) {
    viewTag = 'three-quarter view';
    viewLabel = rotH > 0 ? '右前 1/4' : '左前 1/4';
  } else {
    viewTag = 'side view';
    viewLabel = rotH > 0 ? '右侧' : '左侧';
  }

  // 垂直高度（rotV>0 相机在上方俯视=俯拍，rotV<0 相机在下方仰视=仰拍）
  let pitchTag = 'eye-level shot';
  let pitchLabel = '平视';
  if (rotV > 15) {
    pitchTag = 'high angle shot';
    pitchLabel = '俯拍';
  } else if (rotV < -15) {
    pitchTag = 'low angle shot';
    pitchLabel = '仰拍';
  }

  // 景别：scale 小=推近=特写，scale 大=推远=全景
  let shotType = 'medium shot';
  let shotLabel = '中景';
  if (dist <= 2.5) {
    shotType = 'close-up shot';
    shotLabel = '特写';
  } else if (dist > 4.5) {
    shotType = 'wide shot';
    shotLabel = '全景';
  }

  const viewTags = `${viewTag}, ${pitchTag}`;

  // dx8152 LoRA 自然语言指令（仅英文，供 AI 模型消费）
  const parts: string[] = [];
  if (Math.abs(rotH) >= 5) {
    parts.push(rotH > 0
      ? `Rotate the camera ${Math.round(Math.abs(rotH))} degrees to the left.`
      : `Rotate the camera ${Math.round(Math.abs(rotH))} degrees to the right.`);
  }
  if (rotV > 15) {
    parts.push("Turn the camera to a high-angle top-down view.");
  } else if (rotV < -15) {
    parts.push("Turn the camera to a low-angle view.");
  } else if (Math.abs(rotV) <= 5) {
    parts.push("Eye-level shot.");
  }
  if (dist <= 2.5) {
    parts.push("Turn the camera to a close-up.");
  } else if (dist > 4.5) {
    parts.push("Turn the camera to a wide shot.");
  }
  if (moveForward > 3.5) {
    parts.push("Move the camera forward.");
  } else if (moveForward < 1.5 && dist > 3) {
    parts.push("Move the camera backward.");
  }
  const qwenInstruction = parts.length > 0 ? parts.join(' ') : "Front view, eye-level, medium shot.";

  const formattedOutput = `${viewTags}, ${shotType}`;

  const cameraParams: CameraParams = { rot_h: rotH, rot_v: rotV, dist, fov };
  const promptMetadata: CameraPromptMetadata = {
    view_tags: viewTags,
    shot_type: shotType,
    formatted_output: formattedOutput,
    qwen_instruction: qwenInstruction,
  };

  const isKeyPose = absYaw <= 3 || Math.abs(absYaw - 45) <= 3 || Math.abs(rotV) <= 3;
  const statusText = `${viewLabel} · ${pitchLabel} · ${shotLabel}`;

  return {
    payload: {
      camera_params: cameraParams,
      qwen_api: qwenApi,
      prompt_metadata: promptMetadata,
    },
    statusText,
    isKeyPose,
  };
}

const NODE_WIDTH = 340;
const NODE_HEIGHT = 355;

/** 景别预设（与三档滑块一致） */
const QWEN_PRESETS: Array<{ label: string; value: Partial<CameraControlValue> }> = [
  { label: '正面', value: { rotationY: 0, rotationX: 0 } },
  { label: '右45°', value: { rotationY: 45, rotationX: 0 } },
  { label: '左45°', value: { rotationY: -45, rotationX: 0 } },
  { label: '仰拍', value: { rotationX: -30 } },
  { label: '俯拍', value: { rotationX: 30 } },
  { label: '特写', value: { scale: SCALE_CLOSEUP } },
  { label: '中景', value: { scale: SCALE_MEDIUM } },
  { label: '全景', value: { scale: SCALE_WIDE } },
];

export const CameraControlNode: React.FC<CameraControlNodeProps> = ({
  id,
  data,
  selected,
  isDarkMode = true,
  performanceMode = false,
  xPos = 0,
  yPos = 0,
}) => {
  const { setNodes } = useReactFlow();
  const transform = useStore((s) => s.transform);
  const zoom = transform?.[2] ?? 1;
  const vx = transform?.[0] ?? 0;
  const vy = transform?.[1] ?? 0;
  const scaleRef = useRef<HTMLInputElement>(null);
  const rotationYTextRef = useRef<HTMLSpanElement>(null);
  const rotationXTextRef = useRef<HTMLSpanElement>(null);
  const scaleTextRef = useRef<HTMLSpanElement>(null);
  const statusTextRef = useRef<HTMLDivElement>(null);
  const keyPoseRef = useRef(false);
  const invalidate3DRef = useRef<(() => void) | null>(null);
  const previewHostRef = useRef<HTMLDivElement>(null);
  const [previewHostWidth, setPreviewHostWidth] = useState(0);
  const [webglContextLost, setWebglContextLost] = useState(false);
  const [webglAvailable, setWebglAvailable] = useState<boolean | null>(null);

  const initial = useMemo<CameraControlValue>(() => {
    return {
      rotationX: data?.rotationX ?? DEFAULT_VALUE.rotationX,
      rotationY: data?.rotationY ?? DEFAULT_VALUE.rotationY,
      scale: data?.scale ?? DEFAULT_VALUE.scale,
      fov: data?.fov ?? (data?.wideAngle ? 85 : DEFAULT_VALUE.fov),
    };
  }, [data?.rotationX, data?.rotationY, data?.scale, data?.fov, data?.wideAngle]);

  const [controllerValue, setControllerValue] = useState<CameraControlValue>(initial);
  const currentValueRef = useRef<CameraControlValue>(initial);

  useEffect(() => {
    currentValueRef.current = initial;
    setControllerValue(initial);
  }, [initial]);

  const normalizeValue = useCallback((next: CameraControlValue): CameraControlValue => {
    return {
      rotationX: Math.max(-75, Math.min(75, next.rotationX)),
      rotationY: Math.max(-180, Math.min(180, next.rotationY)),
      scale: Math.max(1.2, Math.min(6.5, next.scale)),
      fov: Math.max(30, Math.min(95, next.fov)),
    };
  }, []);

  const scaleToStop = useCallback((s: number) => {
    const d0 = Math.abs(s - SCALE_CLOSEUP);
    const d1 = Math.abs(s - SCALE_MEDIUM);
    const d2 = Math.abs(s - SCALE_WIDE);
    if (d0 <= d1 && d0 <= d2) return 0;
    if (d1 <= d2) return 1;
    return 2;
  }, []);
  const stopToScale = useCallback((stop: number) => {
    if (stop <= 0) return SCALE_CLOSEUP;
    if (stop >= 2) return SCALE_WIDE;
    return SCALE_MEDIUM;
  }, []);
  const scaleToLabel = useCallback((s: number) => {
    const stop = scaleToStop(s);
    return stop === 0 ? '特写' : stop === 1 ? '中景' : '全景';
  }, [scaleToStop]);

  const syncSliderDom = useCallback((next: CameraControlValue) => {
    if (scaleRef.current) scaleRef.current.value = String(scaleToStop(next.scale));
    if (rotationYTextRef.current) rotationYTextRef.current.textContent = `${Math.round(next.rotationY)}deg`;
    if (rotationXTextRef.current) rotationXTextRef.current.textContent = `${Math.round(next.rotationX)}deg`;
    if (scaleTextRef.current) scaleTextRef.current.textContent = scaleToLabel(next.scale);
  }, [scaleToStop, scaleToLabel]);

  const syncPromptFeedback = useCallback((next: CameraControlValue) => {
    const result = getPhotographyPrompt(next);
    if (statusTextRef.current) {
      statusTextRef.current.textContent = `视角状态: ${result.statusText}`;
      statusTextRef.current.style.color = result.isKeyPose ? '#34d399' : '';
      if (result.isKeyPose && !keyPoseRef.current) {
        statusTextRef.current.animate(
          [{ opacity: 0.7, transform: 'translateY(1px)' }, { opacity: 1, transform: 'translateY(0)' }],
          { duration: 280, easing: 'ease-out' }
        );
      }
    }
    keyPoseRef.current = result.isKeyPose;
    return result.payload;
  }, []);

  useEffect(() => {
    syncSliderDom(currentValueRef.current);
    syncPromptFeedback(currentValueRef.current);
  }, [syncPromptFeedback, syncSliderDom, controllerValue]);

  useEffect(() => {
    const host = previewHostRef.current;
    if (!host) return;
    const updateWidth = () => {
      const rect = host.getBoundingClientRect();
      setPreviewHostWidth(rect.width || 0);
    };
    updateWidth();
    const observer = new ResizeObserver(updateWidth);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // 画布缩放时强制 3D 场景重绘，避免缩小后显示错位
  useEffect(() => {
    invalidate3DRef.current?.();
  }, [zoom]);

  const probeWebGL = useCallback(() => {
    try {
      const testCanvas = document.createElement('canvas');
      const gl =
        testCanvas.getContext('webgl2', { powerPreference: 'default', antialias: false }) ||
        testCanvas.getContext('webgl', { powerPreference: 'default', antialias: false });
      if (!gl) {
        setWebglAvailable(false);
        return;
      }
      const loseContext = (gl as WebGLRenderingContext).getExtension?.('WEBGL_lose_context');
      loseContext?.loseContext?.();
      setWebglAvailable(true);
    } catch {
      setWebglAvailable(false);
    }
  }, []);

  useEffect(() => {
    probeWebGL();
  }, [probeWebGL]);

  const persistNodeValue = useCallback(
    (next: CameraControlValue) => {
      const normalized = normalizeValue(next);
      currentValueRef.current = normalized;
      const { payload } = getPhotographyPrompt(normalized);
      const { camera_params, prompt_metadata } = payload;
      const promptPayload = {
        ...payload,
        camera_tags: prompt_metadata.view_tags,
        full_camera_prompt: prompt_metadata.formatted_output,
        qwen_instruction: prompt_metadata.qwen_instruction,
      };
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? {
                ...node,
                data: {
                  ...node.data,
                  title: (node.data as CameraControlNodeData)?.title ?? '3D视角控制器',
                  rotationX: normalized.rotationX,
                  rotationY: normalized.rotationY,
                  scale: normalized.scale,
                  fov: normalized.fov,
                  rot_h: camera_params.rot_h,
                  rot_v: camera_params.rot_v,
                  dist: camera_params.dist,
                  prompt_payload: promptPayload,
                  cameraControl: {
                    rotationX: normalized.rotationX,
                    rotationY: normalized.rotationY,
                    scale: normalized.scale,
                    fov: normalized.fov,
                  },
                },
              }
            : node
        )
      );
    },
    [id, normalizeValue, setNodes]
  );

  const updateLocalValue = useCallback(
    (next: CameraControlValue) => {
      const normalized = normalizeValue(next);
      currentValueRef.current = normalized;
      setControllerValue(normalized);
      syncSliderDom(normalized);
      syncPromptFeedback(normalized);
      invalidate3DRef.current?.();
    },
    [normalizeValue, syncPromptFeedback, syncSliderDom]
  );

  const isHardFrozen = useMemo(() => {
    if (!performanceMode) return false;
    const worldLeft = -vx / zoom;
    const worldTop = -vy / zoom;
    const worldRight = worldLeft + (typeof window !== 'undefined' ? window.innerWidth : 1920) / zoom;
    const worldBottom = worldTop + (typeof window !== 'undefined' ? window.innerHeight : 1080) / zoom;
    const marginX = ((worldRight - worldLeft) * 2) / Math.max(zoom, 0.0001);
    const marginY = ((worldBottom - worldTop) * 2) / Math.max(zoom, 0.0001);
    const right = xPos + NODE_WIDTH;
    const bottom = yPos + NODE_HEIGHT;
    return (
      right < worldLeft - marginX ||
      xPos > worldRight + marginX ||
      bottom < worldTop - marginY ||
      yPos > worldBottom + marginY
    );
  }, [performanceMode, vx, vy, zoom, xPos, yPos]);

  const displayTitle = data?.title === 'camera-control' ? '3D视角控制器' : (data?.title || '3D视角控制器');
  const inputImageUrl = typeof data?.inputImage === 'string' ? data.inputImage : '';
  const canMountThreeScene = !!inputImageUrl && previewHostWidth > 0 && webglAvailable === true && !webglContextLost;

  const handleReloadWebGL = useCallback(() => {
    setWebglContextLost(false);
    setWebglAvailable(true);
  }, []);

  const isWebGLError = webglContextLost || webglAvailable === false;
  const fallbackPanel = isWebGLError ? (
    <button
      type="button"
      className={`h-full w-full flex flex-col items-center justify-center gap-2 text-xs cursor-pointer border-0 ${
        isDarkMode ? 'bg-black/50 text-white/80 hover:bg-black/60' : 'bg-gray-300/80 text-gray-700 hover:bg-gray-400/80'
      }`}
      onClick={handleReloadWebGL}
    >
      <div>WebGL 上下文已丢失</div>
      <div className="text-[10px] opacity-80">点击重载</div>
    </button>
  ) : (
    <div
      className={`h-full w-full flex flex-col items-center justify-center gap-2 text-xs ${
        isDarkMode ? 'bg-black/35 text-white/65' : 'bg-gray-200/70 text-gray-600'
      }`}
    >
      3D 容器初始化中...
    </div>
  );

  return (
    <div
      className={`relative rounded-2xl overflow-visible p-2.5 ${
        isDarkMode
          ? 'apple-panel border border-white/12 text-white'
          : 'apple-panel-light border border-gray-300/40 text-gray-900'
      } ${selected ? 'ring-2 ring-green-400/80 border-green-400/70' : ''}`}
      style={{ width: NODE_WIDTH, height: NODE_HEIGHT, userSelect: 'auto' }}
    >
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'}`}
      />
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className={`w-3 h-3 bg-green-500 border-2 ${isDarkMode ? 'border-[#1C1C1E]' : 'border-[#FEFCF8]'}`}
      />

      <div className="title-area absolute -top-7 left-0 z-10">
        <span className={`font-bold text-xs select-none ${isDarkMode ? 'text-white/80' : 'text-gray-900'}`}>
          {displayTitle}
        </span>
      </div>

      <div
        ref={previewHostRef}
        className="relative w-full rounded-xl overflow-hidden nodrag nopan shrink-0"
        style={{
          height: 180,
          minHeight: 180,
          pointerEvents: 'auto',
          transformOrigin: 'center center',
        }}
      >
        {isHardFrozen ? (
          <div
            className={`h-full w-full flex items-center justify-center text-xs ${
              isDarkMode ? 'bg-black/40 text-white/45' : 'bg-gray-200/70 text-gray-500'
            }`}
          >
            3D预览已冻结（性能模式）
          </div>
        ) : canMountThreeScene ? (
          <Local3DErrorBoundary
            fallback={fallbackPanel}
            onError={() => {
              setWebglContextLost(true);
              setWebglAvailable(false);
            }}
          >
            <CubeCameraController
              value={controllerValue}
              inputImageUrl={inputImageUrl}
              isDarkMode={isDarkMode}
              onContextLost={() => {
                setWebglContextLost(true);
                setWebglAvailable(false);
              }}
              onChange={(next) => {
                const normalized = normalizeValue(next);
                currentValueRef.current = normalized;
                syncSliderDom(normalized);
                syncPromptFeedback(normalized);
              }}
              onChangeEnd={(next) => {
                const normalized = normalizeValue(next);
                currentValueRef.current = normalized;
                syncSliderDom(normalized);
                syncPromptFeedback(normalized);
                persistNodeValue(normalized);
              }}
              onInvalidateReady={(invalidate) => {
                invalidate3DRef.current = invalidate;
              }}
            />
          </Local3DErrorBoundary>
        ) : (
          !inputImageUrl ? (
            <div
              className={`h-full w-full flex flex-col items-center justify-center gap-2 text-xs ${
                isDarkMode ? 'bg-black/35 text-white/65' : 'bg-gray-200/70 text-gray-600'
              }`}
            >
              <div>请先连接图片节点输入</div>
            </div>
          ) : fallbackPanel
        )}
        <div
          ref={statusTextRef}
          className={`pointer-events-none absolute left-2 right-2 bottom-2 text-[11px] px-2 py-1 rounded ${
            isDarkMode ? 'bg-black/40 text-white/70' : 'bg-white/70 text-slate-700'
          }`}
        >
          正面 · 平视 · 中景
        </div>
      </div>

      <div className="mt-1 flex flex-wrap gap-1 text-[10px] nodrag nopan">
        {QWEN_PRESETS.map((preset) => (
          <button
            key={preset.label}
            type="button"
            className={`px-2 py-1 rounded-md transition-colors ${
              isDarkMode
                ? 'bg-white/10 hover:bg-white/20 text-white/90'
                : 'bg-black/8 hover:bg-black/15 text-slate-700'
            }`}
            onClick={() => {
              const next: CameraControlValue = {
                ...currentValueRef.current,
                ...preset.value,
              };
              const normalized = normalizeValue(next);
              updateLocalValue(normalized);
              persistNodeValue(normalized);
            }}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="mt-1 text-[11px]">
        <label className={`flex flex-col gap-1 ${isDarkMode ? 'text-white/80' : 'text-slate-700'}`}>
          <div className="flex items-center justify-between">
            <span>景别</span>
            <span ref={scaleTextRef}>{scaleToLabel(controllerValue.scale)}</span>
          </div>
          <input
            ref={scaleRef}
            type="range"
            min={0}
            max={2}
            step={1}
            defaultValue={scaleToStop(controllerValue.scale)}
            onChange={(e) => {
              const stop = Number(e.target.value);
              const scale = stopToScale(stop);
              updateLocalValue({ ...currentValueRef.current, scale });
            }}
            onPointerUp={() => persistNodeValue(currentValueRef.current)}
            onBlur={() => persistNodeValue(currentValueRef.current)}
            className="nodrag nopan accent-cyan-400 w-full"
          />
          <div className="flex justify-between text-[10px] opacity-70 mt-0.5">
            <span>特写</span>
            <span>中景</span>
            <span>全景</span>
          </div>
        </label>
      </div>
    </div>
  );
};

export default CameraControlNode;
