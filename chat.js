const HISTORY_KEY = "kirk_chat_history";

function _chatEl() {
  return document.getElementById("chat");
}

export function loadHistory() {
  const stored = localStorage.getItem(HISTORY_KEY);
  if (!stored) return;
  JSON.parse(stored).forEach((msg) => _render(msg.role, msg.content, msg.timestamp, false));
  _scrollBottom();
}

export function addMessage(role, content) {
  const timestamp = new Date().toISOString();
  _render(role, content, timestamp, true);
  const stored = localStorage.getItem(HISTORY_KEY);
  const history = stored ? JSON.parse(stored) : [];
  history.push({ role, content, timestamp });
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

export function clearHistory() {
  localStorage.removeItem(HISTORY_KEY);
  _chatEl().innerHTML = "";
}

function _render(role, content, timestamp, animate) {
  const div = document.createElement("div");
  div.className = `message ${role === "user" ? "user" : "assistant"}${animate ? " new" : ""}`;

  const isUser = role === "user";
  const time = new Date(timestamp).toLocaleTimeString("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const avatarHtml = isUser
    ? `<img class="avatar photo" src="./user-avatar.jpg" alt="G" onerror="this.outerHTML='<span class=\\'avatar\\'>G</span>'">`
    : `<img class="avatar photo" src="./kirk-avatar.jpg" alt="K" onerror="this.outerHTML='<span class=\\'avatar\\'>K</span>'">`;

  div.innerHTML = `
    ${avatarHtml}
    <div class="bubble">
      <p>${_renderMarkdown(content)}</p>
      <time>${time}</time>
    </div>`;

  _chatEl().appendChild(div);
  _scrollBottom();
}

function _scrollBottom() {
  const el = _chatEl();
  el.scrollTop = el.scrollHeight;
}

function _renderMarkdown(str) {
  let s = str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  s = s.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
  s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
  s = s.replace(/^#{1,3} (.+)$/gm, "<strong class='md-h'>$1</strong>");
  s = s.replace(/^[-*] (.+)$/gm, "• $1");
  s = s.replace(/^\d+\. (.+)$/gm, (_, item, offset, full) => {
    const num = full.slice(0, offset).split("\n").filter(l => /^\d+\./.test(l)).length + 1;
    return `${num}. ${item}`;
  });
  s = s.replace(/\n/g, "<br>");
  return s;
}
