; 安装包名称与路径：默认安装到 NEXFLOW 文件夹；选择路径时也会自动在该路径下创建 NEXFLOW 子文件夹（由 electron-builder 的 instFilesPre 实现）

; 设置默认安装目录为 ...\NEXFLOW（64 位：C:\Program Files\NEXFLOW；32 位：C:\Program Files (x86)\NEXFLOW）
!macro preInit
  SetRegView 64
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files\NEXFLOW"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files\NEXFLOW"
  SetRegView 32
  WriteRegExpandStr HKLM "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files (x86)\NEXFLOW"
  WriteRegExpandStr HKCU "${INSTALL_REGISTRY_KEY}" InstallLocation "C:\Program Files (x86)\NEXFLOW"
!macroend

; 安装时重置本地激活与 API Key 配置：
; - 使新安装后必须重新输入激活码
; - 核心算力 / 插件算力 API Key 为空，需用户手动输入
!macro customInstall
  ; 常见 userData 路径：%APPDATA%\nexflow
  Delete "$APPDATA\nexflow\license.json"
  Delete "$APPDATA\nexflow\nexflow-config.json"
  ; 兼容大小写目录名
  Delete "$APPDATA\NEXFLOW\license.json"
  Delete "$APPDATA\NEXFLOW\nexflow-config.json"
!macroend
