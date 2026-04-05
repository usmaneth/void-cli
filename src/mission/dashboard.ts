/**
 * Void Mission Control — Embedded dashboard HTML/CSS/JS.
 *
 * Returns a complete single-page app as an HTML string.
 * No external dependencies; all styles and scripts are inline.
 */

export function getDashboardHTML(wsPort: number): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Void Mission Control</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg: #0d1117;
    --card: #161b22;
    --card-border: #30363d;
    --accent: #58a6ff;
    --text: #c9d1d9;
    --text-dim: #8b949e;
    --green: #3fb950;
    --yellow: #d29922;
    --blue: #58a6ff;
    --red: #f85149;
    --font-mono: 'SF Mono', 'Cascadia Code', 'Fira Code', 'JetBrains Mono', Consolas, monospace;
  }

  body {
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.5;
    min-height: 100vh;
    display: flex;
    flex-direction: column;
  }

  /* Header */
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 24px;
    border-bottom: 1px solid var(--card-border);
    background: var(--card);
  }
  .header h1 {
    font-size: 18px;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.5px;
  }
  .connection-status {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 12px;
    color: var(--text-dim);
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--red);
    transition: background 0.3s;
  }
  .status-dot.connected { background: var(--green); }

  /* Main grid */
  .grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    grid-template-rows: 1fr 1fr;
    gap: 16px;
    padding: 16px 24px;
    flex: 1;
    min-height: 0;
  }

  .panel {
    background: var(--card);
    border: 1px solid var(--card-border);
    border-radius: 8px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .panel-header {
    padding: 12px 16px;
    border-bottom: 1px solid var(--card-border);
    font-weight: 600;
    font-size: 14px;
    color: var(--accent);
    flex-shrink: 0;
  }
  .panel-body {
    padding: 12px 16px;
    flex: 1;
    overflow-y: auto;
  }

  /* Workstream cards */
  .ws-card {
    padding: 10px 12px;
    border: 1px solid var(--card-border);
    border-radius: 6px;
    margin-bottom: 8px;
    transition: border-color 0.3s;
  }
  .ws-card:hover { border-color: var(--accent); }
  .ws-card-top {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 6px;
  }
  .ws-name { font-weight: 600; }
  .ws-task {
    font-size: 12px;
    color: var(--text-dim);
    margin-bottom: 8px;
  }
  .progress-bar {
    height: 4px;
    background: var(--card-border);
    border-radius: 2px;
    overflow: hidden;
  }
  .progress-fill {
    height: 100%;
    border-radius: 2px;
    background: var(--accent);
    transition: width 0.5s ease;
  }

  /* Status badges */
  .badge {
    display: inline-block;
    padding: 2px 8px;
    border-radius: 12px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .badge-running  { background: rgba(63,185,80,0.15); color: var(--green); }
  .badge-paused   { background: rgba(210,153,34,0.15); color: var(--yellow); }
  .badge-completed{ background: rgba(88,166,255,0.15); color: var(--blue); }
  .badge-failed   { background: rgba(248,81,73,0.15);  color: var(--red); }
  .badge-active   { background: rgba(63,185,80,0.15);  color: var(--green); }
  .badge-idle     { background: rgba(139,148,158,0.15); color: var(--text-dim); }

  /* Task table */
  .task-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }
  .task-table th {
    text-align: left;
    padding: 6px 8px;
    color: var(--text-dim);
    font-weight: 500;
    border-bottom: 1px solid var(--card-border);
    white-space: nowrap;
  }
  .task-table td {
    padding: 6px 8px;
    border-bottom: 1px solid rgba(48,54,61,0.5);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 200px;
  }
  .task-table tr {
    transition: background 0.2s;
  }
  .task-table tr:hover { background: rgba(88,166,255,0.05); }
  .task-id { color: var(--text-dim); }

  /* Agent cards */
  .agent-card {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 12px;
    border: 1px solid var(--card-border);
    border-radius: 6px;
    margin-bottom: 6px;
    transition: border-color 0.3s;
  }
  .agent-card:hover { border-color: var(--accent); }
  .agent-left { display: flex; align-items: center; gap: 10px; }
  .agent-name { font-weight: 600; font-size: 13px; }
  .agent-task { font-size: 11px; color: var(--text-dim); }
  .agent-right {
    text-align: right;
    font-size: 11px;
    color: var(--text-dim);
  }
  .agent-tokens { font-weight: 600; color: var(--text); }

  /* Metrics panel */
  .metrics-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    margin-bottom: 16px;
  }
  .metric-card {
    padding: 12px;
    background: var(--bg);
    border-radius: 6px;
    text-align: center;
  }
  .metric-value {
    font-size: 22px;
    font-weight: 700;
    color: var(--accent);
    margin-bottom: 4px;
  }
  .metric-label {
    font-size: 11px;
    color: var(--text-dim);
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  /* SVG Chart */
  .chart-container { margin-top: 8px; }
  .chart-container svg { width: 100%; }

  /* Footer */
  .footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 24px;
    border-top: 1px solid var(--card-border);
    background: var(--card);
    font-size: 11px;
    color: var(--text-dim);
    flex-shrink: 0;
  }
  .footer-items {
    display: flex;
    gap: 24px;
  }

  /* Responsive */
  @media (max-width: 900px) {
    .grid {
      grid-template-columns: 1fr;
      grid-template-rows: auto;
    }
  }

  /* Scrollbar */
  ::-webkit-scrollbar { width: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: var(--card-border); border-radius: 3px; }

  .empty-state {
    text-align: center;
    padding: 24px;
    color: var(--text-dim);
    font-style: italic;
  }
</style>
</head>
<body>
  <div class="header">
    <h1>Void Mission Control</h1>
    <div class="connection-status">
      <span id="connText">Disconnected</span>
      <div class="status-dot" id="connDot"></div>
    </div>
  </div>

  <div class="grid">
    <!-- Workstreams Panel -->
    <div class="panel">
      <div class="panel-header">Workstreams</div>
      <div class="panel-body" id="workstreamsPanel">
        <div class="empty-state">No workstreams active</div>
      </div>
    </div>

    <!-- Task Board Panel -->
    <div class="panel">
      <div class="panel-header">Task Board</div>
      <div class="panel-body" id="taskBoardPanel">
        <div class="empty-state">No tasks</div>
      </div>
    </div>

    <!-- Agent Status Panel -->
    <div class="panel">
      <div class="panel-header">Agent Status</div>
      <div class="panel-body" id="agentPanel">
        <div class="empty-state">No agents</div>
      </div>
    </div>

    <!-- System Metrics Panel -->
    <div class="panel">
      <div class="panel-header">System Metrics</div>
      <div class="panel-body" id="metricsPanel">
        <div class="empty-state">Waiting for data...</div>
      </div>
    </div>
  </div>

  <div class="footer">
    <div class="footer-items">
      <span id="footerUptime">Uptime: --</span>
      <span id="footerTokens">Tokens: --</span>
      <span id="footerCost">Cost: --</span>
    </div>
    <div class="connection-status">
      <span id="footerConn">WebSocket: disconnected</span>
      <div class="status-dot" id="footerDot"></div>
    </div>
  </div>

<script>
(function() {
  'use strict';

  var wsPort = ${wsPort};
  var ws = null;
  var connected = false;
  var pollTimer = null;
  var reconnectTimer = null;
  var state = null;

  // -- Formatting helpers --
  function fmtTokens(n) {
    if (n == null) return '--';
    if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1) + 'k';
    return String(n);
  }

  function fmtCost(n) {
    if (n == null) return '--';
    return '$' + n.toFixed(2);
  }

  function fmtDuration(ms) {
    if (ms == null) return '--';
    var s = Math.floor(ms / 1000);
    if (s < 60) return s + 's';
    var m = Math.floor(s / 60);
    s = s % 60;
    if (m < 60) return m + 'm ' + s + 's';
    var h = Math.floor(m / 60);
    m = m % 60;
    return h + 'h ' + m + 'm';
  }

  function badgeClass(status) {
    var s = (status || '').toLowerCase();
    if (s === 'running' || s === 'active') return 'badge-running';
    if (s === 'paused') return 'badge-paused';
    if (s === 'completed' || s === 'done') return 'badge-completed';
    if (s === 'failed' || s === 'error') return 'badge-failed';
    if (s === 'idle') return 'badge-idle';
    return 'badge-idle';
  }

  function esc(str) {
    if (!str) return '';
    var d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // -- Render functions --
  function renderWorkstreams(workstreams) {
    var el = document.getElementById('workstreamsPanel');
    if (!workstreams || workstreams.length === 0) {
      el.innerHTML = '<div class="empty-state">No workstreams active</div>';
      return;
    }
    el.innerHTML = workstreams.map(function(ws) {
      var pct = ws.progress != null ? Math.round(ws.progress * 100) : 0;
      return '<div class="ws-card">' +
        '<div class="ws-card-top">' +
          '<span class="ws-name">' + esc(ws.name) + '</span>' +
          '<span class="badge ' + badgeClass(ws.status) + '">' + esc(ws.status) + '</span>' +
        '</div>' +
        (ws.currentTask ? '<div class="ws-task">' + esc(ws.currentTask) + '</div>' : '') +
        '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
      '</div>';
    }).join('');
  }

  function renderTasks(tasks) {
    var el = document.getElementById('taskBoardPanel');
    if (!tasks || tasks.length === 0) {
      el.innerHTML = '<div class="empty-state">No tasks</div>';
      return;
    }
    var rows = tasks.map(function(t) {
      return '<tr>' +
        '<td class="task-id">' + esc((t.id || '').slice(0, 4)) + '</td>' +
        '<td title="' + esc(t.instruction) + '">' + esc(t.instruction) + '</td>' +
        '<td><span class="badge ' + badgeClass(t.status) + '">' + esc(t.status) + '</span></td>' +
        '<td>' + esc(t.agent || '--') + '</td>' +
        '<td>' + fmtTokens(t.tokens) + '</td>' +
        '<td>' + fmtDuration(t.durationMs) + '</td>' +
      '</tr>';
    }).join('');
    el.innerHTML = '<table class="task-table">' +
      '<thead><tr><th>ID</th><th>Instruction</th><th>Status</th><th>Agent</th><th>Tokens</th><th>Time</th></tr></thead>' +
      '<tbody>' + rows + '</tbody></table>';
  }

  function renderAgents(agents) {
    var el = document.getElementById('agentPanel');
    if (!agents || agents.length === 0) {
      el.innerHTML = '<div class="empty-state">No agents</div>';
      return;
    }
    el.innerHTML = agents.map(function(a) {
      return '<div class="agent-card">' +
        '<div class="agent-left">' +
          '<span class="badge ' + badgeClass(a.status || a.health) + '">' + esc(a.status || a.health) + '</span>' +
          '<div>' +
            '<div class="agent-name">' + esc(a.name || a.id) + '</div>' +
            (a.currentTask ? '<div class="agent-task">' + esc(a.currentTask) + '</div>' : '') +
          '</div>' +
        '</div>' +
        '<div class="agent-right">' +
          '<div class="agent-tokens">' + fmtTokens(a.tokensUsed) + ' tok</div>' +
          (a.uptimeMs != null ? '<div>' + fmtDuration(a.uptimeMs) + '</div>' : '') +
        '</div>' +
      '</div>';
    }).join('');
  }

  function renderMetrics(metrics) {
    var el = document.getElementById('metricsPanel');
    if (!metrics) {
      el.innerHTML = '<div class="empty-state">Waiting for data...</div>';
      return;
    }
    var total = (metrics.tasksCompleted || 0) + (metrics.tasksFailed || 0);
    var rate = total > 0 ? Math.round((metrics.tasksCompleted / total) * 100) : 0;

    var html = '<div class="metrics-grid">' +
      '<div class="metric-card"><div class="metric-value">' + fmtTokens(metrics.totalTokens) + '</div><div class="metric-label">Total Tokens</div></div>' +
      '<div class="metric-card"><div class="metric-value">' + fmtCost(metrics.totalCost) + '</div><div class="metric-label">Total Cost</div></div>' +
      '<div class="metric-card"><div class="metric-value">' + (metrics.activeAgents || 0) + '</div><div class="metric-label">Active Agents</div></div>' +
      '<div class="metric-card"><div class="metric-value">' + rate + '%</div><div class="metric-label">Completion Rate</div></div>' +
    '</div>';

    // Simple SVG bar chart for token breakdown
    html += renderTokenChart(metrics);

    el.innerHTML = html;
  }

  function renderTokenChart(metrics) {
    var completed = metrics.tasksCompleted || 0;
    var failed = metrics.tasksFailed || 0;
    var total = completed + failed;
    if (total === 0) return '';

    var completedPct = (completed / total) * 100;
    var failedPct = (failed / total) * 100;

    return '<div class="chart-container">' +
      '<svg viewBox="0 0 300 40" xmlns="http://www.w3.org/2000/svg">' +
        '<rect x="0" y="8" width="300" height="24" rx="4" fill="#30363d"/>' +
        '<rect x="0" y="8" width="' + (completedPct * 3) + '" height="24" rx="4" fill="#3fb950"/>' +
        (failedPct > 0 ? '<rect x="' + (completedPct * 3) + '" y="8" width="' + (failedPct * 3) + '" height="24" fill="#f85149"/>' : '') +
        '<text x="8" y="25" fill="#c9d1d9" font-size="11" font-family="monospace">' +
          completed + ' completed / ' + failed + ' failed' +
        '</text>' +
      '</svg>' +
    '</div>';
  }

  function renderFooter(metrics) {
    document.getElementById('footerUptime').textContent = 'Uptime: ' + fmtDuration(metrics ? metrics.uptimeMs : null);
    document.getElementById('footerTokens').textContent = 'Tokens: ' + fmtTokens(metrics ? metrics.totalTokens : null);
    document.getElementById('footerCost').textContent = 'Cost: ' + fmtCost(metrics ? metrics.totalCost : null);
  }

  function updateAll(data) {
    state = data;
    renderWorkstreams(data.workstreams);
    renderTasks(data.tasks);
    renderAgents(data.agents);
    renderMetrics(data.metrics);
    renderFooter(data.metrics);
  }

  // -- Connection status --
  function setConnected(val) {
    connected = val;
    var dot1 = document.getElementById('connDot');
    var dot2 = document.getElementById('footerDot');
    var txt1 = document.getElementById('connText');
    var txt2 = document.getElementById('footerConn');
    if (val) {
      dot1.classList.add('connected');
      dot2.classList.add('connected');
      txt1.textContent = 'Connected';
      txt2.textContent = 'WebSocket: connected';
    } else {
      dot1.classList.remove('connected');
      dot2.classList.remove('connected');
      txt1.textContent = 'Disconnected';
      txt2.textContent = 'WebSocket: disconnected';
    }
  }

  // -- WebSocket --
  function connectWS() {
    try {
      ws = new WebSocket('ws://localhost:' + wsPort + '/ws');
    } catch (e) {
      startPolling();
      return;
    }

    ws.onopen = function() {
      setConnected(true);
      stopPolling();
    };

    ws.onmessage = function(ev) {
      try {
        var msg = JSON.parse(ev.data);
        if (msg.type === 'state') {
          updateAll(msg.data);
        } else if (msg.type === 'task_update' && state) {
          var tasks = state.tasks || [];
          for (var i = 0; i < tasks.length; i++) {
            if (tasks[i].id === msg.data.id) {
              tasks[i].status = msg.data.status;
              if (msg.data.step) tasks[i].currentStep = msg.data.step;
              break;
            }
          }
          renderTasks(tasks);
        } else if (msg.type === 'agent_update' && state) {
          var agents = state.agents || [];
          for (var i = 0; i < agents.length; i++) {
            if (agents[i].id === msg.data.id) {
              agents[i].status = msg.data.status;
              agents[i].health = msg.data.health;
              break;
            }
          }
          renderAgents(agents);
        }
      } catch (e) {
        // ignore parse errors
      }
    };

    ws.onclose = function() {
      setConnected(false);
      startPolling();
      scheduleReconnect();
    };

    ws.onerror = function() {
      setConnected(false);
    };
  }

  function scheduleReconnect() {
    if (reconnectTimer) return;
    reconnectTimer = setTimeout(function() {
      reconnectTimer = null;
      connectWS();
    }, 3000);
  }

  // -- Polling fallback --
  function startPolling() {
    if (pollTimer) return;
    pollTimer = setInterval(function() {
      fetch('/api/state')
        .then(function(r) { return r.json(); })
        .then(function(data) { updateAll(data); })
        .catch(function() {});
    }, 2000);
  }

  function stopPolling() {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  }

  // -- Init --
  connectWS();
})();
</script>
</body>
</html>`;
}
