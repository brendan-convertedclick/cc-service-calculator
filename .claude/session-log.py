#!/usr/bin/env python3
"""
cc-service-calculator AI session logger.

Fires on every Claude Code Stop event for this repo.
- Reads the most recent JSONL for token + duration data (AI time, not human time)
- Gets commits made since the last logged session (checkpoint-based)
- Creates a ClickUp task in The Converted Click > Ops
- Writes a row to ai_sessions in Supabase via the log-ai-session edge function

human_minutes = 0 always — this is AI-only telemetry.
Human time is logged separately via /log.
"""

import json, os, glob, sys, subprocess, urllib.request, urllib.error
from datetime import datetime, timezone

# ── Fixed config ────────────────────────────────────────────────────────────

REPO_ROOT       = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CHECKPOINT_FILE = os.path.join(REPO_ROOT, ".claude", "last-logged-sha")

SUPABASE_URL    = "https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/log-ai-session"
CLICKUP_LIST_ID = "901217934382"   # The Converted Click > Ops
LOGGED_BY       = "brendan@convertedclick.co.za"
BRENDAN_CU_ID   = 4619351          # numeric ClickUp user ID

# Pre-resolved ClickUp custom field option IDs (The Converted Click, Development, Task)
CUSTOM_FIELDS_STATIC = [
    # Client Name = The Converted Click
    {"id": "cb85dec8-42eb-46d2-89da-f8deb943377a", "value": "a34ba210-42a2-473e-8279-f45fabeb9b44"},
    # Engagement Type = Task
    {"id": "3bf088b1-392b-4e4f-8831-16d94bbc81d7", "value": "793953f6-0c73-4a2c-9b90-7fd879732876"},
    # Work Stream = Development
    {"id": "f4b5fb8a-c237-4c7e-8fec-bf48c6d8d38b", "value": "18a513e0-936a-4da0-8163-53d4904d3d6e"},
]
DATE_FIELD_ID = "c432caf3-3bb0-4423-bd5f-684639bef9aa"

# Claude Sonnet 4.6 pricing (USD per million tokens), ZAR/USD rate
INPUT_COST_PER_M  = 3.0
OUTPUT_COST_PER_M = 15.0
ZAR_PER_USD       = 18.5

# ── Helpers ──────────────────────────────────────────────────────────────────

def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    return r.stdout.strip()

def get_current_sha():
    return run(["git", "-C", REPO_ROOT, "rev-parse", "HEAD"])

def get_commits_since_checkpoint():
    """Return list of (sha_short, subject) tuples for commits not yet logged."""
    since = None
    if os.path.exists(CHECKPOINT_FILE):
        with open(CHECKPOINT_FILE) as f:
            since = f.read().strip()

    if since:
        # Commits between the checkpoint and HEAD (exclusive of checkpoint)
        raw = run(["git", "-C", REPO_ROOT, "log",
                   f"{since}..HEAD", "--no-merges",
                   "--format=%h\t%s"])
    else:
        # First run: take commits from the past 24 hours
        raw = run(["git", "-C", REPO_ROOT, "log",
                   "--no-merges", "--since=24 hours ago",
                   "--format=%h\t%s"])

    if not raw:
        return []

    commits = []
    for line in raw.splitlines():
        line = line.strip()
        if "\t" in line:
            sha, subject = line.split("\t", 1)
            commits.append((sha.strip(), subject.strip()))
    return commits

def get_jsonl_data():
    """Parse the most recent JSONL for tokens, duration, and project slug."""
    files = sorted(
        glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")),
        key=os.path.getmtime, reverse=True
    )
    if not files:
        return 0, 0, 0.0, "cc-service-calculator"

    path = files[0]
    project_slug = os.path.basename(os.path.dirname(path))

    lines = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    lines.append(json.loads(line))
                except Exception:
                    pass

    input_tokens = sum(
        l.get("message", {}).get("usage", {}).get("input_tokens", 0)
        for l in lines if l.get("type") == "assistant"
    )
    output_tokens = sum(
        l.get("message", {}).get("usage", {}).get("output_tokens", 0)
        for l in lines if l.get("type") == "assistant"
    )

    timestamps = [l["timestamp"] for l in lines if "timestamp" in l]
    duration_minutes = 0.0
    if len(timestamps) >= 2:
        try:
            first = datetime.fromisoformat(timestamps[0].replace("Z", "+00:00"))
            last  = datetime.fromisoformat(timestamps[-1].replace("Z", "+00:00"))
            duration_minutes = round((last - first).total_seconds() / 60, 1)
        except Exception:
            pass

    return input_tokens, output_tokens, duration_minutes, project_slug

def compute_cost_zar(input_tokens, output_tokens):
    usd = (input_tokens * INPUT_COST_PER_M + output_tokens * OUTPUT_COST_PER_M) / 1_000_000
    return round(usd * ZAR_PER_USD, 2)

def build_task_name(commits):
    """One-line summary: most recent subject + overflow count."""
    if not commits:
        return "AI session (no commits)"
    subjects = [s for _, s in commits]
    if len(subjects) == 1:
        return subjects[0]
    # Most recent commit is first in git log output
    return f"{subjects[0]}  (+{len(subjects) - 1} more)"

def build_description(commits, input_tokens, output_tokens, duration_minutes, ai_cost_zar):
    lines = ["## Commits this session\n"]
    for sha, subject in commits:
        lines.append(f"- `{sha}` {subject}")
    lines.append(f"\n## AI telemetry")
    lines.append(f"- Input tokens: {input_tokens:,}")
    lines.append(f"- Output tokens: {output_tokens:,}")
    lines.append(f"- Session duration: {duration_minutes:.1f} min")
    lines.append(f"- Estimated cost: R{ai_cost_zar:.2f}")
    lines.append(f"\n_human_minutes = 0 — log human time separately via /log_")
    return "\n".join(lines)

def post_json(url, payload, headers):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, {}
    except Exception:
        return 0, {}

def create_clickup_task(name, description, session_date_ms):
    pat = os.environ.get("CLICKUP_PAT", "")
    if not pat:
        return None

    fields = CUSTOM_FIELDS_STATIC + [
        {"id": DATE_FIELD_ID, "value": str(session_date_ms)}
    ]

    payload = {
        "name": name,
        "markdown_description": description,
        "assignees": [BRENDAN_CU_ID],
        "status": "closed",
        "custom_fields": fields,
    }

    status, body = post_json(
        f"https://api.clickup.com/api/v2/list/{CLICKUP_LIST_ID}/task",
        payload,
        {"Authorization": pat, "Content-Type": "application/json"},
    )

    if status in (200, 201):
        task_id = body.get("id")
        # If status=closed was rejected, try a follow-up PUT
        if body.get("status", {}).get("status", "").lower() not in ("closed", "complete"):
            put_req = urllib.request.Request(
                f"https://api.clickup.com/api/v2/task/{task_id}",
                data=json.dumps({"status": "closed"}).encode(),
                headers={"Authorization": pat, "Content-Type": "application/json"},
                method="PUT"
            )
            try:
                urllib.request.urlopen(put_req, timeout=5)
            except Exception:
                pass
        return task_id
    return None

def write_supabase(session_date, project_slug, input_tokens, output_tokens,
                   duration_minutes, ai_cost_zar, clickup_task_id):
    payload = {
        "logged_by": LOGGED_BY,
        "session_date": session_date,
        "project_slug": project_slug,
        "ai_input_tokens": input_tokens,
        "ai_output_tokens": output_tokens,
        "ai_duration_minutes": duration_minutes,
        "ai_cost_zar": ai_cost_zar,
        "human_minutes": 0,
        "concurrent_sessions": 1,
        "engagement_type": "task",
    }
    if clickup_task_id:
        payload["clickup_task_id"] = clickup_task_id

    status, _ = post_json(SUPABASE_URL, payload, {"Content-Type": "application/json"})
    return status in (200, 201)

def save_checkpoint(sha):
    os.makedirs(os.path.dirname(CHECKPOINT_FILE), exist_ok=True)
    with open(CHECKPOINT_FILE, "w") as f:
        f.write(sha)

# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    commits = get_commits_since_checkpoint()
    current_sha = get_current_sha()

    if not commits:
        # Nothing new committed this session — update checkpoint and exit silently
        if current_sha:
            save_checkpoint(current_sha)
        return

    now_utc = datetime.now(timezone.utc)
    session_date = now_utc.strftime("%Y-%m-%d")
    session_date_ms = int(now_utc.replace(hour=0, minute=0, second=0, microsecond=0).timestamp() * 1000)

    input_tokens, output_tokens, duration_minutes, project_slug = get_jsonl_data()
    ai_cost_zar = compute_cost_zar(input_tokens, output_tokens)

    task_name   = build_task_name(commits)
    description = build_description(commits, input_tokens, output_tokens, duration_minutes, ai_cost_zar)

    clickup_task_id = create_clickup_task(task_name, description, session_date_ms)
    sb_ok = write_supabase(session_date, project_slug, input_tokens, output_tokens,
                           duration_minutes, ai_cost_zar, clickup_task_id)

    # Update checkpoint so next session doesn't re-log these commits
    if current_sha:
        save_checkpoint(current_sha)

    # Print summary to stderr (visible in Claude Code hook output)
    cu_url = f"https://app.clickup.com/t/{clickup_task_id}" if clickup_task_id else "ClickUp skipped (no PAT)"
    sb_status = "✓" if sb_ok else "⚠ failed"
    print(
        f"[session-log] {len(commits)} commit(s) · "
        f"{input_tokens:,} in / {output_tokens:,} out · "
        f"{duration_minutes:.0f}min · R{ai_cost_zar:.2f} · "
        f"CU: {cu_url} · Supabase: {sb_status}",
        file=sys.stderr
    )

if __name__ == "__main__":
    main()
