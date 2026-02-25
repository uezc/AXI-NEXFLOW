import React, { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { Plus, Edit2, Trash2, ArrowLeft, Download, Upload, FolderOpen, Power } from 'lucide-react';

const CARD_BG_STORAGE_KEY = 'nexflow-project-card-bg';
function getCardBgKey(projectId: string) {
  return `${CARD_BG_STORAGE_KEY}-${projectId}`;
}

interface Project {
  id: string;
  name: string;
  date: string;
  createdAt: number;
  lastModified: number;
}

interface ProjectsProps {
  onBack?: () => void;
}

const Projects: React.FC<ProjectsProps> = ({ onBack }) => {
  const navigate = useNavigate();
  const [projects, setProjects] = useState<Project[]>([]);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [editName, setEditName] = useState('');
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [projectBasePath, setProjectBasePathState] = useState<string>('');
  /** 项目卡背景图（projectId -> dataUrl），从 localStorage 读写 */
  const [cardBackgrounds, setCardBackgrounds] = useState<Record<string, string>>({});
  /** 待删除确认的项目（非空时显示删除确认弹窗） */
  const [deleteConfirmProject, setDeleteConfirmProject] = useState<Project | null>(null);
  /** 非阻塞提示（替代 alert，避免 stole 焦点导致输入框光标异常） */
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const createInputRef = useRef<HTMLInputElement>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  // 新建项目对话框打开时聚焦输入框（requestAnimationFrame 确保 DOM 渲染完成）
  useEffect(() => {
    if (showCreateDialog) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          createInputRef.current?.focus();
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [showCreateDialog]);

  // 进入重命名模式时聚焦输入框
  useEffect(() => {
    if (editingProject) {
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          renameInputRef.current?.focus();
        });
      });
      return () => cancelAnimationFrame(raf);
    }
  }, [editingProject?.id]);

  // 自动关闭 toast
  useEffect(() => {
    if (!toastMessage) return;
    const t = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(t);
  }, [toastMessage]);

  // 加载项目列表与当前项目保存路径
  useEffect(() => {
    const loadProjects = async () => {
      if (!window.electronAPI) return;
      try {
        const projectList = await window.electronAPI.getProjects();
        setProjects(projectList);
      } catch (error) {
        console.error('加载项目列表失败:', error);
      }
    };
    const loadBasePath = async () => {
      if (!window.electronAPI?.getProjectBasePath) return;
      try {
        const base = await window.electronAPI.getProjectBasePath();
        setProjectBasePathState(base || '');
      } catch (_) {}
    };
    loadProjects();
    loadBasePath();
  }, []);

  // 从 localStorage 加载各项目卡背景图
  useEffect(() => {
    const next: Record<string, string> = {};
    projects.forEach((p) => {
      try {
        const url = localStorage.getItem(getCardBgKey(p.id));
        if (url) next[p.id] = url;
      } catch (_) {}
    });
    setCardBackgrounds((prev) => ({ ...prev, ...next }));
  }, [projects]);

  // 格式化日期
  const formatDate = (dateStr: string) => {
    return dateStr;
  };

  // 格式化时间戳为日期
  const formatTimestamp = (timestamp: number) => {
    const date = new Date(timestamp);
    return `${date.getFullYear()}/${String(date.getMonth() + 1).padStart(2, '0')}/${String(date.getDate()).padStart(2, '0')}`;
  };

  // 获取当前日期
  const getCurrentDate = () => {
    const now = new Date();
    return `${now.getFullYear()}/${String(now.getMonth() + 1).padStart(2, '0')}/${String(now.getDate()).padStart(2, '0')}`;
  };

  // 创建新项目
  const handleCreateProject = async () => {
    if (!newProjectName.trim() || !window.electronAPI) {
      return;
    }

    try {
      const newProject = await window.electronAPI.createProject(newProjectName.trim());
      setProjects((prev) => [...prev, newProject]);
      setNewProjectName('');
      setShowCreateDialog(false);
    } catch (error) {
      console.error('创建项目失败:', error);
    }
  };

  // 开始编辑项目
  const handleStartEdit = (project: Project) => {
    setEditingProject(project);
    setEditName(project.name);
  };

  // 确认编辑
  const handleConfirmEdit = async () => {
    if (!editingProject || !editName.trim() || !window.electronAPI) {
      return;
    }

    try {
      const updated = await window.electronAPI.updateProject(editingProject.id, editName.trim());
      setProjects((prev) =>
        prev.map((p) => (p.id === editingProject.id ? updated : p))
      );
      setEditingProject(null);
      setEditName('');
    } catch (error: any) {
      console.error('更新项目失败:', error);
      setToastMessage(`重命名失败: ${error?.message || '未知错误'}`);
    }
  };

  // 取消编辑
  const handleCancelEdit = () => {
    setEditingProject(null);
    setEditName('');
  };

  // 点击删除按钮：弹出确认窗口
  const handleDeleteClick = (project: Project) => {
    setDeleteConfirmProject(project);
  };

  // 确认删除项目（同时删除项目文件夹）
  const handleConfirmDelete = async () => {
    const project = deleteConfirmProject;
    setDeleteConfirmProject(null);
    if (!project || !window.electronAPI) return;
    try {
      await window.electronAPI.deleteProject(project.id);
      setProjects((prev) => prev.filter((p) => p.id !== project.id));
    } catch (error) {
      console.error('删除项目失败:', error);
    }
  };

  // 导出项目（含项目卡背景图）
  const handleExportProject = async (projectId: string, projectName: string) => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const cardBgDataUrl = typeof localStorage !== 'undefined' ? localStorage.getItem(getCardBgKey(projectId)) : null;
      const result = await window.electronAPI.exportProject(projectId, cardBgDataUrl || undefined);
      if (result.success) {
        setToastMessage(`项目 "${projectName}" 已成功导出！`);
      }
    } catch (error: any) {
      console.error('导出项目失败:', error);
      setToastMessage(`导出项目失败: ${error.message || '未知错误'}`);
    }
  };

  // 选择项目保存位置
  const handleSetProjectBasePath = async () => {
    if (!window.electronAPI?.setProjectBasePath) return;
    try {
      const result = await window.electronAPI.setProjectBasePath();
      if (result.success && result.path) {
        setProjectBasePathState(result.path);
        setToastMessage(`项目将保存到：${result.path}\n新建项目会使用新路径，已有项目仍在原路径。`);
      }
    } catch (e) {
      console.error('设置项目保存位置失败:', e);
    }
  };

  // 导入项目
  const handleImportProject = async () => {
    if (!window.electronAPI) {
      return;
    }

    try {
      const result = await window.electronAPI.importProject();
      if (result.success && result.project) {
        const list = await window.electronAPI.getProjects();
        setProjects(list);
        if (result.cardBackground && result.project.id) {
          try {
            localStorage.setItem(getCardBgKey(result.project.id), result.cardBackground);
            setCardBackgrounds((prev) => ({ ...prev, [result.project!.id]: result.cardBackground! }));
          } catch (_) {}
        }
        setToastMessage(`项目 "${result.project.name}" 已成功导入！`);
      }
    } catch (error: any) {
      console.error('导入项目失败:', error);
      setToastMessage(`导入项目失败: ${error.message || '未知错误'}`);
    }
  };

  // 退出软件
  const handleQuitApp = useCallback(async () => {
    if (!window.electronAPI?.quitApp) return;
    try {
      await window.electronAPI.quitApp();
    } catch (error) {
      console.error('退出软件失败:', error);
    }
  }, []);

  return (
    <>
    <div className="w-full min-h-screen bg-black p-10 flex flex-col items-start justify-start">
      {/* 头部 */}
      <div className="mb-8 w-full">
        {onBack && (
          <button
            onClick={onBack}
            className="mb-4 flex items-center gap-2 px-4 py-2 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>返回主页</span>
          </button>
        )}
        <div className="flex items-center justify-between flex-wrap gap-4">
          <h1 className="text-4xl font-bold text-white">我的项目</h1>
          <div className="flex items-center gap-3">
            {projectBasePath && (
              <span className="text-white/50 text-sm max-w-md truncate" title={projectBasePath}>
                保存位置: {projectBasePath}
              </span>
            )}
            <button
              onClick={handleSetProjectBasePath}
              className="flex items-center gap-2 px-4 py-2 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all"
              title="选择项目保存位置（默认在软件安装目录下 projects 文件夹）"
            >
              <FolderOpen className="w-4 h-4" />
              <span>选择保存位置</span>
            </button>
            <button
              onClick={handleImportProject}
              className="flex items-center gap-2 px-4 py-2 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-all"
              title="导入项目"
            >
              <Upload className="w-4 h-4" />
              <span>导入项目</span>
            </button>
          </div>
        </div>
      </div>

      {/* 项目网格 - 每行5个卡片 */}
      <div className="w-full grid grid-cols-5 gap-x-8 gap-y-6">
          {/* 新建项目卡片 */}
          <button
            onClick={() => setShowCreateDialog(true)}
            className="group relative aspect-video apple-panel rounded-xl p-6 flex flex-col items-center justify-center gap-4 hover:bg-white/15 transition-all duration-300 hover:scale-105"
            title="新建项目"
            aria-label="新建项目"
          >
            <div className="w-16 h-16 rounded-full bg-white/10 flex items-center justify-center group-hover:bg-white/20 transition-colors">
              <Plus className="w-8 h-8 text-white" />
            </div>
          </button>

          {/* 项目卡片 */}
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => {
                // 重命名状态锁定：仅允许“确认/取消/删除”三个按钮结束编辑
                if (editingProject) return;
                navigate(`/workspace/${project.id}`);
              }}
              className="group relative aspect-video apple-panel rounded-xl p-6 hover:bg-white/15 transition-all duration-300 hover:scale-105 flex flex-col cursor-pointer overflow-hidden"
            >
              {/* 半透明背景图：自适应卡片大小 */}
              {cardBackgrounds[project.id] && (
                <div
                  className="absolute inset-0 rounded-xl bg-cover bg-center bg-no-repeat opacity-50"
                  style={{ backgroundImage: `url(${cardBackgrounds[project.id]})` }}
                  aria-hidden
                />
              )}
              {/* 遮罩层保证文字可读 */}
              {cardBackgrounds[project.id] && (
                <div className="absolute inset-0 rounded-xl bg-black/30 pointer-events-none" aria-hidden />
              )}

              {editingProject?.id === project.id ? (
                // 编辑模式（重命名）- 独立层、高 z-index，阻止冒泡
                <div className="absolute inset-0 z-20 flex flex-col p-6 space-y-4 rounded-xl bg-black/80" onClick={(e) => e.stopPropagation()}>
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleConfirmEdit();
                      if (e.key === 'Escape') handleCancelEdit();
                    }}
                    className="w-full px-4 py-2 apple-panel rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-apple-blue cursor-text"
                    style={{ caretColor: 'white' }}
                    placeholder="项目名称"
                    aria-label="项目名称"
                    autoFocus
                  />
                  <div className="flex gap-2 justify-end mt-auto">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleConfirmEdit();
                      }}
                      className="px-4 py-2 apple-button-primary rounded-lg text-white transition-colors"
                    >
                      确认
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        handleCancelEdit();
                      }}
                      className="px-4 py-2 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-colors"
                    >
                      取消
                    </button>
                  </div>
                </div>
              ) : (
                // 显示模式
                <div className="flex-1 flex flex-col items-center justify-center h-full relative z-10">
                  {/* 标题居中 */}
                  <h3 className="text-4xl font-semibold text-white text-center mb-6">
                    {project.name}
                  </h3>
                  
                  {/* 日期信息 */}
                  <div className="space-y-1">
                    <p className="text-white/60 text-base text-center">
                      {formatDate(project.date)}
                    </p>
                    <p className="text-white/60 text-sm text-center">
                      修改: {formatTimestamp(project.lastModified)}
                    </p>
                  </div>
                  
                  {/* Hover 时显示：编辑、导出、删除 */}
                  <div className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 transition-opacity flex gap-2 z-20">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleStartEdit(project);
                      }}
                      className="p-2 apple-button-secondary rounded-lg text-white transition-colors"
                      title="编辑项目"
                    >
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleExportProject(project.id, project.name);
                      }}
                      className="p-2 apple-button-secondary rounded-lg text-white transition-colors"
                      title="导出项目"
                    >
                      <Download className="w-4 h-4" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteClick(project);
                      }}
                      className="p-2 bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 rounded-lg text-red-400 transition-colors"
                      title="删除项目"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

      {/* 删除项目确认弹窗（黑色模式） */}
      {deleteConfirmProject && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-zinc-900 border border-white/10 rounded-2xl p-6 w-[400px] shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">删除项目</h3>
            <p className="text-white/80 text-sm mb-1">
              删除项目「{deleteConfirmProject.name}」后，将同时删除其对应的项目文件夹及其中所有文件，且无法恢复。
            </p>
            <p className="text-white/50 text-xs mb-5">确定要删除吗？</p>
            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setDeleteConfirmProject(null)}
                className="px-4 py-2 rounded-xl text-white/80 hover:text-white hover:bg-white/10 transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleConfirmDelete}
                className="px-4 py-2 rounded-xl bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-400 transition-colors"
              >
                确定删除
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 创建项目对话框 - 使用 Portal 避免焦点被阻断 */}
      {showCreateDialog &&
        createPortal(
          <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[9999]"
            onClick={(e) => e.target === e.currentTarget && setShowCreateDialog(false)}
          >
            <div
              className="apple-panel rounded-xl p-6 w-96 relative z-10"
              onClick={(e) => e.stopPropagation()}
            >
              <h3 className="text-xl font-bold text-white mb-4">新建项目</h3>
              <input
                ref={createInputRef}
                type="text"
                value={newProjectName}
                onChange={(e) => setNewProjectName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleCreateProject();
                  if (e.key === 'Escape') setShowCreateDialog(false);
                }}
                placeholder="请输入项目名称"
                className="w-full px-4 py-3 apple-panel rounded-lg text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-apple-blue mb-4 cursor-text"
                style={{ caretColor: 'white' }}
                autoComplete="off"
                autoFocus
              />
              <div className="flex gap-2 justify-end">
                <button
                  type="button"
                  onClick={() => setShowCreateDialog(false)}
                  className="px-4 py-2 apple-button-secondary rounded-lg text-white/60 hover:text-white transition-colors"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={handleCreateProject}
                  disabled={!newProjectName.trim()}
                  className="px-4 py-2 apple-button-primary rounded-lg text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  创建
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* 非阻塞提示 Toast */}
      {toastMessage &&
        createPortal(
          <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-[9999] px-4 py-3 rounded-lg bg-white/10 backdrop-blur text-white text-sm max-w-md shadow-lg">
            {toastMessage}
          </div>,
          document.body
        )}

      {/* 右下角退出软件按钮 */}
      <button
        onClick={handleQuitApp}
        className="fixed bottom-6 right-6 z-40 w-11 h-11 rounded-full bg-red-500/20 hover:bg-red-500/30 border border-red-500/50 text-red-300 hover:text-red-200 transition-colors flex items-center justify-center"
        title="退出软件"
        aria-label="退出软件"
      >
        <Power className="w-5 h-5" />
      </button>
    </div>
    </>
  );
};

export default Projects;
