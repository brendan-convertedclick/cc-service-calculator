// Apps Script — Inbox relay.
// Pastes into script.google.com/create. Set RELAY_URL, RELAY_USER, RELAY_SECRET
// in Script Properties (Project Settings → Script Properties).
//
// Labels created: →Inbox/Push (inbound), →Inbox/Push-Sent (outbound), →Inbox/Pushed (terminal).
// Trigger: every 5 min (created by setup()).

const PROPS = PropertiesService.getScriptProperties();

function setup() {
  // 1. Create labels if missing.
  ensureLabel('→Inbox/Push');
  ensureLabel('→Inbox/Push-Sent');
  ensureLabel('→Inbox/Pushed');

  // 2. Install 5-min trigger if not already installed.
  const existing = ScriptApp.getProjectTriggers().find(t => t.getHandlerFunction() === 'pushPendingThreads');
  if (!existing) {
    ScriptApp.newTrigger('pushPendingThreads').timeBased().everyMinutes(5).create();
    Logger.log('Installed 5-min trigger.');
  } else {
    Logger.log('Trigger already installed.');
  }
}

function ensureLabel(name) {
  const existing = GmailApp.getUserLabelByName(name);
  if (!existing) GmailApp.createLabel(name);
}

function pushPendingThreads() {
  const RELAY_URL = PROPS.getProperty('RELAY_URL');
  const RELAY_USER = PROPS.getProperty('RELAY_USER');
  const RELAY_SECRET = PROPS.getProperty('RELAY_SECRET');
  if (!RELAY_URL || !RELAY_USER || !RELAY_SECRET) {
    Logger.log('Missing Script Properties — set RELAY_URL/RELAY_USER/RELAY_SECRET.');
    return;
  }

  const pushLabel = GmailApp.getUserLabelByName('→Inbox/Push');
  const pushSentLabel = GmailApp.getUserLabelByName('→Inbox/Push-Sent');
  const pushedLabel = GmailApp.getUserLabelByName('→Inbox/Pushed');

  const query = '(label:"→Inbox/Push" OR label:"→Inbox/Push-Sent") -label:"→Inbox/Pushed"';
  const threads = GmailApp.search(query, 0, 25); // Cap per run; trigger comes back in 5 min.

  for (const t of threads) {
    try {
      const labels = t.getLabels().map(l => l.getName());
      const isInbound = labels.includes('→Inbox/Push');
      const isOutbound = labels.includes('→Inbox/Push-Sent');

      const body = buildPayload(t, isInbound, isOutbound, RELAY_USER);
      const bodyStr = JSON.stringify(body);
      const sig = computeHmac(bodyStr, RELAY_SECRET);

      const res = UrlFetchApp.fetch(RELAY_URL, {
        method: 'post',
        contentType: 'application/json',
        headers: {
          'x-relay-user': RELAY_USER,
          'x-relay-signature': sig,
        },
        payload: bodyStr,
        muteHttpExceptions: true,
      });

      if (res.getResponseCode() >= 200 && res.getResponseCode() < 300) {
        t.addLabel(pushedLabel);
        if (isInbound) t.removeLabel(pushLabel);
        if (isOutbound) t.removeLabel(pushSentLabel);
      } else {
        Logger.log('Relay failed for thread ' + t.getId() + ': ' + res.getResponseCode() + ' ' + res.getContentText());
      }
    } catch (e) {
      Logger.log('Error on thread ' + t.getId() + ': ' + e);
    }
  }
}

function buildPayload(thread, isInbound, isOutbound, relayUser) {
  const messages = thread.getMessages().map(m => {
    // Direction: a thread can be mixed; per-message decision via from address.
    const fromEmail = parseEmail(m.getFrom()).email;
    const direction = (fromEmail.toLowerCase() === relayUser.toLowerCase()) ? 'outbound' : 'inbound';
    return {
      message_id: m.getId(),
      direction: direction,
      from: parseEmail(m.getFrom()),
      to: splitAddrs(m.getTo()),
      cc: splitAddrs(m.getCc()),
      subject: m.getSubject(),
      sent_at: m.getDate().toISOString(),
      body_text: m.getPlainBody(),
      body_html: m.getBody(),
      attachments: m.getAttachments({ includeInlineImages: false }).map(a => ({
        name: a.getName(),
        mime: a.getContentType(),
        size: a.getSize(),
        base64: Utilities.base64Encode(a.getBytes()),
      })),
    };
  });

  // If thread has both labels at once, default decision was per-message above;
  // isInbound/isOutbound here just inform the bookkeeping (which labels to strip).
  return {
    thread_id: thread.getId(),
    thread_subject: thread.getFirstMessageSubject(),
    messages: messages,
  };
}

function parseEmail(s) {
  // "Alice <alice@x>" → { email: 'alice@x', name: 'Alice' }
  const m = s && s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { email: m[2].trim(), name: m[1].trim() };
  return { email: (s || '').trim(), name: undefined };
}

function splitAddrs(s) {
  if (!s) return [];
  return s.split(',').map(x => parseEmail(x).email).filter(Boolean);
}

function computeHmac(message, secret) {
  const sig = Utilities.computeHmacSha256Signature(message, secret);
  return sig.map(b => {
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

// Manual force-sync — useful when waiting on a 5-min cycle is too slow.
function forceSync() { pushPendingThreads(); }
