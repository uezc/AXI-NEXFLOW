#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 global state.vscdb 的 composerData 与 bubbleId 导出对话正文为 Markdown。"""
import sqlite3
import json
import base64
import os
from pathlib import Path
from datetime import datetime

def main():
    appdata = os.environ.get("APPDATA", "")
    global_db = Path(appdata) / "Cursor" / "User" / "globalStorage" / "state.vscdb"
    if not global_db.exists():
        print("Global state.vscdb not found")
        return

    conn = sqlite3.connect(global_db)
    cur = conn.cursor()

    # 要导出的 NEXFLOW 相关 composer（从 workspace 已知）
    target_composer_ids = [
        "3a3bed93-919d-4036-90ea-4aff515dcd73",  # 画布里面的内容实时保存
        "88f9308a-304f-49e5-a6e8-988a6daa0d51",  # 归档项目访问问题
    ]

    out_dir = Path(__file__).resolve().parent.parent / "chat_history_export"
    out_dir.mkdir(exist_ok=True)
    all_lines = ["# NEXFLOW 相关 Cursor 对话正文导出\n", f"导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"]

    for cid in target_composer_ids:
        cur.execute("SELECT value FROM cursorDiskKV WHERE key = ?", (f"composerData:{cid}",))
        row = cur.fetchone()
        if not row:
            all_lines.append(f"## Composer {cid}\n(composerData 未在 global 中找到)\n\n")
            continue
        try:
            raw = row[0]
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                data = json.loads(base64.b64decode(raw).decode("utf-8"))
        except Exception as e:
            all_lines.append(f"## Composer {cid}\n(解析错误: {e})\n\n")
            continue

        title = data.get("name") or data.get("title") or cid
        all_lines.append(f"## {title}\n\n")

        # 对话条可能在 data.conversation / data.bubbles / data.messages，或通过 bubbleId 存
        conv = data.get("conversation") or data.get("bubbles") or data.get("messages") or []
        if isinstance(conv, list) and len(conv) > 0:
            for msg in conv:
                if not isinstance(msg, dict):
                    continue
                role = "User" if msg.get("type") == 1 or (msg.get("role") or "").lower() == "user" else "Assistant"
                text = (msg.get("text") or msg.get("content") or msg.get("rawText") or "").strip()
                ts = msg.get("timingInfo", {}).get("clientStartTime") or msg.get("timestamp") or 0
                time_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M:%S") if ts else ""
                all_lines.append(f"### {role} ({time_str})\n")
                if text:
                    all_lines.append(text + "\n")
            all_lines.append("\n---\n\n")
        else:
            # 按 bubbleId 拉取
            cur.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE ?", (f"bubbleId:{cid}:%",))
            bubbles = cur.fetchall()
            bubbles.sort(key=lambda x: x[0])
            for key, val in bubbles:
                try:
                    try:
                        b = json.loads(val)
                    except json.JSONDecodeError:
                        b = json.loads(base64.b64decode(val).decode("utf-8"))
                    role = "User" if (b.get("type") or b.get("role") or 0) == 1 or (str(b.get("role", "")).lower() == "user") else "Assistant"
                    text = (b.get("text") or b.get("content") or b.get("rawText") or b.get("message", {}).get("text") or "").strip()
                    if isinstance(text, dict):
                        text = text.get("text", "") or ""
                    ts = (b.get("timingInfo") or {}).get("clientStartTime") or b.get("timestamp") or 0
                    time_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M:%S") if ts else ""
                    all_lines.append(f"### {role} ({time_str})\n")
                    if text:
                        all_lines.append(text[:50000] + "\n")  # 单条截断避免过长
                    all_lines.append("\n")
                except Exception as e:
                    all_lines.append(f"*[解析 bubble 失败: {e}]*\n")
            all_lines.append("---\n\n")

    conn.close()
    out_file = out_dir / f"nexflow_conversations_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    out_file.write_text("\n".join(all_lines), encoding="utf-8")
    print(f"Exported to: {out_file}")

if __name__ == "__main__":
    main()
