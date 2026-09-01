#!/usr/bin/env python3
"""Incremental Signal feed pipeline.

Uses Apify for collection, Gemini for weekly editorial synthesis, and writes only
static JSON consumed by the browser. The pipeline is safe to rerun: post IDs are
canonical, archive shards are merged, and state advances only after a successful
build.
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import os
import re
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
SOURCE_DATA = ROOT / "source-data"
ARCHIVE_DIR = ROOT / "data/archive"
DATA_DIR = ROOT / "data"
STATE_PATH = SOURCE_DATA / "state.json"
CONFIG_PATH = ROOT / "config/accounts.json"
APIFY_ACTOR = "xquik~x-tweet-scraper"
APIFY_ENDPOINT = f"https://api.apify.com/v2/acts/{APIFY_ACTOR}/run-sync-get-dataset-items"
MAX_ITEMS = 2500
MAX_CHARGE_USD = 0.50
OVERLAP_DAYS = 2

AI_ANCHOR = re.compile(
    r"\b(ai|agents?|llm|models?|inference|claude|codex|gpt|gemini|deepseek|kimi|opus|sonnet|mcp|prompt|tokens?|context window|computer use|neural|transformer)\b",
    re.I,
)

TOPIC_PATTERNS = {
    "agent-harnesses": re.compile(r"agent loop|orchestrat|harness|subagents?|parallel agents?|background agents?|swarm|/loop|/goal", re.I),
    "coding-workflows": re.compile(r"coding agent|claude code|\bcodex\b|agents\.md|claude\.md|plan mode|skill\.md|agent skills?|code review", re.I),
    "context-memory": re.compile(r"context window|context engineering|prompt cach|cache hit|compaction|autocompact|memory store|persistent memory", re.I),
    "verification-evals": re.compile(r"\bevals?\b|benchmark|verif|autoreview|regression|test suite|guardrails?|swe-bench", re.I),
    "agent-security": re.compile(r"sandbox|permission|allowlist|prompt injection|security|isolation|destructive|credential", re.I),
    "tools-mcp": re.compile(r"\bmcp\b|model context protocol|tool calls?|tool use|cli|machine-readable|api for agents", re.I),
    "model-routing": re.compile(r"model routing|advisor.{0,30}executor|frontier model|cheap(er)? model|route.{0,20}model|price.performance", re.I),
    "local-models": re.compile(r"local models?|local inference|open.weights?|on-device|quantization|ollama|llama\.cpp|mlx|dwarfstar", re.I),
    "product-shift": re.compile(r"generative ui|personal software|product engineer|prototype|just.in.time ui|agent as.*browser", re.I),
}


def read_json(path: Path, default: Any = None) -> Any:
    if not path.exists():
        return default
    return json.loads(path.read_text())


def write_json(path: Path, value: Any, *, compact: bool = True) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if compact:
        text = json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    else:
        text = json.dumps(value, ensure_ascii=False, indent=2)
    path.write_text(text + "\n")


def parse_created(value: str) -> datetime:
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        parsed = parsedate_to_datetime(value)
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso_created(value: str) -> str:
    return parse_created(value).isoformat()


def normalize_author(value: Any) -> dict[str, str]:
    author = value if isinstance(value, dict) else {}
    return {
        "username": author.get("username") or author.get("screenName") or "",
        "name": author.get("name") or "",
        "profilePicture": author.get("profilePicture") or author.get("profileImageUrl") or "",
    }


def normalize_media(items: Any) -> list[dict[str, Any]]:
    output = []
    for item in items or []:
        if not isinstance(item, dict):
            continue
        variants = [v for v in item.get("videoVariants", []) if v.get("contentType") == "video/mp4" and v.get("url")]
        variants.sort(key=lambda value: value.get("bitrate") or 0, reverse=True)
        media = {
            "id": str(item.get("id") or item.get("mediaKey") or ""),
            "type": item.get("type") or "photo",
            "url": item.get("mediaUrl") or item.get("media_url_https") or "",
            "width": item.get("width") or 0,
            "height": item.get("height") or 0,
            "altText": item.get("altText") or "",
        }
        if variants:
            media["playbackUrl"] = variants[0]["url"]
        if media["url"]:
            output.append(media)
    return output


def first_external_url(row: dict[str, Any]) -> str:
    for item in (row.get("entities") or {}).get("urls", []):
        expanded = item.get("expandedUrl") or ""
        if expanded and "x.com/" not in expanded and "twitter.com/" not in expanded:
            return expanded
    card = row.get("card") or {}
    return card.get("url") or ""


def normalize_quote(row: Any) -> dict[str, Any] | None:
    if not isinstance(row, dict) or not row.get("id"):
        return None
    author = normalize_author(row.get("author"))
    return {
        "id": str(row["id"]),
        "author": author["username"],
        "displayName": author["name"],
        "profilePicture": author["profilePicture"],
        "text": row.get("text") or "",
        "createdAt": iso_created(row["createdAt"]) if row.get("createdAt") else "",
        "url": row.get("url") or (f"https://x.com/{author['username']}/status/{row['id']}" if author["username"] else ""),
        "media": normalize_media(row.get("media")),
    }


def normalize(row: dict[str, Any]) -> dict[str, Any] | None:
    if not row.get("id") or not row.get("createdAt"):
        return None
    author = normalize_author(row.get("author"))
    is_reply = bool(row.get("isReply") or row.get("inReplyToId"))
    is_quote = bool(row.get("isQuoteStatus") or row.get("quotedTweetId"))
    kind = "reply" if is_reply else "quote" if is_quote else "post"
    post_id = str(row["id"])
    username = author["username"]
    return {
        "id": post_id,
        "createdAt": iso_created(row["createdAt"]),
        "author": username,
        "displayName": author["name"],
        "profilePicture": author["profilePicture"],
        "type": kind,
        "isQuote": is_quote,
        "text": row.get("text") or "",
        "url": row.get("url") or (f"https://x.com/{username}/status/{post_id}" if username else ""),
        "conversationId": str(row.get("conversationId") or post_id),
        "inReplyToId": str(row.get("inReplyToId") or ""),
        "inReplyToUsername": row.get("inReplyToUsername") or "",
        "quotedPost": normalize_quote(row.get("quotedTweet")),
        "media": normalize_media(row.get("media")),
        "externalUrl": first_external_url(row),
        "likeCount": row.get("likeCount") or 0,
        "replyCount": row.get("replyCount") or 0,
        "retweetCount": row.get("retweetCount") or 0,
        "quoteCount": row.get("quoteCount") or 0,
        "viewCount": row.get("viewCount") or 0,
        "bookmarkCount": row.get("bookmarkCount") or 0,
        "language": row.get("lang") or "",
        "possiblySensitive": bool(row.get("possiblySensitive")),
    }


def shard_name(record: dict[str, Any]) -> str:
    return record["createdAt"][:7]


def load_source_records() -> dict[str, dict[str, Any]]:
    records: dict[str, dict[str, Any]] = {}
    if not SOURCE_DATA.exists():
        return records
    for path in sorted(SOURCE_DATA.glob("posts-*.jsonl.gz")):
        with gzip.open(path, "rt") as source:
            for line in source:
                if line.strip():
                    record = json.loads(line)
                    records[record["id"]] = record
    return records


def save_source_records(records: dict[str, dict[str, Any]]) -> None:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records.values():
        grouped[shard_name(record)].append(record)
    SOURCE_DATA.mkdir(parents=True, exist_ok=True)
    expected = set()
    for month, items in grouped.items():
        path = SOURCE_DATA / f"posts-{month}.jsonl.gz"
        expected.add(path)
        items.sort(key=lambda item: item["createdAt"])
        with gzip.open(path, "wt", compresslevel=9) as output:
            for item in items:
                output.write(json.dumps(item, ensure_ascii=False, separators=(",", ":")) + "\n")
    for stale in SOURCE_DATA.glob("posts-*.jsonl.gz"):
        if stale not in expected:
            stale.unlink()


def import_legacy(raw_dir: Path) -> int:
    records = load_source_records()
    imported = 0
    for path in sorted(raw_dir.glob("*-xquik.json")):
        for row in read_json(path, []):
            record = normalize(row)
            if record:
                records[record["id"]] = record
                imported += 1
    save_source_records(records)
    accounts = read_json(CONFIG_PATH, {}).get("accounts", [])
    state = {
        "lastSuccessfulAt": max((item["createdAt"] for item in records.values()), default=""),
        "accounts": {username: {"latestPostId": ""} for username in accounts},
        "recordCount": len(records),
    }
    for username in accounts:
        authored = [item for item in records.values() if item["author"].lower() == username.lower()]
        if authored:
            latest = max(authored, key=lambda item: item["createdAt"])
            state["accounts"][username]["latestPostId"] = latest["id"]
    write_json(STATE_PATH, state, compact=False)
    return imported


def post_json(url: str, payload: dict[str, Any], *, headers: list[str] | None = None, timeout: int = 180) -> Any:
    command = [
        "curl", "--fail-with-body", "--silent", "--show-error", "--max-time", str(timeout),
        "-H", "Content-Type: application/json",
    ]
    for header in headers or []:
        command.extend(["-H", header])
    command.extend(["-X", "POST", "--data-binary", "@-", url])
    result = subprocess.run(command, input=json.dumps(payload).encode(), capture_output=True, check=False)
    if result.returncode:
        message = result.stdout.decode(errors="replace") or result.stderr.decode(errors="replace")
        raise RuntimeError(message[:1200])
    return json.loads(result.stdout)


def collect_from_apify(start: date, end: date) -> list[dict[str, Any]]:
    token = os.environ.get("APIFY_TOKEN")
    if not token:
        raise RuntimeError("APIFY_TOKEN is not configured")
    accounts = read_json(CONFIG_PATH, {}).get("accounts", [])
    if not accounts:
        raise RuntimeError("No accounts configured")
    queries = [f"from:{username} since:{start.isoformat()} until:{end.isoformat()} -filter:retweets" for username in accounts]
    params = urllib.parse.urlencode({
        "token": token,
        "format": "json",
        "clean": "true",
        "timeout": "900",
        "maxTotalChargeUsd": f"{MAX_CHARGE_USD:.2f}",
    })
    payload = {
        "mode": "search",
        "outputVariant": "rich",
        "fieldStyle": "camelCase",
        "searchTerms": queries,
        "maxItems": MAX_ITEMS,
    }
    return post_json(f"{APIFY_ENDPOINT}?{params}", payload, timeout=960)


def engagement(record: dict[str, Any]) -> float:
    return (
        math.log1p(record.get("likeCount") or 0) * 2
        + math.log1p(record.get("replyCount") or 0)
        + math.log1p(record.get("viewCount") or 0) * 0.25
    )


def topic_for(record: dict[str, Any]) -> str | None:
    text = record.get("text", "")
    if len(text.strip()) < 24 or not AI_ANCHOR.search(text):
        return None
    scores = [(len(pattern.findall(text)), topic) for topic, pattern in TOPIC_PATTERNS.items()]
    score, topic = max(scores)
    return topic if score else None


def public_record(record: dict[str, Any], topic: str | None = None) -> dict[str, Any]:
    keys = [
        "id", "createdAt", "author", "displayName", "profilePicture", "type", "isQuote", "text", "url",
        "conversationId", "inReplyToId", "inReplyToUsername", "quotedPost", "media", "externalUrl", "likeCount",
        "replyCount", "retweetCount", "quoteCount", "viewCount", "bookmarkCount", "language", "possiblySensitive",
    ]
    output = {key: record.get(key) for key in keys}
    if topic:
        output["topic"] = topic
    return output


def weekly_bounds(created: str) -> tuple[date, date]:
    day = parse_created(created).date()
    start = day - timedelta(days=day.weekday())
    return start, start + timedelta(days=6)


def extract_json(text: str) -> dict[str, Any]:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*|\s*```$", "", cleaned, flags=re.I)
    start = cleaned.find("{")
    end = cleaned.rfind("}")
    if start < 0 or end < start:
        raise ValueError("Gemini did not return a JSON object")
    return json.loads(cleaned[start:end + 1])


def summarize_week_with_gemini(week_id: str, sources: list[dict[str, Any]], existing: dict[str, Any] | None) -> dict[str, Any] | None:
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return None
    source_lines = []
    for item in sorted(sources, key=lambda value: engagement(value), reverse=True)[:160]:
        context = ""
        if item.get("quotedPost"):
            quote = item["quotedPost"]
            context = f" QUOTES @{quote.get('author')}: {quote.get('text')}"
        source_lines.append(f"[{item['id']}] @{item['author']}: {item['text']}{context}")
    prior = ""
    if existing:
        prior = f"\nPrevious draft to improve, not blindly preserve:\n{json.dumps({k: existing.get(k) for k in ['title','summary','details','takeaways']}, ensure_ascii=False)}"
    prompt = f"""You are editing a weekly AI engineering digest for {week_id}.
Use only the supplied posts. Summarize what people literally shipped, built, tested, recommended, disputed, or found. Name products, models, features, bugs, and tradeoffs. Do not discuss corpus size, rankings, active voices, source counts, or coverage. Do not invent.

Return one JSON object with:
- title: a specific 8-14 word headline
- summary: 2-3 specific sentences
- details: 3-5 substantive paragraphs
- takeaways: 3 short practical conclusions
- sourcePostIds: 5-12 supporting IDs copied exactly from the bracketed IDs

Every claim must be supported by at least one supplied post. Plain JSON only.{prior}

Posts:\n""" + "\n".join(source_lines)
    body = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
    }
    model = os.environ.get("GEMINI_MODEL", "gemini-3.6-flash")
    endpoint = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
    result = post_json(endpoint, body, headers=[f"x-goog-api-key: {key}"], timeout=180)
    text = result["candidates"][0]["content"]["parts"][0]["text"]
    summary = extract_json(text)
    valid_ids = {item["id"] for item in sources}
    cited = [str(value) for value in summary.get("sourcePostIds", [])]
    if not cited or any(value not in valid_ids for value in cited):
        raise RuntimeError("Gemini returned missing or invalid sourcePostIds")
    if not isinstance(summary.get("details"), list) or len(summary["details"]) < 3:
        raise RuntimeError("Gemini returned fewer than three detail paragraphs")
    return summary


def build_outputs(records: dict[str, dict[str, Any]], *, summarize_latest: bool) -> dict[str, Any]:
    ordered = sorted(records.values(), key=lambda item: item["createdAt"], reverse=True)
    topics = {item["id"]: topic_for(item) for item in ordered}
    ai_records = [item for item in ordered if topics[item["id"]]]

    # Browser archive shards keep initial search downloads small and cacheable.
    grouped_archive: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in ordered:
        grouped_archive[shard_name(item)].append(public_record(item, topics[item["id"]]))
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    expected_paths = set()
    archive_manifest = []
    for month, items in sorted(grouped_archive.items(), reverse=True):
        path = ARCHIVE_DIR / f"{month}.json"
        expected_paths.add(path)
        write_json(path, {"month": month, "records": items})
        archive_manifest.append({"month": month, "path": f"data/archive/{month}.json", "records": len(items)})
    for stale in ARCHIVE_DIR.glob("*.json"):
        if stale not in expected_paths:
            stale.unlink()

    # Conversation groups use every collected tracked-author post plus embedded quotes.
    conversation_groups: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in ai_records:
        conversation_groups[item.get("conversationId") or item["id"]].append(public_record(item, topics[item["id"]]))
    threads = {}
    for conversation_id, items in conversation_groups.items():
        items.sort(key=lambda item: item["createdAt"])
        if len(items) > 1 or any(item.get("inReplyToId") for item in items):
            threads[conversation_id] = items
    write_json(DATA_DIR / "threads.json", {"generatedAt": datetime.now(timezone.utc).isoformat(), "threads": threads})

    latest = []
    for item in ai_records[:300]:
        public = public_record(item, topics[item["id"]])
        public["threadSize"] = len(conversation_groups[item.get("conversationId") or item["id"]])
        latest.append(public)
    write_json(DATA_DIR / "latest.json", {"generatedAt": datetime.now(timezone.utc).isoformat(), "posts": latest})

    # Update theme source lists while preserving hand-edited topic prose.
    digest = read_json(DATA_DIR / "digest.json", {"themes": []})
    theme_lookup = {item["id"]: item for item in digest.get("themes", [])}
    for topic_id in TOPIC_PATTERNS:
        theme = theme_lookup.get(topic_id)
        if not theme:
            continue
        sources = []
        for item in ai_records:
            if topics[item["id"]] != topic_id:
                continue
            public = public_record(item, topic_id)
            public["threadSize"] = len(conversation_groups[item.get("conversationId") or item["id"]])
            sources.append(public)
        sources.sort(key=lambda item: (engagement(item), item["createdAt"]), reverse=True)
        authors = Counter(item["author"] for item in sources)
        profiles = {item["author"]: item.get("profilePicture", "") for item in sources}
        theme["sourceCount"] = len(sources)
        theme["authorCount"] = len(authors)
        theme["latestAt"] = max((item["createdAt"] for item in sources), default="")
        theme["topAuthors"] = [{"name": name, "count": count, "profilePicture": profiles.get(name, "")} for name, count in authors.most_common(5)]
        theme["sources"] = sources
    digest.update({
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "corpusRecords": len(ordered),
        "aiSourceRecords": len(ai_records),
        "themes": list(theme_lookup.values()),
    })
    write_json(DATA_DIR / "digest.json", digest)

    # Rebuild weekly source groups. Existing editorial copy remains unless Gemini refreshes the latest week.
    existing_weekly = read_json(DATA_DIR / "weekly.json", {"weeks": []})
    existing_by_id = {item["id"]: item for item in existing_weekly.get("weeks", [])}
    grouped_weeks: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for item in ai_records:
        start, _ = weekly_bounds(item["createdAt"])
        grouped_weeks[start.isoformat()].append(item)
    latest_week_id = max(grouped_weeks, default="")
    latest_existing_week = max(existing_by_id, default="")
    weeks = []
    for week_id, source_items in sorted(grouped_weeks.items(), reverse=True):
        if latest_existing_week and week_id not in existing_by_id and week_id <= latest_existing_week:
            continue
        start = date.fromisoformat(week_id)
        end = start + timedelta(days=6)
        existing = existing_by_id.get(week_id, {})
        editorial = None
        if summarize_latest and week_id == latest_week_id:
            editorial = summarize_week_with_gemini(week_id, source_items, existing)
        topic_counts = Counter(topics[item["id"]] for item in source_items)
        public_sources = []
        for item in source_items:
            public = public_record(item, topics[item["id"]])
            public["threadSize"] = len(conversation_groups[item.get("conversationId") or item["id"]])
            public_sources.append(public)
        public_sources.sort(key=lambda item: (engagement(item), item["createdAt"]), reverse=True)
        authors = Counter(item["author"] for item in public_sources)
        profiles = {item["author"]: item.get("profilePicture", "") for item in public_sources}
        fallback_title = existing.get("title") or f"AI engineering notes for the week of {start.strftime('%B %-d')}"
        fallback_summary = existing.get("summary") or "New source posts are available. Editorial synthesis is pending."
        details = editorial.get("details") if editorial else existing.get("details", [])
        takeaways = editorial.get("takeaways") if editorial else existing.get("takeaways", [])
        weeks.append({
            "id": week_id,
            "eyebrow": "Weekly AI digest",
            "title": editorial.get("title") if editorial else fallback_title,
            "summary": editorial.get("summary") if editorial else fallback_summary,
            "details": details,
            "takeaways": takeaways,
            "accent": existing.get("accent", "violet"),
            "weekStart": week_id,
            "weekEnd": end.isoformat(),
            "sourceCount": len(public_sources),
            "authorCount": len(authors),
            "themeBreakdown": [
                {"id": topic, "label": topic.replace("-", " "), "count": count}
                for topic, count in topic_counts.most_common()
            ],
            "topAuthors": [{"name": name, "count": count, "profilePicture": profiles.get(name, "")} for name, count in authors.most_common(5)],
            "sourcePostIds": editorial.get("sourcePostIds", []) if editorial else existing.get("sourcePostIds", []),
            "sources": public_sources,
        })
    weekly_payload = {"generatedAt": datetime.now(timezone.utc).isoformat(), "weeks": weeks}
    write_json(DATA_DIR / "weekly.json", weekly_payload)

    manifest = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "latestWeek": latest_week_id,
        "recordCount": len(ordered),
        "aiRecordCount": len(ai_records),
        "threadCount": len(threads),
        "accounts": sorted({item["author"] for item in ordered}, key=str.lower),
        "archive": archive_manifest,
    }
    write_json(DATA_DIR / "manifest.json", manifest, compact=False)
    return manifest


def update() -> dict[str, Any]:
    existing = load_source_records()
    state = read_json(STATE_PATH, {})
    if state.get("lastSuccessfulAt"):
        start = parse_created(state["lastSuccessfulAt"]).date() - timedelta(days=OVERLAP_DAYS)
    elif existing:
        start = parse_created(max(item["createdAt"] for item in existing.values())).date() - timedelta(days=OVERLAP_DAYS)
    else:
        start = date.today() - timedelta(days=7)
    end = datetime.now(timezone.utc).date() + timedelta(days=1)
    rows = collect_from_apify(start, end)
    accepted = 0
    accounts = {name.lower() for name in read_json(CONFIG_PATH, {}).get("accounts", [])}
    for row in rows:
        record = normalize(row)
        if not record or record["author"].lower() not in accounts:
            continue
        existing[record["id"]] = record
        accepted += 1
    if rows and not accepted:
        raise RuntimeError("Apify returned records, but none matched configured accounts")
    save_source_records(existing)
    manifest = build_outputs(existing, summarize_latest=True)
    next_state = {
        "lastSuccessfulAt": datetime.now(timezone.utc).isoformat(),
        "recordCount": len(existing),
        "lastRun": {"start": start.isoformat(), "end": end.isoformat(), "rawRecords": len(rows), "acceptedRecords": accepted},
        "accounts": state.get("accounts", {}),
    }
    for username in accounts:
        authored = [item for item in existing.values() if item["author"].lower() == username]
        if authored:
            latest = max(authored, key=lambda item: item["createdAt"])
            next_state["accounts"].setdefault(username, {})["latestPostId"] = latest["id"]
    write_json(STATE_PATH, next_state, compact=False)
    return {**manifest, **next_state["lastRun"]}


def validate() -> dict[str, int]:
    manifest = read_json(DATA_DIR / "manifest.json")
    latest = read_json(DATA_DIR / "latest.json")
    weekly = read_json(DATA_DIR / "weekly.json")
    digest = read_json(DATA_DIR / "digest.json")
    threads = read_json(DATA_DIR / "threads.json")
    if not manifest or not latest or not weekly or not digest or not threads:
        raise RuntimeError("One or more generated data files are missing")
    post_ids = set()
    for shard in manifest["archive"]:
        payload = read_json(ROOT / shard["path"])
        if len(payload["records"]) != shard["records"]:
            raise RuntimeError(f"Archive count mismatch in {shard['path']}")
        for item in payload["records"]:
            if item["id"] in post_ids:
                raise RuntimeError(f"Duplicate post ID {item['id']}")
            post_ids.add(item["id"])
    if len(post_ids) != manifest["recordCount"]:
        raise RuntimeError("Manifest record count does not match archive")
    for week in weekly["weeks"]:
        if week["sourceCount"] != len(week["sources"]):
            raise RuntimeError(f"Weekly source count mismatch in {week['id']}")
        if any(item["id"] not in post_ids for item in week["sources"]):
            raise RuntimeError(f"Unknown source in week {week['id']}")
        if week.get("sourcePostIds") and any(value not in post_ids for value in week["sourcePostIds"]):
            raise RuntimeError(f"Unknown editorial citation in week {week['id']}")
    return {
        "records": len(post_ids),
        "latest": len(latest["posts"]),
        "weeks": len(weekly["weeks"]),
        "themes": len(digest["themes"]),
        "threads": len(threads["threads"]),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    bootstrap = subparsers.add_parser("bootstrap")
    bootstrap.add_argument("--raw-dir", type=Path, required=True)
    build = subparsers.add_parser("build")
    build.add_argument("--summarize-latest", action="store_true")
    subparsers.add_parser("update")
    subparsers.add_parser("validate")
    args = parser.parse_args()

    if args.command == "bootstrap":
        imported = import_legacy(args.raw_dir)
        print(json.dumps({"imported": imported, "records": len(load_source_records())}))
    elif args.command == "build":
        print(json.dumps(build_outputs(load_source_records(), summarize_latest=args.summarize_latest)))
    elif args.command == "update":
        print(json.dumps(update()))
    elif args.command == "validate":
        print(json.dumps(validate()))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        print(f"pipeline failed: {error}", file=sys.stderr)
        raise
