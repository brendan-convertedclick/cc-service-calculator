# Inbox relay — Apps Script setup

One-time per teammate, ~5 minutes. Pipes labelled Gmail threads into the calculator's Inbox.

## 1. Get a relay token

In the calculator: **Settings → Connect Gmail → Generate token**. The token shows once. Copy it.

## 2. Create the Apps Script project

1. Open <https://script.google.com/create>.
2. Replace the editor contents with `inbox-relay.gs` from this repo.
3. Rename the project (top-left): "CC Inbox Relay".

## 3. Set Script Properties

**Project Settings (gear icon) → Script Properties → Add script property:**

- `RELAY_URL` = `https://lpgwxacoqiqpcfpkklib.supabase.co/functions/v1/gmail-relay`
- `RELAY_USER` = your Converted Click email (e.g. `brendan@convertedclick.co.za`)
- `RELAY_SECRET` = the token from step 1

## 4. Run `setup()`

In the Apps Script editor: select `setup` from the function dropdown → **Run**. Authorise the requested Gmail scopes when prompted.

Expected: 3 labels appear in your Gmail (`→Inbox/Push`, `→Inbox/Push-Sent`, `→Inbox/Pushed`) and a 5-min trigger is installed.

## 5. Test it

1. Forward yourself any email.
2. In Gmail, label the thread `→Inbox/Push`.
3. Wait ≤ 5 min, or in the Apps Script editor select `forceSync` → **Run** to push immediately.
4. The thread should appear in the calculator Inbox; the label should switch to `→Inbox/Pushed`.

## Troubleshooting

- **Token invalid / 401**: Regenerate in Settings → Connect Gmail; update `RELAY_SECRET`.
- **No threads getting pushed**: Apps Script editor → **Executions** tab → check most recent `pushPendingThreads` for log output.
- **OAuth scope reset**: Re-run `setup()` and re-authorise.
