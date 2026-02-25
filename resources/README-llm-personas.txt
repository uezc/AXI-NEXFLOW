默认 LLM 人设（保存的提示词）打包说明
========================================

安装包首次运行时，若用户尚未保存任何人设，会从 default-llm-personas.json 注入默认人设。

【推荐】自动同步（构建时自动将当前人设写入安装包）：
1. 在 NEXFLOW 中打开 LLM 节点，保存好需要随安装包分发的人设（点击「保存」并命名）。
2. 直接执行 npm run electron:build。构建脚本会自动从本地配置读取 globalLLMPersonas，写入 resources/default-llm-personas.json 并打包。

手动方式（当本地未运行过应用时）：
1. 在 NEXFLOW 中保存好人设。
2. 找到 electron-store 的存储位置（Windows: %APPDATA%\nexflow\nexflow-config.json）。
3. 复制 "globalLLMPersonas" 数组到本目录的 default-llm-personas.json。
4. 执行 npm run electron:build。

若 default-llm-personas.json 为空数组 []，则不会注入任何人设。
