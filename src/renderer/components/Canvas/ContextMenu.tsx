import React from 'react';
import { FileText, Image, Video, User, Volume2, Brain, SplitSquareVertical, Cuboid } from 'lucide-react';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  onSelect: (type: string) => void;
  /** 拖线创建时：只展示这些类型，不传则展示全部 */
  allowedTypes?: string[] | null;
}

const menuItems = [
  { type: 'text', label: '文本', icon: FileText },
  { type: 'llm', label: '大语言模型', icon: Brain },
  { type: 'textSplit', label: '文本拆分', icon: SplitSquareVertical },
  { type: 'image', label: '图片', icon: Image },
  { type: 'video', label: '视频', icon: Video },
  { type: 'character', label: '角色', icon: User },
  { type: 'audio', label: '声音', icon: Volume2 },
  { type: 'cameraControl', label: '3D视角控制器', icon: Cuboid },
];

const ContextMenu: React.FC<ContextMenuProps> = ({ x, y, onClose, onSelect, allowedTypes }) => {
  const handleItemClick = (type: string) => {
    onSelect(type);
    onClose();
  };

  const items =
    allowedTypes && allowedTypes.length > 0
      ? menuItems.filter((item) => allowedTypes.includes(item.type))
      : allowedTypes && allowedTypes.length === 0
        ? [] // 无允许类型时不展示任何项（例如从角色只允许创建视频时，allowedTypes 仅为 ['video']）
        : menuItems;

  return (
    <>
      {/* 背景遮罩，点击关闭菜单 */}
      <div
        className="fixed inset-0 z-40"
        onClick={onClose}
        onContextMenu={(e) => e.preventDefault()}
      />
      {/* 菜单 */}
      <div
        className="fixed z-50 apple-panel rounded-lg py-2 min-w-[120px] shadow-xl animate-menu-expand"
        style={{
          left: `${x}px`,
          top: `${y}px`,
        }}
        onClick={(e) => e.stopPropagation()}
        onContextMenu={(e) => e.preventDefault()}
      >
        {items.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.type}
              onClick={() => handleItemClick(item.type)}
              className="w-full px-4 py-2 flex items-center gap-3 text-white hover:bg-white/15 transition-colors text-sm"
            >
              <Icon className="w-4 h-4 text-white/60" />
              <span>{item.label}</span>
            </button>
          );
        })}
      </div>
    </>
  );
};

export default ContextMenu;
