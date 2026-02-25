#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 Cursor 的 state.vscdb 导出聊天记录（含 NEXFLOW 工作区与全局）。"""
import sqlite3
import json
import os
import base64
from pathlib import Path
from datetime import datetime

def get_cursor_paths():
    appdata = os.environ.get("APPDATA", "")
    if not appdata:
        return [], ""
    base = Path(appdata) / "Cursor" / "User"
    global_db = base / "globalStorage" / "state.vscdb"
    ws_base = base / "workspaceStorage"
    workspace_dbs = list(ws_base.glob("*")) if ws_base.exists() else []
    return [global_db] + [p / "state.vscdb" for p in workspace_dbs if (p / "state.vscdb").exists()], str(ws_base)

def extract_from_db(db_path, workspace_id=None):
    if not db_path or not Path(db_path).exists():
        return []
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        # 尝试 cursorDiskKV（新版）
        try:
            cur.execute("SELECT key, value FROM cursorDiskKV WHERE key LIKE 'composerData:%'")
            rows = cur.fetchall()
        except sqlite3.OperationalError:
            rows = []
        conversations = []
        for row in rows:
            key = row[0] if hasattr(row[0], 'strip') else row["key"]
            val = row[1] if hasattr(row[1], 'strip') else row["value"]
            try:
                try:
                    data = json.loads(val)
                except json.JSONDecodeError:
                    try:
                        data = json.loads(base64.b64decode(val).decode("utf-8"))
                    except Exception:
                        continue
                if data.get("conversation") and len(data["conversation"]) > 0:
                    conversations.append({"id": key.replace("composerData:", ""), "data": data, "workspace_id": workspace_id})
            except Exception:
                continue
        # 尝试 ItemTable 中的 chatdata
        try:
            cur.execute(
                "SELECT key, value FROM ItemTable WHERE key LIKE '%chat%' OR key LIKE '%composer%' OR key LIKE '%aichat%'"
            )
            for row in cur.fetchall():
                k = row[0] if hasattr(row[0], 'strip') else row["key"]
                v = row[1] if hasattr(row[1], 'strip') else row["value"]
                try:
                    data = json.loads(v) if isinstance(v, str) else v
                    if isinstance(data, dict) and data.get("conversation"):
                        conversations.append({"id": k, "data": data, "workspace_id": workspace_id})
                except Exception:
                    pass
        except sqlite3.OperationalError:
            pass
        conn.close()
        return conversations
    except Exception as e:
        print(f"Error reading {db_path}: {e}")
        return []

def format_msg(msg):
    if not isinstance(msg, dict):
        return "Invalid message"
    role = "User" if msg.get("type") == 1 else "Assistant"
    ts = msg.get("timingInfo", {}).get("clientStartTime", 0)
    time_str = datetime.fromtimestamp(ts / 1000).strftime("%Y-%m-%d %H:%M:%S") if ts else ""
    parts = [f"**{role}** ({time_str}):"]
    text = (msg.get("text") or "").strip()
    if text:
        parts.append(text)
    if msg.get("codeBlocks"):
        for b in msg["codeBlocks"]:
            code = (b.get("code") or "").strip()
            if code:
                parts.append(f"```{b.get('language', '')}\n{code}\n```")
    return "\n\n".join(parts)

def main():
    out_dir = Path(__file__).resolve().parent.parent / "chat_history_export"
    out_dir.mkdir(exist_ok=True)

    db_paths, ws_base = get_cursor_paths()
    # NEXFLOW 工作区 ID（workspace.json 里 folder 为 file:///d%3A/NEXFLOW）
    nexflow_ws_id = "10b583d2c17c396cdce71246294b8649"
    all_conversations = []

    for db_path in db_paths:
        db_path = Path(db_path)
        if not db_path.exists():
            continue
        ws_id = db_path.parent.name if "workspaceStorage" in str(db_path) else None
        label = "NEXFLOW" if ws_id == nexflow_ws_id else (ws_id or "Global")
        convos = extract_from_db(str(db_path), workspace_id=ws_id)
        for c in convos:
            c["_source"] = label
        all_conversations.extend(convos)
        print(f"  {label}: found {len(convos)} conversation(s) in {db_path.name}")

    # 按时间排序（取第一条消息时间）
    def sort_key(c):
        conv = c.get("data", {}).get("conversation") or []
        if not conv:
            return 0
        return conv[0].get("timingInfo", {}).get("clientStartTime", 0)

    all_conversations.sort(key=sort_key)

    # 只导出 NEXFLOW 相关（同工作区或全局里可能相关的）
    nexflow_conversations = [c for c in all_conversations if c.get("_source") == "NEXFLOW" or c.get("_source") == "Global"]
    if not nexflow_conversations:
        nexflow_conversations = all_conversations  # 若没有单独标 NEXFLOW，则导出全部

    lines = ["# Cursor 聊天记录导出（NEXFLOW 相关）\n", f"导出时间: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n"]
    for c in nexflow_conversations:
        conv = c.get("data", {}).get("conversation") or []
        if not conv:
            continue
        first_ts = conv[0].get("timingInfo", {}).get("clientStartTime", 0)
        start_time = datetime.fromtimestamp(first_ts / 1000).strftime("%Y-%m-%d %H:%M:%S") if first_ts else ""
        lines.append(f"## [{c.get('_source', '')}] {c.get('id', '')} — {start_time}\n")
        for msg in conv:
            lines.append(format_msg(msg))
            lines.append("\n---\n")
        lines.append("\n")

    out_file = out_dir / f"nexflow_chat_history_{datetime.now().strftime('%Y%m%d_%H%M%S')}.md"
    out_file.write_text("\n".join(lines), encoding="utf-8")
    print(f"Exported {len(nexflow_conversations)} conversation(s) to:\n  {out_file}")
    return out_file

if __name__ == "__main__":
    main()
