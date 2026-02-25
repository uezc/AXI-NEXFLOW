#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 global state.vscdb 的 cursorDiskKV 查找 composerId 对应的 agent blob。"""
import sqlite3
import json
import os
from pathlib import Path

appdata = os.environ.get("APPDATA", "")
global_db = Path(appdata) / "Cursor" / "User" / "globalStorage" / "state.vscdb"
if not global_db.exists():
    print("Global state.vscdb not found")
    exit(1)

conn = sqlite3.connect(global_db)
cur = conn.cursor()
# 查找 key 里包含 composer id 的
target_ids = [
    "3a3bed93-919d-4036-90ea-4aff515dcd73",  # 画布里面的内容实时保存
    "88f9308a-304f-49e5-a6e8-988a6daa0d51",  # 归档项目访问问题
]
cur.execute("SELECT key FROM cursorDiskKV WHERE key LIKE 'agentKv:%' LIMIT 5")
sample = cur.fetchall()
print("Sample agentKv keys:", [r[0][:60] for r in sample])

# 尝试用 composerId 查
cur.execute("SELECT key FROM cursorDiskKV WHERE key LIKE '%3a3bed93%' OR key LIKE '%88f9308a%'")
matches = cur.fetchall()
print("Keys containing composer ids:", matches)

# 看看有没有 composerData 或 conversation 相关的 key
cur.execute("SELECT key FROM cursorDiskKV WHERE key LIKE '%composer%' OR key LIKE '%conversation%'")
print("Composer/conversation keys:", cur.fetchall())
conn.close()
