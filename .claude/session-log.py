#!/usr/bin/env python3
"""
cc-service-calculator AI session logger.

Fires on every Claude Code Stop event for this repo.
Logs every session regardless of whether commits were made.

- Reads the most recent JSONL for token + duration data (AI time, not human time)
- Gets commits since last session for the ClickUp task description (optional)
- POSTs to the log-ai-session Supabase edge function, which:
    - Creates a ClickUp task in The Converted Click > Ops (server-side PAT)
    - Writes a row to ai_sessions
- JSONL UUID deduplication prevents double-logging the same session

human_minutes = 0 always — this is AI-only telemetry.
Human time is logged separately via /log.
"""

import json, os, glob, sys, subprocess, urllib.request, urllib.error
from datetime import datetime, timezone

# ── Config ────────────────────────────────────────────────────────────────

REPO_ROOT        = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKPOINT_FILE  = os.path.join(REPO_ROOT, ".claude", "last-logged-sha")
EDGE_FN_URL      = "https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/log-ai-session"
LOGGED_BY        = "brendan@convertedclick.co.za"

INPUT_COST_PER_M        = 3.0    # USD/M — standard input tokens
CACHE_WRITE_COST_PER_M  = 3.75   # USD/M — cache creation (25% premium)
CACHE_READ_COST_PER_M   = 0.30   # USD/M — cache read (90% discount)
OUTPUT_COST_PER_M       = 15.0   # USD/M — output tokens
ZAR_PER_USD             = 18.5

# ── Git helpers ───────────────────────────────────────────────────────────

def run(cmd):
    return subprocess.run(cmd, capture_output=True, text=True).stdout.strip()

def get_current_sha():
    return run(["git", "-C", REPO_ROOT, "rev-parse", "HEAD"])

def get_commits_since_checkpoint():
    """Return commits since last logged session — used for task description only."""
    since = None
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            since = f.read().strip()

    fmt = "--format=%h\t%s"
    if since:
        raw = run(["git", "-C", REPO_ROOT, "log", f"{since}..HEAD", "--no-merges", fmt])
    else:
        raw = run(["git", "-C", REPO_ROOT, "log", "--no-merges", "--since=24 hours ago", fmt])

    commits = []
    for line in raw.splitlines():
        line = line.strip()
        if "\t" in line:
            sha, subject = line.split("\t", 1)
            commits.append((sha.strip(), subject.strip()))
    return commits

# ── JSONL helpers ─────────────────────────────────────────────────────────

def get_jsonl_data(hook_data=None):
    # Use transcript_path from hook payload if available — exact file, no guessing
    path = None
    if hook_data:
        path = hook_data.get("transcript_path")

    if not path or not os.path.exists(path):
        files = sorted(
            glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")),
            key=os.path.getmtime, reverse=True
        )
        if not files:
            return 0, 0, 0.0, "cc-service-calculator", None, None, None
        path = files[0]

    print(f"[session-log] using JSONL: {os.path.basename(path)}", file=sys.stderr)
    project_slug = os.path.basename(os.path.dirname(path))
    jsonl_id = os.path.splitext(os.path.basename(path))[0]

    lines = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    lines.append(json.loads(line))
                except Exception:
                    pass

    def usage(l):
        return l.get("message", {}).get("usage", {})

    input_tokens       = sum(usage(l).get("input_tokens", 0)                for l in lines if l.get("type") == "assistant")
    cache_write_tokens = sum(usage(l).get("cache_creation_input_tokens", 0) for l in lines if l.get("type") == "assistant")
    cache_read_tokens  = sum(usage(l).get("cache_read_input_tokens", 0)     for l in lines if l.get("type") == "assistant")
    output_tokens      = sum(usage(l).get("output_tokens", 0)               for l in lines if l.get("type") == "assistant")
    total_input_tokens = input_tokens + cache_write_tokens + cache_read_tokens

    # Active duration: sum gaps ≤ 30 min (excludes idle/lunch, includes subagent runs)
    IDLE_THRESHOLD_SECS = 1800
    timestamps = [l["timestamp"] for l in lines if "timestamp" in l]
    duration_minutes = 0.0
    session_start_iso = timestamps[0] if timestamps else None
    if len(timestamps) >= 2:
        try:
            parsed = [datetime.fromisoformat(t.replace("Z", "+00:00")) for t in timestamps]
            active_secs = sum(
                (parsed[i] - parsed[i - 1]).total_seconds()
                for i in range(1, len(parsed))
                if (parsed[i] - parsed[i - 1]).total_seconds() <= IDLE_THRESHOLD_SECS
            )
            duration_minutes = round(active_secs / 60, 1)
        except Exception:
            pass

    # Extract Claude's auto-generated session title
    ai_title = None
    for l in lines:
        if l.get("type") == "ai-title" and l.get("aiTitle"):
            ai_title = l["aiTitle"]
            break

    return total_input_tokens, cache_write_tokens, cache_read_tokens, output_tokens, duration_minutes, project_slug, session_start_iso, jsonl_id, ai_title

# ── Formatting ────────────────────────────────────────────────────────────

def build_task_name(commits, session_date, ai_title=None):
    # Prefer Claude's auto-generated session title
    if ai_title:
        return ai_title
    # Fall back to most recent commit subject
    if commits:
        subjects = [s for _, s in commits]
        if len(subjects) == 1:
            return subjects[0]
        return f"{subjects[0]}  (+{len(subjects) - 1} more)"
    return f"AI session — {session_date}"

def build_description(commits, input_tokens, output_tokens, duration_minutes, ai_cost_zar):
    lines = []
    if commits:
        lines.append("## Commits this session\n")
        for sha, subject in commits:
            lines.append(f"- `{sha}` {subject}")
        lines.append("")
    lines += [
        "## AI telemetry",
        f"- Input tokens: {input_tokens:,}",
        f"- Output tokens: {output_tokens:,}",
        f"- Session duration: {duration_minutes:.1f} min",
        f"- Estimated cost: R{ai_cost_zar:.2f}",
        "\n_human_minutes = 0 — log human time separately via /log_",
    ]
    return "\n".join(lines)

# ── Edge function call ────────────────────────────────────────────────────

def post_to_edge(payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(
        EDGE_FN_URL, data=data,
        headers={"Content-Type": "application/json"},
        method="POST"
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception as e:
        return 0, {"error": str(e)}

# ── Main ──────────────────────────────────────────────────────────────────

def main():
    # Read hook payload from stdin (Claude Code passes session context here)
    hook_data = {}
    if not sys.stdin.isatty():
        try:
            raw = sys.stdin.read()
            if raw.strip():
                hook_data = json.loads(raw)
                print(f"[session-log] hook payload: {json.dumps(hook_data)}", file=sys.stderr)
        except Exception as e:
            print(f"[session-log] stdin parse error: {e}", file=sys.stderr)

    total_input, cache_write, cache_read, output_tokens, duration_minutes, project_slug, session_start_iso, jsonl_id, ai_title = get_jsonl_data(hook_data)

    if not jsonl_id:
        return

    session_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    ai_cost_zar = round((
        (total_input - cache_write - cache_read) * INPUT_COST_PER_M +
        cache_write * CACHE_WRITE_COST_PER_M +
        cache_read  * CACHE_READ_COST_PER_M +
        output_tokens * OUTPUT_COST_PER_M
    ) / 1_000_000 * ZAR_PER_USD, 2)
    input_tokens = total_input  # use total for Supabase storage

    # Commits are metadata for the task description, not a gate
    commits      = get_commits_since_checkpoint()
    task_name    = build_task_name(commits, session_date, ai_title)
    description  = build_description(commits, input_tokens, output_tokens, duration_minutes, ai_cost_zar)

    payload = {
        "logged_by":                LOGGED_BY,
        "session_date":             session_date,
        "project_slug":             project_slug,
        "ai_input_tokens":          input_tokens,
        "ai_output_tokens":         output_tokens,
        "ai_duration_minutes":      duration_minutes,
        "ai_cost_zar":              ai_cost_zar,
        "human_minutes":            0,
        "concurrent_sessions":      1,
        "engagement_type":          "task",
        "create_clickup_task":      True,
        "clickup_task_name":        task_name,
        "clickup_task_description": description,
        "ai_session_start_iso":     session_start_iso,
        "jsonl_id":                 jsonl_id,
    }

    status, body = post_to_edge(payload)
    ok = status in (200, 201)

    # Update checkpoint regardless — commits are labelled correctly next session
    current_sha = get_current_sha()
    if current_sha:
        save_checkpoint(current_sha)

    if body.get("duplicate"):
        print(f"[session-log] duplicate — already logged (jsonl_id={jsonl_id})", file=sys.stderr)
    else:
        cu_id  = body.get("clickup_task_id")
        cu_url = f"https://app.clickup.com/t/{cu_id}" if cu_id else "no ClickUp task"
        commit_label = f"{len(commits)} commit(s)" if commits else "no commits"
        print(
            f"[session-log] {commit_label} · "
            f"{input_tokens:,}in/{output_tokens:,}out · "
            f"{duration_minutes:.0f}min · R{ai_cost_zar:.2f} · "
            f"{'✓' if ok else '⚠'} {cu_url}",
            file=sys.stderr
        )

def save_checkpoint(sha):
    os.makedirs(os.path.dirname(CHECKPOINT_FILE), exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        f.write(sha)

if __name__ == "__main__":
    main()
