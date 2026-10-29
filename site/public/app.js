// Veyra shared lead board (plain JS, no build step).
const STATUSES = ["new", "contacted", "replied", "meeting", "won", "lost", "do_not_contact", "rejected"];
const label = (s) => s.replace(/_/g, " ");
let leads = [], openId = null;

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const $ = (id) => document.getElementById(id);
let myName = "";
const me = () => { try { myName ||= localStorage.getItem("veyra-name") || ""; } catch {} return myName; };
const show = (id) => ["login", "ask-name", "app"].forEach((x) => ($(x).hidden = x !== id));

async function api(path, opts = {}) {
  const r = await fetch(path, {credentials: "same-origin", ...opts,
    headers: opts.body ? {"Content-Type": "application/json"} : {}});
  if (r.status === 401 && path !== "/api/login") { show("login"); return null; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { alert(data.error || "Something went wrong."); return null; }
  return data;
}

async function login(e) {
  e.preventDefault();
  const r = await fetch("/api/login", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({password: $("pw").value})});
  if (!r.ok) { $("login-err").textContent = (await r.json().catch(() => ({}))).error || "Wrong password."; return; }
  $("pw").value = ""; start();
}
async function logout(e) { e.preventDefault(); await fetch("/api/logout", {method: "POST"}); show("login"); }
function saveName(e) {
  e.preventDefault();
  myName = $("name-input").value.trim();
  try { localStorage.setItem("veyra-name", myName); } catch {}
  start();
}
function changeName(e) { e.preventDefault(); $("name-input").value = me(); show("ask-name"); }

async function start() {
  const data = await api("/api/leads");
  if (!data) return;
  if (!me()) { show("ask-name"); return; }
  leads = data; $("me").textContent = me(); show("app");
  fillFilters(); render();
  if (openId) openLead(openId);
}

function fillFilters() {
  const owners = [...new Set(leads.map((l) => l.owner).filter(Boolean))].sort();
  const keep = (id) => $(id).value;
  const o = keep("f-owner"), s = keep("f-status");
  $("f-owner").innerHTML = '<option value="">Anyone</option><option value="-">Unclaimed</option>' +
    owners.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("f-status").innerHTML = '<option value="">Any status</option>' +
    STATUSES.map((x) => `<option value="${x}">${label(x)}</option>`).join("");
  $("f-owner").value = o; $("f-status").value = s;
}

function render() {
  const q = $("search").value.toLowerCase(), o = $("f-owner").value, s = $("f-status").value, g = $("f-region").value;
  const shown = leads.filter((l) =>
    (!q || [l.name, l.city, l.what, l.domain].join(" ").toLowerCase().includes(q)) &&
    (!o || (o === "-" ? !l.owner : l.owner === o)) && (!s || l.status === s) && (!g || l.region === g));
  const unclaimed = leads.filter((l) => !l.owner).length;
  $("summary").textContent = `${leads.length} leads · ${unclaimed} unclaimed · showing ${shown.length}`;
  $("rows").innerHTML = shown.map((l) => `
    <tr class="${l.id === openId ? "sel" : ""}" onclick="openLead('${esc(l.id)}')">
      <td><b>${esc(l.name)}</b><div class="sub">${esc(l.what)}</div></td>
      <td>${esc(l.city)}</td><td class="num">${l.fit ?? ""}</td>
      <td>${l.owner ? esc(l.owner) : '<span class="muted">—</span>'}</td>
      <td><span class="tag s-${l.status}">${label(l.status)}</span></td></tr>`).join("") ||
    '<tr><td colspan="5" class="muted">No leads match.</td></tr>';
}

// Small Markdown → HTML for profiles (headings, lists, bold, links, code). Escaped first.
function md(text) {
  const inline = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');
  let out = "", list = false, code = null;
  for (const line of String(text || "").split("\n")) {
    if (code !== null) {
      if (line.startsWith("```")) { out += `<pre>${esc(code)}</pre>`; code = null; } else code += (code ? "\n" : "") + line;
      continue;
    }
    if (line.startsWith("```")) { code = ""; continue; }
    const li = line.match(/^- (.*)/);
    if (!li && list) { out += "</ul>"; list = false; }
    if (li) { if (!list) { out += "<ul>"; list = true; } out += `<li>${inline(li[1])}</li>`; }
    else if (line.startsWith("# ")) continue;
    else if (line.startsWith("## ")) out += `<h3>${inline(line.slice(3))}</h3>`;
    else if (line.startsWith("> ")) out += `<p class="muted">${inline(line.slice(2))}</p>`;
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  return out + (list ? "</ul>" : "");
}

async function openLead(id) {
  openId = id; render();
  const l = await api("/api/lead?id=" + encodeURIComponent(id));
  if (!l) return;
  const mine = l.owner === me();
  $("detail").innerHTML = `
    <h2>${esc(l.name)}</h2>
    <p class="muted">${esc(l.city)} · fit ${l.fit ?? "?"} · reviewer: ${esc(l.verdict || "—")} ·
      <a href="${esc(/^https?:\/\//i.test(l.website) ? l.website : "https://" + l.domain)}" target="_blank" rel="noopener noreferrer">${esc(l.domain)}</a></p>
    <div class="actions">
      ${mine ? `<button class="ghost" onclick="update({owner: ''})">Unclaim</button>`
             : `<button onclick="update({owner: me()})">${l.owner ? "Take over from " + esc(l.owner) : "Claim it"}</button>`}
      <select onchange="update({status: this.value})">
        ${STATUSES.map((s) => `<option value="${s}" ${s === l.status ? "selected" : ""}>${label(s)}</option>`).join("")}
      </select>
    </div>
    <div class="quick"><b>Email:</b> ${esc(l.emails || "none published")} · <b>Phone:</b> ${esc(l.phones || "—")}</div>
    <div class="draft"><div class="muted">Subject</div><b>${esc(l.subject)}</b><pre>${esc(l.draft)}</pre></div>
    <form class="note" onsubmit="event.preventDefault(); update({note: this.n.value}); this.reset()">
      <textarea name="n" placeholder="Add a note (e.g. 'sent from Max's mailbox', 'called, call back Tue')" required></textarea>
      <button type="submit">Add note</button>
    </form>
    <h3>History</h3>
    <ul class="events">${l.events.map((e) => `<li><span class="muted">${new Date(e.at).toLocaleString()} · ${esc(e.who)}</span><br>${esc(e.text)}</li>`).join("")}</ul>
    <details><summary>Full research write-up</summary>${md(l.profile_md)}</details>`;
}

async function update(change) {
  const ok = await api("/api/lead", {method: "POST", body: JSON.stringify({id: openId, by: me(), ...change})});
  if (ok) start();
}

start();
setInterval(() => { if (!document.hidden && !$("app").hidden) api("/api/leads").then((d) => { if (d) { leads = d; fillFilters(); render(); } }); }, 30000);
