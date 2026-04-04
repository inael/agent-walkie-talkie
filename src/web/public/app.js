let currentConvId = null;
let conversations = [];

// WebSocket
const ws = new WebSocket(`ws://${location.host}`);
ws.onmessage = (event) => {
  const { type, data } = JSON.parse(event.data);
  if (type === 'message' && data.conversationId === currentConvId) {
    appendMessage(data);
  }
  if (type === 'update' || type === 'message') {
    loadConversations();
  }
};

ws.onclose = () => setTimeout(() => location.reload(), 3000);

// Load conversations
async function loadConversations() {
  const res = await fetch('/api/conversations');
  conversations = await res.json();
  conversations.sort((a, b) => new Date(b.updatedAt) - new Date(a.updatedAt));
  renderConvList();
}

function renderConvList() {
  const list = document.getElementById('conv-list');
  list.innerHTML = conversations.map(c => {
    const active = c.id === currentConvId ? 'active' : '';
    const participants = c.participants.join(' ↔ ');
    const statusClass = `status-${c.status}`;
    return `
      <div class="conv-item ${active}" onclick="selectConv('${c.id}')">
        <div class="conv-title">${c.subject}</div>
        <div class="conv-meta">
          ${participants} · R${c.currentRound}/${c.maxRounds}
          <span class="status-badge ${statusClass}">${c.status}</span>
        </div>
      </div>
    `;
  }).join('');
}

async function selectConv(id) {
  currentConvId = id;
  const conv = conversations.find(c => c.id === id);
  if (!conv) return;

  // Update header
  const header = document.getElementById('chat-header');
  header.innerHTML = `
    <strong>${conv.subject}</strong>
    <span style="color:#888; font-size:0.85em; margin-left:12px">
      ${conv.participants.join(' ↔ ')} · Round ${conv.currentRound}/${conv.maxRounds}
      <span class="status-badge status-${conv.status}">${conv.status}</span>
    </span>
  `;

  // Show controls
  const controls = document.getElementById('controls');
  controls.classList.remove('hidden');

  const btnPause = document.getElementById('btn-pause');
  const btnResume = document.getElementById('btn-resume');
  if (conv.status === 'paused') {
    btnPause.classList.add('hidden');
    btnResume.classList.remove('hidden');
  } else {
    btnPause.classList.remove('hidden');
    btnResume.classList.add('hidden');
  }

  // Load messages
  const res = await fetch(`/api/conversations/${id}/messages`);
  const messages = await res.json();
  const container = document.getElementById('messages');
  container.innerHTML = '';
  messages.forEach(appendMessage);
  container.scrollTop = container.scrollHeight;

  renderConvList();
}

function appendMessage(msg) {
  const container = document.getElementById('messages');
  const conv = conversations.find(c => c.id === msg.conversationId);
  if (!conv) return;

  const isA = msg.from === conv.participants[0];
  const side = isA ? 'from-a' : 'from-b';
  const emoji = isA ? '🔵' : '🟢';
  const ending = ['agreement', 'blocked', 'delivered'].includes(msg.type) ? 'ending' : '';

  const div = document.createElement('div');
  div.className = `message ${side} ${ending}`;
  div.innerHTML = `
    <div class="msg-header">
      ${emoji} <strong>${msg.from}</strong>
      <span class="msg-type">${msg.type}</span>
      · Round ${msg.round}
    </div>
    ${msg.body}
  `;

  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

async function pauseConv() {
  if (!currentConvId) return;
  await fetch(`/api/conversations/${currentConvId}/pause`, { method: 'POST' });
  loadConversations();
  selectConv(currentConvId);
}

async function resumeConv() {
  if (!currentConvId) return;
  await fetch(`/api/conversations/${currentConvId}/resume`, { method: 'POST' });
  loadConversations();
  selectConv(currentConvId);
}

async function addRounds() {
  if (!currentConvId) return;
  await fetch(`/api/conversations/${currentConvId}/add-rounds`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rounds: 5 }),
  });
  loadConversations();
  selectConv(currentConvId);
}

// Load projects
async function loadProjects() {
  const res = await fetch('/api/projects');
  const projects = await res.json();
  const list = document.getElementById('project-list');
  list.innerHTML = projects.map(p =>
    `<div class="project-item">📡 ${p.id}${p.description ? ` — ${p.description}` : ''}</div>`
  ).join('');
}

// Init
loadConversations();
loadProjects();
