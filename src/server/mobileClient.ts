/**
 * Single-file mobile web client for Void.
 *
 * Served at GET /m when mobile mode is enabled. Kept inline so the server
 * doesn't need a static-file pipeline or build step — the entire client is
 * one string of HTML/CSS/JS.
 *
 * The client expects the pairing token in the URL fragment (#token=...).
 * It POSTs messages to /chat/stream and renders the SSE response
 * incrementally.
 */

export const MOBILE_CLIENT_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<meta name="theme-color" content="#0b0b0f" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
<title>Void</title>
<style>
  :root {
    --bg: #0b0b0f;
    --panel: #15151d;
    --border: #25252f;
    --text: #e8e8ee;
    --dim: #8a8a96;
    --accent: #8ab4ff;
    --user: #1e2638;
    --error: #ff6b6b;
  }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0; height: 100%;
    background: var(--bg); color: var(--text);
    font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    font-size: 16px;
    -webkit-font-smoothing: antialiased;
    overscroll-behavior: none;
  }
  body {
    display: flex; flex-direction: column;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid var(--border);
    background: var(--panel);
  }
  header .title { font-weight: 600; letter-spacing: 0.02em; }
  header .status { font-size: 12px; color: var(--dim); }
  header .status.ok::before { content: "● "; color: #6bd58a; }
  header .status.err::before { content: "● "; color: var(--error); }
  #log {
    flex: 1; overflow-y: auto;
    padding: 16px; display: flex; flex-direction: column; gap: 12px;
  }
  .msg {
    max-width: 85%; padding: 10px 14px; border-radius: 14px;
    white-space: pre-wrap; word-wrap: break-word; line-height: 1.45;
  }
  .msg.user { align-self: flex-end; background: var(--user); }
  .msg.assistant { align-self: flex-start; background: var(--panel); border: 1px solid var(--border); }
  .msg.error { align-self: flex-start; background: #2a1416; border: 1px solid #5a2224; color: var(--error); }
  .tool {
    align-self: flex-start; max-width: 85%;
    padding: 8px 12px; border-radius: 10px;
    background: #101018; border: 1px solid var(--border);
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 13px; color: var(--dim);
  }
  .tool .name { color: var(--accent); }
  form {
    display: flex; gap: 8px; padding: 10px;
    border-top: 1px solid var(--border);
    background: var(--panel);
  }
  textarea {
    flex: 1; resize: none;
    min-height: 40px; max-height: 160px;
    padding: 10px 12px; border-radius: 10px;
    background: var(--bg); color: var(--text);
    border: 1px solid var(--border);
    font-size: 16px; font-family: inherit;
  }
  textarea:focus { outline: none; border-color: var(--accent); }
  button {
    padding: 0 16px; border-radius: 10px;
    background: var(--accent); color: #0b0b0f;
    border: none; font-weight: 600; font-size: 15px;
    cursor: pointer;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .cursor::after {
    content: "▊"; color: var(--accent);
    animation: blink 1s steps(2) infinite; margin-left: 2px;
  }
  @keyframes blink { 50% { opacity: 0; } }
</style>
</head>
<body>
<header>
  <div class="title">void</div>
  <div class="status" id="status">connecting…</div>
</header>
<div id="log" aria-live="polite"></div>
<form id="form">
  <textarea id="input" placeholder="Ask void…" autocomplete="off" enterkeyhint="send"></textarea>
  <button type="submit" id="send">Send</button>
</form>
<script>
(function () {
  var token = (location.hash.match(/token=([a-f0-9]+)/) || [])[1] || '';
  var $log = document.getElementById('log');
  var $input = document.getElementById('input');
  var $send = document.getElementById('send');
  var $form = document.getElementById('form');
  var $status = document.getElementById('status');
  var sessionId = sessionStorage.getItem('void.sessionId') || '';
  var streaming = false;

  function setStatus(text, cls) {
    $status.textContent = text;
    $status.className = 'status ' + (cls || '');
  }

  function addMsg(role, text) {
    var el = document.createElement('div');
    el.className = 'msg ' + role;
    el.textContent = text;
    $log.appendChild(el);
    $log.scrollTop = $log.scrollHeight;
    return el;
  }

  function addTool(name) {
    var el = document.createElement('div');
    el.className = 'tool';
    el.innerHTML = '<span class="name"></span> <span class="detail"></span>';
    el.querySelector('.name').textContent = name;
    $log.appendChild(el);
    $log.scrollTop = $log.scrollHeight;
    return el;
  }

  function headers() {
    var h = { 'Content-Type': 'application/json' };
    if (token) h['Authorization'] = 'Bearer ' + token;
    return h;
  }

  fetch('/health', { headers: headers() }).then(function (r) {
    setStatus(r.ok ? 'connected' : 'auth failed', r.ok ? 'ok' : 'err');
  }).catch(function () { setStatus('offline', 'err'); });

  async function send(message) {
    if (streaming) return;
    streaming = true;
    $send.disabled = true;
    addMsg('user', message);
    var assistant = addMsg('assistant', '');
    assistant.classList.add('cursor');

    try {
      var res = await fetch('/chat/stream', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ message: message, sessionId: sessionId || undefined }),
      });
      if (!res.ok || !res.body) {
        var err = await res.text().catch(function () { return 'request failed'; });
        assistant.classList.remove('cursor');
        assistant.remove();
        addMsg('error', 'Error (' + res.status + '): ' + err);
        return;
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buffer = '';
      while (true) {
        var chunk = await reader.read();
        if (chunk.done) break;
        buffer += decoder.decode(chunk.value, { stream: true });
        var parts = buffer.split('\\n\\n');
        buffer = parts.pop() || '';
        for (var i = 0; i < parts.length; i++) {
          var raw = parts[i];
          var lines = raw.split('\\n');
          var data = '';
          for (var j = 0; j < lines.length; j++) {
            if (lines[j].indexOf('data: ') === 0) data += lines[j].slice(6);
          }
          if (!data) continue;
          var ev;
          try { ev = JSON.parse(data); } catch (e) { continue; }
          if (ev.type === 'text' && ev.delta) {
            assistant.textContent += ev.delta;
            $log.scrollTop = $log.scrollHeight;
          } else if (ev.type === 'tool-call' && ev.tool) {
            addTool(ev.tool.name);
          } else if (ev.type === 'session' && ev.sessionId) {
            sessionId = ev.sessionId;
            sessionStorage.setItem('void.sessionId', sessionId);
          } else if (ev.type === 'error') {
            assistant.classList.remove('cursor');
            addMsg('error', ev.message || 'Unknown error');
          }
        }
      }
    } catch (e) {
      addMsg('error', (e && e.message) || 'Network error');
    } finally {
      assistant.classList.remove('cursor');
      if (!assistant.textContent) assistant.remove();
      streaming = false;
      $send.disabled = false;
      $input.focus();
    }
  }

  $form.addEventListener('submit', function (e) {
    e.preventDefault();
    var msg = $input.value.trim();
    if (!msg) return;
    $input.value = '';
    send(msg);
  });

  $input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $form.dispatchEvent(new Event('submit'));
    }
  });
})();
</script>
</body>
</html>`
