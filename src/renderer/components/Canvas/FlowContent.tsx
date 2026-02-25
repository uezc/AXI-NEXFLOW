import React, { useCallback, useMemo, useEffect, useRef, useState, memo } from 'react';
import ReactFlow, {
  Node,
  Edge,
  Connection,
  useNodesState,
  useEdgesState,
  NodeTypes,
  EdgeTypes,
  useReactFlow,
  SelectionMode,
  ReactFlowInstance,
  useStore,
  getNodesBounds,
  MiniMap,
  Panel,
  getBezierPath,
  Position,
  internalsSymbol,
  ConnectionLineType,
  useUpdateNodeInternals,
} from 'reactflow';
import { Maximize2 } from 'lucide-react';
import ContextMenu from './ContextMenu';
import BatchRunButton from './BatchRunButton';
import { getAllowedMenuTypes, isConnectionAllowed } from '../../utils/connectionRules';
import { ErrorBoundary } from '../ErrorBoundary';
import { getNodePrice } from '../../utils/priceCalc';
import AnimatedGradientEdge from './AnimatedGradientEdge';
import 'reactflow/dist/style.css';

/** 稳定大画布模式：画布逻辑边界固定，禁止随内容动态扩容，避免渲染进程崩溃 */
const MAX_CANVAS_SIZE = 8000;

/** 点阵背景：随画布 transform 同步位移与缩放，产生画布移动感；CSS 平铺，will-change 优化重绘 */
const DOT_GAP = 20;
const DOT_SIZE = 2;
/** 缩放滑块：独立订阅 zoom，避免 FlowContent 在缩放时全树重渲染导致卡顿 */
const ZoomSlider = memo(function ZoomSlider({ isDarkMode }: { isDarkMode: boolean }) {
  const zoom = useStore((s) => s.transform?.[2] ?? 1);
  const { getViewport, setViewport } = useReactFlow();
  const [sliderZoom, setSliderZoom] = useState(zoom);
  const rafRef = useRef<number | null>(null);
  useEffect(() => {
    setSliderZoom(zoom);
  }, [zoom]);
  useEffect(() => () => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
  }, []);
  const applyZoom = useCallback((v: number) => {
    const vp = getViewport();
    setViewport({ ...vp, zoom: v });
  }, [getViewport, setViewport]);
  const onSliderChange = useCallback((v: number) => {
    setSliderZoom(v);
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      applyZoom(v);
    });
  }, [applyZoom]);
  return (
    <div className="flex items-center gap-2" style={{ width: 160 }}>
      <span className={`text-xs flex-shrink-0 ${isDarkMode ? 'text-white/70' : 'text-gray-600'}`} title="画布缩放">
        {Math.round(sliderZoom * 100)}%
      </span>
      <input
        type="range"
        min={0.1}
        max={1}
        step={0.05}
        value={sliderZoom}
        onChange={(e) => onSliderChange(parseFloat(e.target.value))}
        className="flex-1 h-2 rounded-full appearance-none cursor-pointer accent-green-500 bg-white/20"
        title="拖动调节画布缩放"
      />
    </div>
  );
});

const FlowDotBackground = memo(function FlowDotBackground({ isDarkMode }: { isDarkMode: boolean }) {
  const transform = useStore((s) => s.transform);
  const x = transform?.[0] ?? 0;
  const y = transform?.[1] ?? 0;
  const zoom = transform?.[2] ?? 1;
  const baseFill = isDarkMode ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.1)';
  const glowFill = isDarkMode ? 'rgba(255,255,255,0.72)' : 'rgba(255,255,255,0.78)';
  const baseSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DOT_GAP}" height="${DOT_GAP}"><circle cx="${DOT_GAP / 2}" cy="${DOT_GAP / 2}" r="${DOT_SIZE / 2}" fill="${baseFill}"/></svg>`;
  const glowSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${DOT_GAP}" height="${DOT_GAP}"><circle cx="${DOT_GAP / 2}" cy="${DOT_GAP / 2}" r="${DOT_SIZE / 2}" fill="${glowFill}"/></svg>`;
  const baseDataUrl = `url("data:image/svg+xml,${encodeURIComponent(baseSvg)}")`;
  const glowDataUrl = `url("data:image/svg+xml,${encodeURIComponent(glowSvg)}")`;
  const size = DOT_GAP * zoom;
  return (
    <>
      <div
        className="react-flow__background"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: -1,
          pointerEvents: 'none',
          willChange: 'background-position, background-size',
          backgroundImage: baseDataUrl,
          backgroundRepeat: 'repeat',
          backgroundPosition: `${x}px ${y}px`,
          backgroundSize: `${size}px ${size}px`,
        }}
      />
      <div
        className="react-flow__background-dot-highlight"
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          zIndex: -1,
          pointerEvents: 'none',
          willChange: 'background-position, background-size, mask-image, -webkit-mask-image',
          backgroundImage: glowDataUrl,
          backgroundRepeat: 'repeat',
          backgroundPosition: `${x}px ${y}px`,
          backgroundSize: `${size}px ${size}px`,
          opacity: isDarkMode ? 0.82 : 0.76,
          WebkitMaskImage:
            'radial-gradient(circle 200px at var(--dot-mouse-x, -1000px) var(--dot-mouse-y, -1000px), rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.5) 38%, rgba(0,0,0,0.25) 72%, transparent 100%)',
          maskImage:
            'radial-gradient(circle 200px at var(--dot-mouse-x, -1000px) var(--dot-mouse-y, -1000px), rgba(0,0,0,0.72) 0%, rgba(0,0,0,0.5) 38%, rgba(0,0,0,0.25) 72%, transparent 100%)',
        }}
      />
    </>
  );
});

/** 从 store 的 nodeInternals 获取 handleBounds，计算精确的 Handle 中心 Flow 坐标 */
function getSourceHandleFlowPosition(
  nodeInternals: Map<string, Node>,
  sourceNodeId: string,
  sourceHandleId: string | null,
  handleType: 'source' | 'target'
): { x: number; y: number } | null {
  const node = nodeInternals.get(sourceNodeId);
  if (!node?.positionAbsolute) return null;
  const bounds = (node as Node & { [key: symbol]: { handleBounds?: { source?: Array<{ id?: string | null; x: number; y: number; width: number; height: number }>; target?: Array<{ id?: string | null; x: number; y: number; width: number; height: number }> } } })[internalsSymbol]?.handleBounds;
  if (!bounds) return null;
  const list = handleType === 'source' ? bounds.source : bounds.target;
  if (!list?.length) return null;
  const handle = sourceHandleId ? list.find((h) => h.id === sourceHandleId) : list[0];
  if (!handle) return null;
  const cx = node.positionAbsolute.x + handle.x + handle.width / 2;
  const cy = node.positionAbsolute.y + handle.y + handle.height / 2;
  return { x: cx, y: cy };
}

/** 无 handleBounds 时的回退：用节点宽高估算起点（右侧中点或 TextSplit 多输出） */
function getSourceHandleFlowPositionFallback(
  nodeInternals: Map<string, Node>,
  sourceNodeId: string,
  sourceHandleId: string | null,
  handleType: 'source' | 'target'
): { x: number; y: number } | null {
  const node = nodeInternals.get(sourceNodeId);
  if (!node) return null;
  const pos = node.positionAbsolute ?? node.position;
  const w = Number((node as Node).data?.width ?? 200);
  const h = Number((node as Node).data?.height ?? 200);
  let sourceY = pos.y + h / 2;
  if (node.type === 'textSplit' && sourceHandleId && sourceHandleId.startsWith('output-')) {
    if (sourceHandleId === 'output-null') {
      sourceY = pos.y + h / 2;
    } else {
      const idx = Number(sourceHandleId.replace('output-', ''));
      if (Number.isFinite(idx) && idx >= 0) {
        const outputBaseTop = 72;
        const perHandle = 28;
        sourceY = pos.y + outputBaseTop + idx * perHandle + perHandle / 2;
      }
    }
  }
  return { x: pos.x + w, y: sourceY };
}

/** 自定义 ConnectionLine：拖拽时用 handleBounds 精确计算起点，修正偏移 */
const CustomConnectionLine = memo(function CustomConnectionLine({
  fromNode,
  fromHandle,
  fromX,
  fromY,
  toX,
  toY,
  fromPosition,
  toPosition,
  connectionLineType,
  connectionLineStyle,
}: {
  fromNode?: Node;
  fromHandle?: { id?: string | null; x: number; y: number; width: number; height: number; position?: Position };
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  fromPosition: Position;
  toPosition: Position;
  connectionLineType: ConnectionLineType;
  connectionLineStyle?: React.CSSProperties;
}) {
  const nodeInternals = useStore((s) => s.nodeInternals);
  const connectionHandleId = useStore((s) => s.connectionHandleId);
  const connectionHandleType = useStore((s) => s.connectionHandleType);
  const handleType = connectionHandleType === 'target' ? 'target' : 'source';
  const recalc = fromNode
    ? (getSourceHandleFlowPosition(nodeInternals, fromNode.id, connectionHandleId ?? fromHandle?.id ?? null, handleType)
        ?? getSourceHandleFlowPositionFallback(nodeInternals, fromNode.id, connectionHandleId ?? fromHandle?.id ?? null, handleType))
    : null;
  const sx = recalc?.x ?? fromX;
  const sy = recalc?.y ?? fromY;
  const [path] = getBezierPath({
    sourceX: sx,
    sourceY: sy,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    curvature: 0.25,
  });
  return <path d={path} fill="none" className="react-flow__connection-path" style={connectionLineStyle} />;
});

const PendingConnectionLine = memo(function PendingConnectionLine({
  connectFrom,
  flowX,
  flowY,
  isDarkMode,
}: {
  connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null };
  flowX?: number;
  flowY?: number;
  isDarkMode: boolean;
}) {
  const nodeInternals = useStore((s) => s.nodeInternals);
  const transform = useStore((s) => s.transform ?? [0, 0, 1]);
  if (!connectFrom || flowX == null || flowY == null) return null;
  const handleType = connectFrom.handleType === 'target' ? 'target' : 'source';
  const sourceFlow =
    getSourceHandleFlowPosition(nodeInternals, connectFrom.sourceNodeId, connectFrom.sourceHandleId, handleType)
    ?? getSourceHandleFlowPositionFallback(nodeInternals, connectFrom.sourceNodeId, connectFrom.sourceHandleId, handleType);
  if (!sourceFlow) return null;
  // 使用 flow 坐标绘制路径，再通过 transform 与 Viewport 一致地变换，确保与节点、连接线对齐
  const [path] = getBezierPath({
    sourceX: sourceFlow.x,
    sourceY: sourceFlow.y,
    sourcePosition: Position.Right,
    targetX: flowX,
    targetY: flowY,
    targetPosition: Position.Left,
    curvature: 0.25,
  });
  return (
    <Panel position="top-left" style={{ left: 0, top: 0, margin: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 5 }}>
      <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
        <g transform={`translate(${transform[0]}, ${transform[1]}) scale(${transform[2]})`}>
          <path d={path} fill="none" stroke={isDarkMode ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.5)'} strokeWidth={2} />
        </g>
      </svg>
    </Panel>
  );
});

interface FlowContentProps {
  nodes: Node[];
  edges: Edge[];
  onNodesChange: any;
  onEdgesChange: any;
  onNodesDelete?: (nodes: Node[]) => void;
  onConnect: (params: Connection) => void;
  onNodeClick: (event: React.MouseEvent, node: Node) => void;
  onSelectionChange?: (params: { nodes: Node[]; edges: Edge[] }) => void;
  onNodeDragStart?: (event: React.MouseEvent, node: Node) => void | false;
  onNodeDragStop?: (event: React.MouseEvent, node: Node) => void;
  onPaneClick: () => void;
  onDrop: (event: React.DragEvent, flowPosition: { x: number; y: number }) => void;
  onDragOver: (event: React.DragEvent) => void;
  onEdgeClick?: (event: React.MouseEvent, edge: Edge) => void;
  nodeTypes: NodeTypes;
  /** x,y: clientX/clientY 用于菜单 fixed 定位；flowX/flowY: 画布坐标用于连接线终点与节点创建 */
  contextMenu: { x: number; y: number; flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } } | null;
  setContextMenu: (menu: FlowContentProps['contextMenu']) => void;
  handleMenuSelect: (type: string, position: { x: number; y: number }, connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null }) => void;
  reactFlowWrapper: React.RefObject<HTMLDivElement>;
  isDarkMode: boolean;
  selectedNode: Node | null;
  onPaneMouseDown?: (event: React.MouseEvent) => void;
  onBatchRun?: (nodeIds: string[]) => void; // 批量运行回调
  batchRunInProgress?: boolean; // 批量运行中，用于禁用按钮并显示绿色
  characterListCollapsed?: boolean; // 角色列表是否收起
  setNodes?: (nodes: Node[] | ((nodes: Node[]) => Node[])) => void; // 用于复制粘贴
  setEdges?: (edges: Edge[] | ((edges: Edge[]) => Edge[])) => void; // 用于复制粘贴
  /** 供父组件（如 Workspace）获取画布坐标转换与鼠标位置，用于粘贴截图等时定位到鼠标处 */
  flowContentApiRef?: React.MutableRefObject<{
    screenToFlowPosition: (p: { x: number; y: number }) => { x: number; y: number };
    getLastMousePosition: () => { x: number; y: number };
  } | null>;
  onPerformanceModeChange?: (enabled: boolean) => void;
}

const FlowContent: React.FC<FlowContentProps> = (props) => {
  // 防御性处理：避免某些热更新或错误调用导致 props 为 undefined
  const {
    nodes,
    edges,
    onNodesChange,
    onEdgesChange,
    onNodesDelete,
    onConnect,
    onNodeClick,
    onSelectionChange,
    onNodeDragStart,
    onNodeDragStop,
    onPaneClick,
    onDrop,
    onDragOver,
    onEdgeClick,
    nodeTypes,
    contextMenu,
    setContextMenu,
    handleMenuSelect,
    reactFlowWrapper,
    isDarkMode,
    selectedNode,
    onPaneMouseDown: externalOnPaneMouseDown,
    onBatchRun,
    batchRunInProgress = false,
    characterListCollapsed = true, // 默认收起
    setNodes: externalSetNodes,
    setEdges: externalSetEdges,
    flowContentApiRef,
    onPerformanceModeChange,
  } = props || ({} as FlowContentProps);
  const { screenToFlowPosition, flowToScreenPosition, getNodes, fitView, setViewport, getViewport, setCenter, setNodes: reactFlowSetNodes, setEdges: reactFlowSetEdges } = useReactFlow();
  const viewportWidth = useStore((s) => s.width ?? 800);
  const viewportHeight = useStore((s) => s.height ?? 600);
  const zoom = useStore((s) => s.transform?.[2] ?? 1);
  const connectionNodeId = useStore((s) => s.connectionNodeId);
  const connectionPosition = useStore((s) => s.connectionPosition);
  const transform = useStore((s) => s.transform ?? [0, 0, 1]);
  
  // 使用外部传入的 setNodes 和 setEdges，如果没有则使用 React Flow 内部的
  const setNodes = externalSetNodes || reactFlowSetNodes;
  const setEdges = externalSetEdges || reactFlowSetEdges;
  
  // 保存 ReactFlow 实例引用，用于调用 fitView
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  // 跟踪是否已经执行过初始 fitView
  const hasInitialFitViewRef = useRef(false);
  // 小地图容器 ref，用于点击时换算画布坐标
  const minimapContainerRef = useRef<HTMLDivElement>(null);
  // 拖线到空白处时暂存 source，用于弹出菜单后创建节点并自动连边
  const pendingConnectRef = useRef<{ sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } | null>(null);

  // 使用 ref 存储上一次的选中节点 ID，避免不必要的更新
  const prevSelectedNodeIdsRef = useRef<string>('');
  
  // 获取选中的节点 ID 数组（使用 React Flow 的 store，但只提取 ID）
  const selectedNodeIds = useStore((store) => {
    if (store.nodeInternals.size === 0) return '';
    const ids = Array.from(store.nodeInternals.values())
      .filter((node) => node.selected)
      .map((node) => node.id)
      .sort()
      .join(',');
    return ids;
  });
  
  // 使用 state 存储选中的可运行节点（只在 ID 变化时更新）
  const [selectedRunnableNodes, setSelectedRunnableNodes] = useState<Node[]>([]);
  
  // 隔离选中状态监听：只在节点 ID 变化时更新
  useEffect(() => {
    // 对比新旧 ID 列表是否一致
    if (prevSelectedNodeIdsRef.current === selectedNodeIds) {
      return; // ID 列表未变化，不更新
    }
    
    prevSelectedNodeIdsRef.current = selectedNodeIds;
    
    // 如果 ID 列表为空，清空选中节点
    if (!selectedNodeIds) {
      setSelectedRunnableNodes([]);
      return;
    }
    
    // 从 nodes 中筛选出可运行的节点
    const runnableNodes = nodes.filter((node) => {
      const nodeType = node.type;
      const isRunnable = nodeType === 'video' || nodeType === 'image' || nodeType === 'llm' || nodeType === 'audio';
      if (!isRunnable) {
        return false;
      }
      
      // 检查节点是否在选中的 ID 列表中
      const isSelected = selectedNodeIds.split(',').includes(node.id);
      return isSelected;
    });
    
    // 只有当节点数量 >= 2 时才更新
    if (runnableNodes.length >= 2) {
      setSelectedRunnableNodes(runnableNodes);
    } else {
      setSelectedRunnableNodes([]);
    }
  }, [selectedNodeIds, nodes]);
  
  // 计算节点 ID 字符串（用于依赖项比较）
  // 使用 selectedNodeIds 作为依赖，因为它已经是稳定的字符串
  const selectedNodeIdsString = useMemo(() => {
    if (selectedRunnableNodes.length === 0) return '';
    return selectedRunnableNodes.map((n) => n.id).sort().join(',');
  }, [selectedRunnableNodes.length, selectedNodeIds]);
  
  // 计算批量运行按钮位置（选区右上角外侧约 20px）
  // 只依赖节点 ID 字符串，避免循环更新
  const batchRunButtonPosition = useMemo(() => {
    if (selectedRunnableNodes.length < 2) {
      return null;
    }
    
    try {
      // 使用新的 getNodesBounds API（替代已弃用的 getRectOfNodes）
      const bounds = getNodesBounds(selectedRunnableNodes);
      if (!bounds) {
        return null;
      }
      
      // 获取 React Flow 实例用于坐标转换
      const reactFlowInstance = reactFlowInstanceRef.current;
      if (!reactFlowInstance) {
        return null;
      }
      
      const wrapperBounds = reactFlowWrapper.current?.getBoundingClientRect();
      if (!wrapperBounds) {
        return null;
      }
      
      // 获取 viewport 信息
      const viewport = reactFlowInstance.getViewport();
      
      // 将 flow 坐标转换为屏幕坐标
      const screenX = bounds.x * viewport.zoom + viewport.x;
      const screenY = bounds.y * viewport.zoom + viewport.y;
      const screenWidth = bounds.width * viewport.zoom;
      
      // 计算按钮位置：选区右上角外侧约 20px
      const x = screenX + screenWidth + 20;
      const y = screenY - 20; // 稍微向上偏移
      
      const position = {
        x: x - wrapperBounds.left,
        y: y - wrapperBounds.top,
      };
      
      return position;
    } catch (error) {
      console.error('[FlowContent] 计算批量运行按钮位置失败:', error);
      return null;
    }
    // 只依赖节点 ID 字符串，而不是整个节点对象数组
  }, [selectedNodeIdsString, selectedRunnableNodes, reactFlowWrapper]);
  
  // 批量运行处理函数（使用节点 ID 字符串作为依赖，避免循环更新）
  const handleBatchRun = useCallback(() => {
    if (!onBatchRun || selectedRunnableNodes.length === 0) {
      return;
    }
    
    const nodeIds = selectedRunnableNodes.map((node) => node.id);
    onBatchRun(nodeIds);
  }, [onBatchRun, selectedRunnableNodes.length]);
  
  // 计算批量运行总价（仅图片/视频节点有定价）
  const totalPrice = useMemo(() => {
    let sum = 0;
    let hasAny = false;
    for (const node of selectedRunnableNodes) {
      const p = getNodePrice(node.type || '', node.data);
      if (p !== null) {
        sum += p;
        hasAny = true;
      }
    }
    return hasAny ? sum : null;
  }, [selectedNodeIdsString, selectedRunnableNodes]);
  
  // 中心聚焦函数：自动对齐所有节点到几何中心
  const centerNodes = useCallback((targetNodes: Node[] = nodes) => {
    if (!reactFlowInstanceRef.current || targetNodes.length === 0) {
      return;
    }
    
    // 调用 fitView 方法，仅改变 viewport 的 x, y 和 zoom 值
    reactFlowInstanceRef.current.fitView({
      padding: 0.2, // 20% 边距，确保模块离画布边缘有适当留白
      includeHiddenNodes: false, // 不包括隐藏节点
      duration: 800, // 800ms 平滑过渡动画
      // 不设置 minZoom 或 maxZoom，让 fitView 自由调整缩放比例
    });
    
    console.log('[FlowContent] 执行 centerNodes，节点数量:', targetNodes.length);
  }, [nodes]);
  
  // 一键归位按钮点击处理
  const handleFitView = useCallback(() => {
    centerNodes();
  }, [centerNodes]);

  // 配置边的样式：拖动时虚线，连接后实线（无箭头）
  const edgeTypes = useMemo<EdgeTypes>(() => ({
    animatedGradient: AnimatedGradientEdge,
  }), []);

  const renderedEdges = useMemo(
    () =>
      edges.map((edge) => ({
        ...edge,
        // 强制统一使用 SVG 渐变流光边，确保历史边（type=default）也有动画
        type: 'animatedGradient',
        className: edge.className ? `${edge.className} rf-edge-gradient` : 'rf-edge-gradient',
      })),
    [edges]
  );

  // 拖线时：将连接线终点转为 flow 坐标，找到所在节点，不兼容则加红框（class + 内联样式保证可见）
  const renderedNodes = useMemo(() => {
    if (!connectionNodeId || !connectionPosition || !nodes.length) return nodes;
    const sourceNode = nodes.find((n) => n.id === connectionNodeId);
    if (!sourceNode) return nodes;
    // connectionPosition 可能为容器坐标，统一转为 flow 坐标
    const [tx, ty, tz] = transform;
    const flowX = (connectionPosition.x - tx) / tz;
    const flowY = (connectionPosition.y - ty) / tz;
    const w = (n: Node) => (Number(n.data?.width) || 300);
    const h = (n: Node) => (Number(n.data?.height) || 200);
    const contains = (n: Node) => {
      const x = n.position.x;
      const y = n.position.y;
      return flowX >= x && flowX <= x + w(n) && flowY >= y && flowY <= y + h(n);
    };
    const atPosition = nodes.filter(contains);
    const targetNode = atPosition.length > 0 ? atPosition[atPosition.length - 1] : null;
    if (!targetNode || targetNode.id === connectionNodeId) return nodes;
    if (isConnectionAllowed(sourceNode.type ?? '', targetNode.type ?? '')) return nodes;
    return nodes.map((n) =>
      n.id === targetNode.id
        ? { ...n, className: `${n.className || ''} connection-invalid-target`.trim() }
        : n
    );
  }, [nodes, connectionNodeId, connectionPosition, transform]);

  const defaultEdgeOptions = useMemo(() => ({
    type: 'animatedGradient',
    className: 'rf-edge-gradient',
    animated: false,
    style: {
      strokeWidth: 2,
      stroke: isDarkMode ? 'rgba(255, 255, 255, 0.3)' : '#374151', // 暗黑模式：半透明白色，明亮模式：深灰色
    },
  }), [isDarkMode]);
  
  // 节点连线兼容性：禁止不兼容的 source -> target
  const isValidConnection = useCallback(
    (params: Connection | null) => {
      if (!params?.source || !params?.target) return false;
      const sourceNode = nodes.find((n) => n.id === params!.source);
      const targetNode = nodes.find((n) => n.id === params!.target);
      if (!sourceNode || !targetNode) return false;
      return isConnectionAllowed(sourceNode.type ?? '', targetNode.type ?? '');
    },
    [nodes]
  );

  // 处理连接创建（连接完成后，将边样式改为实线；成功连到节点时清空拖线到空白处的 pending）
  const handleConnect = useCallback((params: Connection) => {
    pendingConnectRef.current = null;
    if (onConnect) {
      onConnect(params);
      // 连接完成后，边会自动应用实线样式（通过 edgeTypes 或默认样式）
    }
  }, [onConnect]);
  
  // 处理画布右键点击：clientX/Y 用于菜单 fixed 定位，screenToFlowPosition 用于节点创建
  const onPaneContextMenu = useCallback(
    (event: React.MouseEvent) => {
      event.preventDefault();
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      });
    },
    [setContextMenu, screenToFlowPosition]
  );

  const updateNodeInternals = useUpdateNodeInternals();

  // 从节点拖出连线开始时记录 source，并刷新 handleBounds 确保连接线起点精确
  const onConnectStart = useCallback(
    (_event: React.MouseEvent | React.TouchEvent, params: { nodeId: string | null; handleId: string | null; handleType: string | null }) => {
      if (params.nodeId) {
        updateNodeInternals(params.nodeId);
        pendingConnectRef.current = {
          sourceNodeId: params.nodeId,
          sourceHandleId: params.handleId ?? null,
          handleType: params.handleType ?? null,
        };
      } else {
        pendingConnectRef.current = null;
      }
    },
    [updateNodeInternals]
  );

  // 拖线结束且未连到有效 target 时：用 React Flow API 转为画布坐标，在松开处弹出菜单
  const onConnectEnd = useCallback(
    (event: MouseEvent | TouchEvent) => {
      const pending = pendingConnectRef.current;
      if (!pending) return;
      updateNodeInternals(pending.sourceNodeId);
      const clientX = 'clientX' in event ? event.clientX : event.changedTouches?.[0]?.clientX ?? 0;
      const clientY = 'clientY' in event ? event.clientY : event.changedTouches?.[0]?.clientY ?? 0;
      const flowPosition = screenToFlowPosition({ x: clientX, y: clientY });
      setContextMenu({
        x: clientX,
        y: clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
        connectFrom: pending,
      });
      pendingConnectRef.current = null;
    },
    [setContextMenu, screenToFlowPosition, updateNodeInternals]
  );

  // 处理画布双击：clientX/Y 用于菜单 fixed 定位，screenToFlowPosition 用于节点创建
  const onPaneDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      if ((event.target as HTMLElement).closest('.react-flow__node')) return;
      const flowPosition = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setContextMenu({
        x: event.clientX,
        y: event.clientY,
        flowX: flowPosition.x,
        flowY: flowPosition.y,
      });
    },
    [setContextMenu, screenToFlowPosition]
  );

  // 确保容器在挂载时能正确计算尺寸
  useEffect(() => {
    // 强制触发 resize 事件，确保 React Flow 能获取正确的容器尺寸
    const handleResize = () => {
      window.dispatchEvent(new Event('resize'));
    };
    
    // 延迟执行，确保 DOM 已完全渲染
    const timer = setTimeout(handleResize, 100);
    
    return () => clearTimeout(timer);
  }, []);

  // 进入画布后初始化位置与尺寸：先设安全 viewport，再延迟 fitView 使画布尺寸稳定，减少崩溃
  useEffect(() => {
    if (nodes.length > 0 && reactFlowInstanceRef.current && !hasInitialFitViewRef.current) {
      const timer = setTimeout(() => {
        if (reactFlowInstanceRef.current && !hasInitialFitViewRef.current) {
          reactFlowInstanceRef.current.fitView({
            padding: 0.2,
            duration: 400,
            includeHiddenNodes: false,
            maxZoom: 1,
            minZoom: 0.1,
          });
          console.log('[FlowContent] 已执行首次进入对焦，节点数量:', nodes.length);
          hasInitialFitViewRef.current = true;
        }
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [nodes.length]);

  // ReactFlow 初始化回调：进入画布后先初始化 viewport 为安全默认，避免极端位置/缩放导致崩溃
  const onInit = useCallback((reactFlowInstance: ReactFlowInstance) => {
    reactFlowInstanceRef.current = reactFlowInstance;
    const safeViewport = { x: 0, y: 0, zoom: 1 };
    reactFlowInstance.setViewport(safeViewport);
    console.log('[FlowContent] ReactFlow 实例已初始化，viewport 已设为安全默认', safeViewport);
  }, []);
  
  // 复制粘贴状态管理
  const copiedDataRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const pasteOffsetRef = useRef(0); // 用于连续粘贴时的偏移
  
  // 生成唯一 ID
  const generateId = useCallback((prefix: string) => {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }, []);
  
  // 复制逻辑 (Ctrl+C / Cmd+C)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 检查是否按下了 Ctrl+C (Windows/Linux) 或 Cmd+C (Mac)
      const isCopy = (event.ctrlKey || event.metaKey) && event.key === 'c';
      
      if (isCopy) {
        // 检查是否在输入框中（避免复制文本时触发）
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        
        // 获取所有选中的节点
        const selectedNodes = nodes.filter((node) => node.selected);
        
        if (selectedNodes.length === 0) {
          return;
        }
        
        // 获取所有连接这些选中节点的连线
        const selectedNodeIds = new Set(selectedNodes.map((node) => node.id));
        const relatedEdges = edges.filter((edge) => 
          selectedNodeIds.has(edge.source) && selectedNodeIds.has(edge.target)
        );
        
        // 深度克隆节点和连线
        const clonedNodes = selectedNodes.map((node) => ({
          ...node,
          data: {
            ...node.data,
            // 重置运行状态
            progress: 0,
            progressMessage: undefined,
            errorMessage: undefined,
          },
        }));
        
        const clonedEdges = relatedEdges.map((edge) => ({ ...edge }));
        
        // 存储复制的数据
        copiedDataRef.current = {
          nodes: clonedNodes,
          edges: clonedEdges,
        };
        
        pasteOffsetRef.current = 0; // 重置偏移
        
        console.log(`[FlowContent] 已复制 ${clonedNodes.length} 个节点和 ${clonedEdges.length} 条连线`);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, edges]);
  
  // 粘贴逻辑 (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // 检查是否按下了 Ctrl+V (Windows/Linux) 或 Cmd+V (Mac)
      const isPaste = (event.ctrlKey || event.metaKey) && event.key === 'v';
      
      if (isPaste && copiedDataRef.current) {
        // 检查是否在输入框中（避免粘贴文本时触发）
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
          return;
        }
        
        event.preventDefault();
        
        const { nodes: copiedNodes, edges: copiedEdges } = copiedDataRef.current;
        
        if (copiedNodes.length === 0) {
          return;
        }
        
        // 获取鼠标当前位置（使用最后记录的鼠标位置，或画布中心）
        const reactFlowElement = reactFlowWrapper.current?.querySelector('.react-flow') as HTMLElement;
        let mousePos = { x: 0, y: 0 };
        
        if (reactFlowElement) {
          const lastMousePos = (reactFlowWrapper.current as any)?.lastMousePosition;
          if (lastMousePos) {
            mousePos = screenToFlowPosition({ x: lastMousePos.x, y: lastMousePos.y });
          } else {
            const reactFlowBounds = reactFlowElement.getBoundingClientRect();
            const centerX = reactFlowBounds.left + reactFlowBounds.width / 2;
            const centerY = reactFlowBounds.top + reactFlowBounds.height / 2;
            mousePos = screenToFlowPosition({ x: centerX, y: centerY });
          }
        }
        
        // 计算节点组的边界框和中心点
        const bounds = getNodesBounds(copiedNodes);
        if (!bounds) {
          console.warn('[FlowContent] 无法计算节点边界，使用默认位置');
          return;
        }
        
        const centerOffsetX = bounds.x + bounds.width / 2;
        const centerOffsetY = bounds.y + bounds.height / 2;
        
        // 应用连续粘贴偏移
        const offsetX = pasteOffsetRef.current * 20;
        const offsetY = pasteOffsetRef.current * 20;
        pasteOffsetRef.current += 1;
        
        // 创建 ID 映射表
        const idMap = new Map<string, string>();
        
        // 生成新节点（添加动画效果）
        const newNodes = copiedNodes.map((node) => {
          const newId = generateId(node.type || 'node');
          idMap.set(node.id, newId);
          
          const newNode = {
            ...node,
            id: newId,
            position: {
              x: mousePos.x + (node.position.x - centerOffsetX) + offsetX,
              y: mousePos.y + (node.position.y - centerOffsetY) + offsetY,
            },
            selected: true, // 自动选中新粘贴的节点
            data: {
              ...node.data,
              // 确保重置运行状态
              progress: 0,
              progressMessage: undefined,
              errorMessage: undefined,
            },
          };
          
          // 不再添加动画类名，避免点击时闪动
          // 如果需要保留粘贴动画，可以在动画完成后移除类名
          
          return newNode;
        });
        
        // 生成新连线
        const newEdges = copiedEdges.map((edge) => {
          const newId = generateId('edge');
          const newSource = idMap.get(edge.source);
          const newTarget = idMap.get(edge.target);
          
          if (!newSource || !newTarget) {
            console.warn(`[FlowContent] 无法找到节点映射: ${edge.source} -> ${edge.target}`);
            return null;
          }
          
          return {
            ...edge,
            id: newId,
            source: newSource,
            target: newTarget,
            selected: false,
          };
        }).filter((edge): edge is Edge => edge !== null);
        
        // 先取消所有节点的选中状态
        setNodes((currentNodes) =>
          currentNodes.map((node) => ({ ...node, selected: false }))
        );
        
        // 添加新节点和连线
        setNodes((currentNodes) => [...currentNodes, ...newNodes]);
        setEdges((currentEdges) => [...currentEdges, ...newEdges]);
        
        // 显示提示信息
        console.log(`[FlowContent] 已在鼠标处克隆 ${newNodes.length} 个模块`);
        
        // 简单的视觉反馈（可以使用更优雅的 toast 组件）
        const message = `已在鼠标处克隆 ${newNodes.length} 个模块`;
        // 创建一个临时的提示元素
        const toast = document.createElement('div');
        toast.textContent = message;
        toast.style.cssText = `
          position: fixed;
          top: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: ${isDarkMode ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.9)'};
          color: ${isDarkMode ? '#fff' : '#000'};
          padding: 12px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
          z-index: 10000;
          font-size: 14px;
          font-weight: 500;
          pointer-events: none;
          animation: fadeInZoom 0.3s ease-out;
        `;
        
        // 添加动画样式
        if (!document.getElementById('copy-paste-toast-style')) {
          const style = document.createElement('style');
          style.id = 'copy-paste-toast-style';
          style.textContent = `
            @keyframes fadeInZoom {
              from {
                opacity: 0;
                transform: translateX(-50%) scale(0.9);
              }
              to {
                opacity: 1;
                transform: translateX(-50%) scale(1);
              }
            }
          `;
          document.head.appendChild(style);
        }
        
        document.body.appendChild(toast);
        
        // 3秒后移除提示
        setTimeout(() => {
          toast.style.animation = 'fadeInZoom 0.3s ease-out reverse';
          setTimeout(() => {
            if (toast.parentNode) {
              toast.parentNode.removeChild(toast);
            }
          }, 300);
        }, 3000);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [screenToFlowPosition, getNodesBounds, generateId, setNodes, setEdges, reactFlowWrapper, isDarkMode]);
  
  const updateDotHighlightByClient = useCallback((clientX: number, clientY: number) => {
    if (!reactFlowWrapper.current) return;
    const reactFlowElement = reactFlowWrapper.current.querySelector('.react-flow') as HTMLElement | null;
    if (!reactFlowElement) return;
    const bounds = reactFlowElement.getBoundingClientRect();
    const localX = clientX - bounds.left;
    const localY = clientY - bounds.top;
    reactFlowElement.style.setProperty('--dot-mouse-x', `${localX}px`);
    reactFlowElement.style.setProperty('--dot-mouse-y', `${localY}px`);
    (reactFlowWrapper.current as any).lastMousePosition = { x: clientX, y: clientY };
  }, [reactFlowWrapper]);

  // 监听鼠标/指针移动，记录最后位置（client 坐标，用于粘贴定位与高光跟随）
  useEffect(() => {
    const handleMouseMove = (event: MouseEvent) => {
      updateDotHighlightByClient(event.clientX, event.clientY);
    };
    const handlePointerMove = (event: PointerEvent) => {
      updateDotHighlightByClient(event.clientX, event.clientY);
    };
    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('pointermove', handlePointerMove);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('pointermove', handlePointerMove);
    };
  }, [updateDotHighlightByClient]);

  const handleFlowMove = useCallback((event: MouseEvent | TouchEvent | null) => {
    if (!event) return;
    if ('clientX' in event) {
      updateDotHighlightByClient(event.clientX, event.clientY);
      return;
    }
    const touch = event.touches?.[0] ?? event.changedTouches?.[0];
    if (touch) updateDotHighlightByClient(touch.clientX, touch.clientY);
  }, [updateDotHighlightByClient]);

  // 向父组件暴露 screenToFlowPosition 与 getLastMousePosition（供粘贴截图等时定位到鼠标处）
  useEffect(() => {
    if (!flowContentApiRef) return;
    flowContentApiRef.current = {
      screenToFlowPosition,
      getLastMousePosition: () => (reactFlowWrapper.current as any)?.lastMousePosition ?? { x: 0, y: 0 },
    };
    return () => {
      flowContentApiRef.current = null;
    };
  }, [flowContentApiRef, screenToFlowPosition]);

  // 固定画布尺寸为可见视口（仅窗口 resize 时更新），严禁随内容拉伸；逻辑边界由 MAX_CANVAS_SIZE 限定
  const [viewportSize, setViewportSize] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    const el = reactFlowWrapper.current;
    if (!el) return;
    const updateSize = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w > 0 && h > 0) setViewportSize({ width: w, height: h });
    };
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const canvasStyle = useMemo(() => {
    const base: React.CSSProperties = { position: 'relative', overflow: 'hidden' };
    if (viewportSize) {
      base.width = viewportSize.width;
      base.height = viewportSize.height;
    } else {
      base.width = '100%';
      base.height = '100%';
    }
    return base;
  }, [viewportSize]);

  const [isPanOrZooming, setIsPanOrZooming] = useState(false);
  const [isPerformanceMode, setIsPerformanceMode] = useState(false);
  const perfModeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const shouldEnable = nodes.length > 20 || zoom < 0.5;
    if (perfModeTimerRef.current) clearTimeout(perfModeTimerRef.current);
    perfModeTimerRef.current = setTimeout(() => {
      setIsPerformanceMode((prev) => {
        if (prev !== shouldEnable) {
          console.log(`[FlowContent] 智能性能模式${shouldEnable ? '已开启' : '已关闭'}（nodes=${nodes.length}, zoom=${zoom.toFixed(2)}）`);
        }
        return shouldEnable;
      });
    }, 300);
    return () => {
      if (perfModeTimerRef.current) {
        clearTimeout(perfModeTimerRef.current);
        perfModeTimerRef.current = null;
      }
    };
  }, [nodes.length, zoom]);

  useEffect(() => {
    onPerformanceModeChange?.(isPerformanceMode);
  }, [isPerformanceMode, onPerformanceModeChange]);

  // 小地图点击：将点击位置换算为画布坐标并 setCenter 跳转
  const handleMinimapClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      if (!minimapContainerRef.current) return;
      const rect = minimapContainerRef.current.getBoundingClientRect();
      const relX = (e.clientX - rect.left) / rect.width;
      const relY = (e.clientY - rect.top) / rect.height;
      const nodesList = getNodes();
      const vp = getViewport();
      const defaultW = Math.max(viewportWidth / vp.zoom, 500);
      const defaultH = Math.max(viewportHeight / vp.zoom, 500);
      const bounds =
        nodesList.length > 0
          ? getNodesBounds(nodesList)
          : { x: -defaultW / 2, y: -defaultH / 2, width: defaultW, height: defaultH };
      const flowX = bounds.x + relX * bounds.width;
      const flowY = bounds.y + relY * bounds.height;
      setCenter(flowX, flowY, { zoom: vp.zoom });
    },
    [getNodes, getViewport, getNodesBounds, setCenter, viewportWidth, viewportHeight]
  );

  return (
    <ErrorBoundary>
      <div
        ref={reactFlowWrapper}
        className={isDarkMode ? 'dark-mode' : 'light-mode'}
        style={{
          width: '100%',
          height: '100%',
          position: 'relative',
          overflow: 'auto',
        }}
      >
        <div style={canvasStyle} className={`${isPanOrZooming ? 'react-flow-wrapper--interacting' : ''} ${isPerformanceMode ? 'pf-performance-mode' : ''}`.trim() || undefined}>
        <ReactFlow
          nodes={renderedNodes}
          edges={renderedEdges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodesDelete={onNodesDelete}
          onConnect={handleConnect}
          isValidConnection={isValidConnection}
          onConnectStart={onConnectStart}
          onConnectEnd={onConnectEnd}
          onNodeClick={onNodeClick}
          onSelectionChange={onSelectionChange}
          onNodeDragStart={onNodeDragStart}
          onNodeDragStop={onNodeDragStop}
          onPaneClick={onPaneClick}
          onDrop={(e) => {
            const flowPosition = screenToFlowPosition({ x: e.clientX, y: e.clientY });
            onDrop(e, flowPosition);
          }}
          onDragOver={onDragOver}
          onEdgeClick={onEdgeClick}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          connectionLineComponent={CustomConnectionLine}
          defaultEdgeOptions={defaultEdgeOptions}
          elementsSelectable={true}
          nodesDraggable={true}
          nodesConnectable={true}
          selectionOnDrag={true}
          selectionMode={SelectionMode.Partial}
          selectionKeyCode="Shift"
          panActivationKeyCode="Space"
          panOnDrag={[1, 2]}
          onSelectionStart={(e) => e.preventDefault()}
          panOnScroll={false}
          deleteKeyCode={['Delete', 'Backspace']}
          minZoom={0.1}
          maxZoom={1}
          zoomOnScroll={true}
          zoomOnPinch={true}
          zoomOnDoubleClick={false}
          translateExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
          nodeExtent={[[-Infinity, -Infinity], [Infinity, Infinity]]}
          defaultViewport={{ x: 0, y: 0, zoom: 1 }}
          fitView={false}
          fitViewOptions={{ padding: 0.2, includeHiddenNodes: false }}
          snapToGrid={false}
          connectionRadius={40}
          onInit={onInit}
          onMoveStart={(event) => {
            setIsPanOrZooming(true);
            handleFlowMove(event);
          }}
          onMove={handleFlowMove}
          onMoveEnd={(event) => {
            setIsPanOrZooming(false);
            handleFlowMove(event);
          }}
          className={isDarkMode ? "bg-black dark-mode" : "bg-white light-mode"}
          onContextMenu={onPaneContextMenu}
          onDoubleClick={onPaneDoubleClick}
          onlyRenderVisibleElements={false}
        >
          {/* 关闭“仅渲染可见节点”，避免框选时漏选未在视口内渲染的节点 */}
        <FlowDotBackground isDarkMode={!!isDarkMode} />
        {/* 拖线到空白处弹出菜单时：保持一条从源节点到松开点的连接线，起点用 React Flow 内部 handleBounds 保证精确 */}
        <PendingConnectionLine
          connectFrom={contextMenu?.connectFrom}
          flowX={contextMenu?.flowX}
          flowY={contextMenu?.flowY}
          isDarkMode={isDarkMode}
        />
        {/* 一键归位按钮 - 在小地图面板右侧 */}
        <div 
          className="absolute bottom-4 z-10"
          style={{
            left: characterListCollapsed ? '247px' : '479px', // 小地图面板宽 160 + gap 16 + 按钮 60
            transition: 'left 0.3s ease-in-out',
          }}
        >
          <button
            onClick={handleFitView}
            className={`flex items-center justify-center w-10 h-10 rounded-lg transition-all ${
              isDarkMode
                ? 'apple-panel hover:bg-white/20 text-white/80'
                : 'apple-panel-light hover:bg-gray-200/30 text-gray-700'
            }`}
            title="一键归位（居中所有模块）"
          >
            <Maximize2 className="w-5 h-5" />
          </button>
        </div>

        {/* 左下角：画布小地图 + 缩放滑动条 */}
        <div
          className="absolute bottom-4 left-4 z-10 flex flex-col gap-2 nodrag nopan"
          style={{
            left: characterListCollapsed ? '71px' : '303px',
            transition: 'left 0.3s ease-in-out',
          }}
        >
          {/* 小地图：可拖拽平移画布，点击跳转到对应位置 */}
          <div
            ref={minimapContainerRef}
            role="button"
            tabIndex={0}
            className={`rounded-lg overflow-hidden cursor-crosshair ${isDarkMode ? 'apple-panel' : 'apple-panel-light'}`}
            style={{ width: 160, height: 100 }}
            onClick={handleMinimapClick}
            onKeyDown={(e) => e.key === 'Enter' && minimapContainerRef.current?.click()}
          >
            <MiniMap
              pannable
              nodeColor={isDarkMode ? 'rgba(255,255,255,0.8)' : 'rgba(0,0,0,0.6)'}
              maskColor={isDarkMode ? 'rgba(0,0,0,0.5)' : 'rgba(255,255,255,0.5)'}
              className="!bg-transparent w-full h-full"
            />
          </div>
          {/* 缩放滑动条：独立组件订阅 zoom，避免 FlowContent 在缩放时重渲染节点导致卡顿 */}
          <ZoomSlider isDarkMode={!!isDarkMode} />
        </div>
        
        {/* 批量运行按钮 */}
        {(() => {
          const shouldShow = selectedRunnableNodes.length >= 2 && batchRunButtonPosition;
          
          if (!shouldShow) {
            return null;
          }
          
          return (
            <div style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 50 }}>
              <BatchRunButton
                selectedNodes={selectedRunnableNodes}
                position={batchRunButtonPosition}
                isDarkMode={isDarkMode}
                onBatchRun={handleBatchRun}
                isRunning={batchRunInProgress}
                totalPrice={totalPrice}
              />
            </div>
          );
        })()}
      </ReactFlow>
        </div>
      </div>

      {/* 右键/双击菜单：x,y 为 clientX/clientY，直接用于 fixed 定位 */}
      {contextMenu && (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            onClose={() => setContextMenu(null)}
            allowedTypes={
              contextMenu.connectFrom && nodes.length > 0
                ? (() => {
                    const src = nodes.find((n) => n.id === contextMenu.connectFrom!.sourceNodeId);
                    return getAllowedMenuTypes(src?.type ?? null);
                  })()
                : undefined
            }
            onSelect={(type) => {
              if (contextMenu && 'flowX' in contextMenu && 'flowY' in contextMenu) {
                const flowX = (contextMenu as { flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } }).flowX ?? 0;
                const flowY = (contextMenu as { flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } }).flowY ?? 0;
                const connectFrom = (contextMenu as { flowX?: number; flowY?: number; connectFrom?: { sourceNodeId: string; sourceHandleId: string | null; handleType: string | null } }).connectFrom;
                console.log('[FlowContent] 创建节点，画布坐标:', { flowX, flowY, type, connectFrom });
                handleMenuSelect(type, { x: flowX, y: flowY }, connectFrom);
              } else {
                console.warn('[FlowContent] contextMenu 缺少 flowX 或 flowY', contextMenu);
              }
            }}
          />
      )}

      {/* 选框 */}
      {/* 使用 React Flow 内置的框选高亮，不再自绘矩形 */}
    </ErrorBoundary>
  );
};

export default FlowContent;
