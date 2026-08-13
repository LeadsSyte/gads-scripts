"""SQLite-backed cache for prompts + responses + analysis.

The cache exists for two reasons:
  1. Cost control — never re-query an unchanged prompt within the TTL
     (default 7 days). Re-running the CLI after a tweak to templates
     should only call the API for *new* prompts.
  2. Forensics — every raw response stays on disk so the analyzer / report
     can be re-run without spending another API dollar.
"""

from __future__ import annotations

import json
import sqlite3
import time
from contextlib import contextmanager
from pathlib import Path


SCHEMA = """
CREATE TABLE IF NOT EXISTS prompts (
  prompt_key TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  template_id TEXT,
  category TEXT,
  persona TEXT,
  city TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key TEXT NOT NULL,
  run_index INTEGER NOT NULL,
  model TEXT NOT NULL,
  response_text TEXT,
  citations_json TEXT,
  raw_json TEXT,
  error TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (prompt_key, run_index, model)
);

CREATE INDEX IF NOT EXISTS idx_responses_prompt ON responses(prompt_key);

CREATE TABLE IF NOT EXISTS analysis (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key TEXT NOT NULL,
  run_index INTEGER NOT NULL,
  target_mentioned INTEGER NOT NULL,
  target_position INTEGER,
  target_cited_url INTEGER NOT NULL,
  competitors_mentioned_json TEXT,
  response_type TEXT,
  sentiment_toward_target TEXT,
  created_at INTEGER NOT NULL,
  UNIQUE (prompt_key, run_index)
);
"""


class Cache:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._conn() as c:
            c.executescript(SCHEMA)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.path)
        conn.row_factory = sqlite3.Row
        try:
            yield conn
            conn.commit()
        finally:
            conn.close()

    # ----- prompts -----

    def upsert_prompt(self, prompt) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT OR IGNORE INTO prompts
                   (prompt_key, text, template_id, category, persona, city, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?)""",
                (prompt.key, prompt.text, prompt.template_id, prompt.category,
                 prompt.persona, prompt.city, int(time.time())),
            )

    # ----- responses -----

    def fresh_response_count(self, prompt_key: str, model: str, ttl_seconds: int) -> int:
        """How many cached, still-fresh responses exist for this prompt?
        Used to decide how many additional iterations to run."""
        cutoff = int(time.time()) - ttl_seconds
        with self._conn() as c:
            row = c.execute(
                """SELECT COUNT(*) AS n FROM responses
                   WHERE prompt_key = ? AND model = ? AND created_at >= ? AND error IS NULL""",
                (prompt_key, model, cutoff),
            ).fetchone()
        return row["n"] if row else 0

    def save_response(self, prompt_key: str, run_index: int, model: str,
                      *, response_text: str | None, citations: list | None,
                      raw: dict | None, error: str | None = None) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT OR REPLACE INTO responses
                   (prompt_key, run_index, model, response_text, citations_json, raw_json, error, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
                (prompt_key, run_index, model,
                 response_text,
                 json.dumps(citations) if citations is not None else None,
                 json.dumps(raw) if raw is not None else None,
                 error,
                 int(time.time())),
            )

    def get_responses(self, prompt_key: str) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                """SELECT prompt_key, run_index, model, response_text, citations_json, error, created_at
                   FROM responses
                   WHERE prompt_key = ? AND error IS NULL
                   ORDER BY run_index ASC""",
                (prompt_key,),
            ).fetchall()
        out = []
        for r in rows:
            out.append({
                "prompt_key": r["prompt_key"],
                "run_index": r["run_index"],
                "model": r["model"],
                "response_text": r["response_text"] or "",
                "citations": json.loads(r["citations_json"]) if r["citations_json"] else [],
                "created_at": r["created_at"],
            })
        return out

    def all_prompts(self) -> list[dict]:
        with self._conn() as c:
            rows = c.execute("SELECT * FROM prompts ORDER BY template_id, text").fetchall()
        return [dict(r) for r in rows]

    # ----- analysis -----

    def save_analysis(self, prompt_key: str, run_index: int, *,
                      target_mentioned: bool, target_position: int | None,
                      target_cited_url: bool, competitors_mentioned: list[str],
                      response_type: str, sentiment_toward_target: str) -> None:
        with self._conn() as c:
            c.execute(
                """INSERT OR REPLACE INTO analysis
                   (prompt_key, run_index, target_mentioned, target_position, target_cited_url,
                    competitors_mentioned_json, response_type, sentiment_toward_target, created_at)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (prompt_key, run_index,
                 1 if target_mentioned else 0,
                 target_position,
                 1 if target_cited_url else 0,
                 json.dumps(competitors_mentioned),
                 response_type,
                 sentiment_toward_target,
                 int(time.time())),
            )

    def get_analyses(self, prompt_key: str) -> list[dict]:
        with self._conn() as c:
            rows = c.execute(
                """SELECT * FROM analysis WHERE prompt_key = ? ORDER BY run_index ASC""",
                (prompt_key,),
            ).fetchall()
        out = []
        for r in rows:
            out.append({
                "prompt_key": r["prompt_key"],
                "run_index": r["run_index"],
                "target_mentioned": bool(r["target_mentioned"]),
                "target_position": r["target_position"],
                "target_cited_url": bool(r["target_cited_url"]),
                "competitors_mentioned": json.loads(r["competitors_mentioned_json"] or "[]"),
                "response_type": r["response_type"],
                "sentiment_toward_target": r["sentiment_toward_target"],
            })
        return out
