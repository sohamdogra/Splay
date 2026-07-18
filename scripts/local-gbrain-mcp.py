#!/usr/bin/env python3
"""Credential-free, read-only MCP access to a local arvya-gbrain checkout."""

from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import sys
from typing import Any


DEFAULT_ROOT = Path(__file__).resolve().parents[1] / ".gbrain-cache"
ROOT = Path(os.environ.get("GBRAIN_LOCAL_REPO", str(DEFAULT_ROOT))).resolve()
MAX_STALENESS_HOURS = float(os.environ.get("GBRAIN_LOCAL_MAX_STALENESS_HOURS", "48"))
TEXT_SUFFIXES = {".md", ".txt", ".json"}
SAFE_PREFIXES = ("meetings/research/", "code-changes/", "concepts/", "recipes/")
RESTRICTED_PREFIXES = (
    "strategy/",
    "compliance/",
    "deals/",
    "email/",
    "people/",
    "companies/",
    "action-items/",
)
STOP_WORDS = {
    "about", "after", "again", "also", "and", "are", "from", "have", "into",
    "more", "recent", "that", "the", "their", "this", "what", "when", "where",
    "which", "with", "would", "your",
}


def git(*args: str) -> str:
    proc = subprocess.run(
        ["git", "-C", str(ROOT), *args],
        check=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        text=True,
        timeout=30,
    )
    return proc.stdout


def repo_freshness() -> dict[str, Any]:
    if not (ROOT / ".git").exists():
        raise RuntimeError(f"local GBrain checkout is missing: {ROOT}")
    epoch = int(git("log", "-1", "--format=%ct").strip())
    committed_at = dt.datetime.fromtimestamp(epoch, tz=dt.timezone.utc)
    age_hours = (dt.datetime.now(dt.timezone.utc) - committed_at).total_seconds() / 3600
    if age_hours > MAX_STALENESS_HOURS:
        raise RuntimeError(
            f"local GBrain checkout is stale ({age_hours:.1f}h; maximum {MAX_STALENESS_HOURS:.1f}h)"
        )
    return {
        "source": "local_git_checkout",
        "repo": ROOT.name,
        "commit": git("rev-parse", "HEAD").strip(),
        "committed_at": committed_at.isoformat().replace("+00:00", "Z"),
        "age_hours": round(age_hours, 2),
    }


def safe_slug(slug: str) -> bool:
    normalized = slug.strip().lstrip("./")
    return (
        normalized.startswith(SAFE_PREFIXES)
        and not normalized.startswith(RESTRICTED_PREFIXES)
        and Path(normalized).suffix.lower() in TEXT_SUFFIXES
        and ".." not in Path(normalized).parts
    )


def path_for_slug(slug: str) -> Path:
    normalized = slug.strip().lstrip("./")
    if not safe_slug(normalized):
        raise ValueError("slug is outside the public-safe local source allowlist")
    path = (ROOT / normalized).resolve()
    if ROOT not in path.parents or not path.is_file():
        raise FileNotFoundError(normalized)
    return path


def clean_text(raw: str, limit: int = 6000) -> str:
    text = raw[:50000]
    text = re.sub(r"```.*?```", " ", text, flags=re.S)
    text = re.sub(r"<!--.*?-->", " ", text, flags=re.S)
    text = re.sub(r"^---\s*$.*?^---\s*$", " ", text, count=1, flags=re.S | re.M)
    text = re.sub(r"[#>*_`|]+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:limit]


def page(slug: str, excerpt_limit: int = 1800) -> dict[str, Any]:
    path = path_for_slug(slug)
    stat = path.stat()
    raw = path.read_text(encoding="utf-8", errors="replace")
    text = clean_text(raw)
    title_match = re.search(r"^#\s+(.+)$", raw, flags=re.M)
    title = title_match.group(1).strip() if title_match else path.stem.replace("-", " ").replace("_", " ")
    return {
        "slug": slug,
        "title": title,
        "type": slug.split("/", 1)[0],
        "chunk_text": text[:excerpt_limit],
        "updated_at": dt.datetime.fromtimestamp(stat.st_mtime, tz=dt.timezone.utc).isoformat().replace("+00:00", "Z"),
        "sensitivity": ["local_review_required"],
    }


def recent_slugs(limit: int) -> list[str]:
    log = git(
        "log",
        "-30",
        "--name-only",
        "--pretty=format:",
        "--",
        *SAFE_PREFIXES,
    )
    found: list[str] = []
    seen: set[str] = set()
    for raw in log.splitlines():
        slug = raw.strip()
        if slug and safe_slug(slug) and slug not in seen:
            seen.add(slug)
            found.append(slug)
            if len(found) >= limit:
                break
    return found


def query_pages(query: str, limit: int) -> list[dict[str, Any]]:
    terms = [term for term in re.findall(r"[a-z0-9]{3,}", query.lower()) if term not in STOP_WORDS]
    if not terms:
        return []
    matches: set[str] = set()
    for term in terms[:6]:
        proc = subprocess.run(
            ["rg", "-l", "-i", "-F", term, *SAFE_PREFIXES],
            cwd=ROOT,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            timeout=30,
        )
        matches.update(line.strip() for line in proc.stdout.splitlines() if safe_slug(line.strip()))
    scored: list[tuple[int, str]] = []
    for slug in matches:
        try:
            haystack = path_for_slug(slug).read_text(encoding="utf-8", errors="replace")[:100000].lower()
        except (OSError, ValueError):
            continue
        score = sum(haystack.count(term) for term in terms)
        if score:
            scored.append((score, slug))
    scored.sort(key=lambda item: (-item[0], item[1]))
    return [page(slug) for _, slug in scored[:limit]]


TOOLS = [
    {
        "name": "get_recent_salience",
        "description": "Return recent credential-free pages from the locally synced Arvya GBrain checkout.",
        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}}},
    },
    {
        "name": "query",
        "description": "Search the restricted editorial-source allowlist for corroborating pages.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}},
            "required": ["query"],
        },
    },
    {
        "name": "get_page",
        "description": "Read one exact slug from the restricted editorial-source allowlist.",
        "inputSchema": {"type": "object", "properties": {"slug": {"type": "string"}}, "required": ["slug"]},
    },
    {
        "name": "list_pages",
        "description": "List recent public-safe local GBrain pages.",
        "inputSchema": {"type": "object", "properties": {"limit": {"type": "integer", "minimum": 1, "maximum": 30}}},
    },
    {
        "name": "search",
        "description": "Alias for query for compatibility with the social-agent runtime.",
        "inputSchema": {
            "type": "object",
            "properties": {"query": {"type": "string"}, "limit": {"type": "integer", "minimum": 1, "maximum": 20}},
            "required": ["query"],
        },
    },
]


def result(req_id: Any, payload: Any) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": req_id,
        "result": {
            "content": [{"type": "text", "text": json.dumps(payload, ensure_ascii=False)}],
            "structuredContent": payload,
        },
    }


def handle(req: dict[str, Any]) -> dict[str, Any] | None:
    req_id = req.get("id")
    method = req.get("method")
    if method == "initialize":
        return {
            "jsonrpc": "2.0",
            "id": req_id,
            "result": {
                "protocolVersion": "2025-03-26",
                "capabilities": {"tools": {}},
                "serverInfo": {"name": "arvya-local-gbrain", "version": "1.0.0"},
            },
        }
    if method == "tools/list":
        return {"jsonrpc": "2.0", "id": req_id, "result": {"tools": TOOLS}}
    if method != "tools/call":
        return None if req_id is None else {"jsonrpc": "2.0", "id": req_id, "result": {}}

    params = req.get("params") or {}
    name = params.get("name")
    args = params.get("arguments") or {}
    freshness = repo_freshness()
    if name in {"get_recent_salience", "list_pages"}:
        limit = max(1, min(int(args.get("limit", 12)), 30))
        pages = [{**page(slug), "source_freshness": freshness} for slug in recent_slugs(limit)]
        return result(req_id, pages)
    if name in {"query", "search"}:
        limit = max(1, min(int(args.get("limit", 8)), 20))
        pages = [{**item, "source_freshness": freshness} for item in query_pages(str(args.get("query", "")), limit)]
        return result(req_id, pages)
    if name == "get_page":
        return result(req_id, {**page(str(args.get("slug", "")), 10000), "source_freshness": freshness})
    raise ValueError(f"unknown tool: {name}")


def main() -> None:
    for line in sys.stdin:
        if not line.strip():
            continue
        try:
            request = json.loads(line)
            response = handle(request)
        except Exception as exc:
            response = {
                "jsonrpc": "2.0",
                "id": request.get("id") if "request" in locals() else None,
                "error": {"code": -32000, "message": str(exc)},
            }
        if response is not None:
            sys.stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
            sys.stdout.flush()


if __name__ == "__main__":
    main()
