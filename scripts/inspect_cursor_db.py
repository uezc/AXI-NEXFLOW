#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""查看 Cursor state.vscdb 的表和键。"""
import sqlite3
import json
import os
from pathlib import Path

def inspect(db_path):
    if not Path(db_path).exists():
        print(f"Not found: {db_path}")
        return
    print(f"\n=== {db_path} ===")
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()
    # cursorDiskKV 的 key
    try:
        cur.execute("SELECT key FROM cursorDiskKV LIMIT 100")
        kv_keys = [r[0] for r in cur.fetchall()]
        print("cursorDiskKV keys (sample):", kv_keys[:50])
    except Exception as e:
        print("cursorDiskKV:", e)
    # ItemTable 中 composer 相关
    try:
        cur.execute("SELECT key, length(value) as L FROM ItemTable WHERE key LIKE '%composer%' OR key LIKE '%chat%' OR key LIKE '%conversation%'")
        for row in cur.fetchall():
            print(f"  ItemTable: {row[0]} (value length {row[1]})")
        cur.execute("SELECT value FROM ItemTable WHERE key = 'composer.composerData'")
        row = cur.fetchone()
        if row:
            data = json.loads(row[0])
            print("  composer.composerData keys:", list(data.keys())[:20] if isinstance(data, dict) else type(data))
            if isinstance(data, dict) and "conversations" in data:
                print("  conversations count:", len(data["conversations"]))
    except Exception as e:
        print("ItemTable composer:", e)
    conn.close()

appdata = os.environ.get("APPDATA", "")
base = Path(appdata) / "Cursor" / "User"
inspect(base / "globalStorage" / "state.vscdb")
nexflow_ws = base / "workspaceStorage" / "10b583d2c17c396cdce71246294b8649" / "state.vscdb"
inspect(nexflow_ws)
