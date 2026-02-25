#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 NEXFLOW 工作区 state.vscdb 导出 composer 聊天记录。"""
import sqlite3
import json
import os
from pathlib import Path
from datetime import datetime

def main():
    appdata = os.environ.get("APPDATA", "")
    db_path = Path(appdata) / "Cursor" / "User" / "workspaceStorage" / "10b583d2c17c396cdce71246294b8649" / "state.vscdb"
    if not db_path.exists():
        print("NEXFLOW workspace state.vscdb not found")
        return

    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    cur.execute("SELECT value FROM ItemTable WHERE key = 'composer.composerData'")
    row = cur.fetchone()
    conn.close()

    if not row:
        print("composer.composerData not found")
        return

    data = json.loads(row[0])
    all_composers = data.get("allComposers") or []
    if isinstance(all_composers, dict):
        all_composers = list(all_composers.values())
    print(f"Found {len(all_composers)} composer(s) in NEXFLOW workspace.")

    out_dir = Path(__file__).resolve().parent.parent / "chat_history_export"
    out_dir.mkdir(exist_ok=True)
    out_lines = ["# NEXFLOW 工作区 — Cursor 聊天记录导出\n", f"导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"]

    for comp in all_composers:
        if not isinstance(comp, dict):
            continue
        cid = comp.get("id") or comp.get("composerId") or ""
        # 可能的对话内容在 conversation / messages / bubbles 等字段
        conv = comp.get("conversation") or comp.get("messages") or comp.get("bubbles") or []
        title = (comp.get("title") or comp.get("name") or cid or "未命名")[:80]
        out_lines.append(f"## {title}\n")
        out_lines.append(f"*Composer ID: {cid}*\n")
        if isinstance(conv, list) and len(conv) > 0:
            for msg in conv:
                if not isinstance(msg, dict):
                    continue
                role = "User" if msg.get("type") == 1 or msg.get("role") == "user" else "Assistant"
                text = (msg.get("text") or msg.get("content") or "").strip()
                ts = msg.get("timingInfo", {}).get("clientStartTime") or msg.get("timestamp") or 0
                time_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M:%S") if ts else ""
                out_lines.append(f"### {role} ({time_str})\n")
                if text:
                    out_lines.append(text + "\n")
            out_lines.append("\n---\n")
        else:
            # 可能对话在 global 的 agentKv blob 里，这里只保存元数据和摘要
            out_lines.append("*（该会话内容可能存储在全局 agentKv 中，此处仅保存元数据）*\n")
            out_lines.append("```json\n")
            out_lines.append(json.dumps({k: v for k, v in comp.items() if k not in ["conversation", "messages"]}, ensure_ascii=False, indent=2)[:2000])
            out_lines.append("\n```\n\n---\n")

    out_file = out_dir / f"nexflow_chat_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    out_file.write_text("\n".join(out_lines), encoding="utf-8")
    print(f"Exported to: {out_file}")

    # 同时保存完整 composer 原始 JSON 供后续解析或给 AI 做 context
    raw_file = out_dir / "nexflow_composer_data_raw.json"
    raw_file.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Raw composer data saved to: {raw_file}")

if __name__ == "__main__":
    main()
