// Veyra shared lead board (plain JS, no build step). Nothing here sends anything:
// people copy the draft and send it by hand, then record what they did.
const STATUSES = ["new", "contacted", "replied", "meeting", "won", "lost", "do_not_contact", "rejected"];
const LABELS = {new: "New", contacted: "Contacted", replied: "Replied", meeting: "Meeting booked", won: "Won",
                lost: "Lost", do_not_contact: "Do not contact", rejected: "Rejected (not a fit)"};
const CLOSED = ["won", "lost", "do_not_contact", "rejected"];
const PLACEHOLDER = /\[[^\]\n]{2,40}\]/g;
// Drafts must not say how many we are or that we are small (same check as harvey/pilot.py HEADCOUNT).
const HEADCOUNT = /\b(zwei|drei|two|three)\b[^.\n]{0,40}(engineer|ingenieur|entwickler|developer|leute|people)|\b(einer|eine) davon\b|\bone of us\b|\bkleine[nmrs]? (österreichische[nmrs]? )?(gmbh|team|firma)|\bsmall (austrian )?(gmbh|team|company|firm)|\bwenige[n]? kunden|\bfew clients|\blimited capacity/i;

let leads = [], openId = null, current = null, myName = "", listScroll = 0;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const $ = (id) => document.getElementById(id);
const me = () => { try { myName ||= localStorage.getItem("veyra-name") || ""; } catch {} return myName; };
const show = (id) => ["login", "ask-name", "app"].forEach((x) => ($(x).hidden = x !== id));
const hashId = () => decodeURIComponent((location.hash.match(/^#lead=(.+)$/) || [])[1] || "");
const ready = (l) => l.status === "new" && !l.owner;

let toastTimer;
function say(text) { $("status").textContent = text; clearTimeout(toastTimer); toastTimer = setTimeout(() => ($("status").textContent = ""), 2500); }
function fail(text) { $("err").textContent = text; $("err").hidden = !text; }

async function api(path, opts = {}) {
  const r = await fetch(path, {credentials: "same-origin", ...opts,
    headers: opts.body ? {"Content-Type": "application/json"} : {}}).catch(() => null);
  if (!r) { fail("Can't reach the board. Check your connection and try again."); return null; }
  if (r.status === 401 && path !== "/api/login") { show("login"); return null; }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) { fail(data.error || "Something went wrong. Try again."); return null; }
  fail("");
  return data;
}

async function login(e) {
  e.preventDefault();
  const r = await fetch("/api/login", {method: "POST", headers: {"Content-Type": "application/json"},
    body: JSON.stringify({password: $("pw").value})});
  if (!r.ok) { $("login-err").textContent = (await r.json().catch(() => ({}))).error || "Wrong password."; $("pw").select(); return; }
  $("pw").value = ""; $("login-err").textContent = ""; start();
}
async function logout() { await fetch("/api/logout", {method: "POST"}); show("login"); $("pw").focus(); }
function saveName(e) {
  e.preventDefault();
  myName = $("name-input").value.trim();
  try { localStorage.setItem("veyra-name", myName); } catch {}
  start();
}
function changeName() { $("name-input").value = me(); show("ask-name"); $("name-input").focus(); }

async function start() {
  const data = await api("/api/leads");
  if (!data) return;
  if (!me()) { show("ask-name"); $("name-input").focus(); return; }
  leads = data; $("me").textContent = me(); show("app");
  fillFilters(); render();
  route(false);
}

function fillFilters() {
  const owners = [...new Set(leads.map((l) => l.owner).filter(Boolean))].sort();
  const o = $("f-owner").value, s = $("f-status").value || "open";
  $("f-owner").innerHTML = '<option value="">Anyone</option><option value="+">Mine</option><option value="-">Unclaimed</option>' +
    owners.map((x) => `<option value="${esc(x)}">${esc(x)}</option>`).join("");
  $("f-status").innerHTML = '<option value="open">Still open</option><option value="all">Any status</option>' +
    STATUSES.map((x) => `<option value="${x}">${LABELS[x]}</option>`).join("");
  $("f-owner").value = o; $("f-status").value = s;
}

// Re-rendering replaces elements; put keyboard focus back on the element with the same id.
function keepFocus(fn) {
  const id = document.activeElement?.id;
  fn();
  if (id && $(id) && document.activeElement !== $(id)) $(id).focus();
}

function render() {
  const q = $("search").value.trim().toLowerCase(), o = $("f-owner").value, s = $("f-status").value, g = $("f-region").value;
  const shown = leads.filter((l) =>
    (!q || [l.name, l.city, l.what, l.domain].join(" ").toLowerCase().includes(q)) &&
    (!o || (o === "-" ? !l.owner : o === "+" ? l.owner === me() : l.owner === o)) &&
    (s === "all" || (s === "open" ? !CLOSED.includes(l.status) : l.status === s)) && (!g || l.region === g));
  const free = leads.filter(ready).length, mine = leads.filter((l) => l.owner === me() && !CLOSED.includes(l.status)).length;
  $("summary").innerHTML = `<b>${free}</b> ready to take · <b>${mine}</b> yours · showing ${shown.length} of ${leads.length}`;
  keepFocus(() => {
    $("rows").innerHTML = shown.map((l) => `<li><a id="row-${esc(l.id)}" class="row${ready(l) ? " ready" : ""}"
        href="#lead=${encodeURIComponent(l.id)}"${l.id === openId ? ' aria-current="true"' : ""}>
        <span class="name">${ready(l) ? '<span class="sr">Ready to take: </span>' : ""}${esc(l.name)}</span>
        ${l.status === "new" ? "" : `<span class="pill p-${l.status}">${LABELS[l.status] || esc(l.status)}</span>`}
        <span class="meta">${esc(l.city)} · fit ${l.fit ?? "—"}/10 · ${l.owner ? esc(l.owner) : "unclaimed"}</span></a></li>`).join("") ||
      `<li class="none">No leads match. <button type="button" class="link" onclick="clearFilters()">Clear the filters</button></li>`;
  });
}
function clearFilters() { $("search").value = ""; $("f-owner").value = ""; $("f-status").value = "all"; $("f-region").value = ""; render(); $("search").focus(); }

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
    else if (line.startsWith("> ")) out += `<p class="hint">${inline(line.slice(2))}</p>`;
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  return out + (list ? "</ul>" : "");
}

// The hash says which lead is open (#lead=<id>), so back, reload and shared links all work.
function route(byUser) {
  const id = hashId();
  if (id && byUser && !openId) listScroll = window.scrollY;
  $("app").classList.toggle("reading", !!id);
  if (!id) {
    const was = openId; openId = null; current = null; render();
    $("detail").innerHTML = '<div class="empty"><h2>Pick a lead</h2><p>Its research, the first email draft and the team\'s notes open here.</p></div>';
    if (byUser) { window.scrollTo(0, listScroll); $("row-" + was)?.focus(); }
    return;
  }
  openLead(id, byUser);
}
addEventListener("hashchange", () => route(true));
addEventListener("keydown", (e) => { const m = document.querySelector(".menu[open]"); if (e.key === "Escape" && m) { m.open = false; m.querySelector("summary").focus(); } });
addEventListener("click", (e) => { const m = document.querySelector(".menu[open]"); if (m && (!m.contains(e.target) || e.target.closest(".menu-list"))) m.open = false; });

async function openLead(id, focus) {
  openId = id; render();
  const l = await api("/api/lead?id=" + encodeURIComponent(id));
  if (!l || openId !== id) return;
  current = l;
  const note = document.querySelector("#note-text")?.value || "";
  const inside = $("detail").contains(document.activeElement);
  keepFocus(() => ($("detail").innerHTML = detailHtml(l)));
  if (inside && !$("detail").contains(document.activeElement)) $("lead-title").focus();   // its button went away
  if (note) $("note-text").value = note;
  if (focus) { window.scrollTo(0, 0); $("lead-title").focus(); }
}

function detailHtml(l) {
  const mine = l.owner === me();
  const site = /^https?:\/\//i.test(l.website) ? l.website : "https://" + l.domain;
  const emails = String(l.emails || "").split(/[,;\s]+/).filter(Boolean);
  const phones = String(l.phones || "").split(/[,;]+/).map((p) => p.trim()).filter(Boolean);
  const holes = [...new Set(String(l.draft || "").match(PLACEHOLDER) || [])];
  const checks = [];
  if (holes.length) checks.push(`Fill in ${holes.map(esc).join(", ")} before sending.`);
  if (HEADCOUNT.test(`${l.subject}\n${l.draft}`)) checks.push("It mentions how many we are or calls us small. Rewrite that sentence: say who we are and what we do.");
  let primary;
  if (!l.owner) primary = `<button id="claim" class="primary" onclick="update({owner: me()}, 'Claimed. It\\'s yours.')">Claim this lead</button>`;
  else if (mine && l.status === "new") primary = `<button id="mark-sent" class="primary" onclick="update({status: 'contacted'}, 'Marked as contacted.')">I sent it: mark as contacted</button>
    <button id="unclaim" class="secondary" onclick="update({owner: ''}, 'Unclaimed.')">Unclaim</button>`;
  else if (mine) primary = `<button id="unclaim" class="secondary" onclick="update({owner: ''}, 'Unclaimed.')">Unclaim</button>`;
  else primary = `<button id="take-over" class="secondary" onclick="takeOver()">Take over from ${esc(l.owner)}</button>`;

  return `
    <a class="back btn secondary" href="#">← All leads</a>
    <div class="lead">
    <div class="lead-head">
    <h2 id="lead-title" tabindex="-1">${esc(l.name)}</h2>
    <p class="what">${esc(l.what || "")}</p>
    </div>
    <aside class="side-col" aria-label="Owner, status and contact">
    <dl class="facts">
      <dt>Where</dt><dd>${esc(l.city)}${l.region ? " · " + esc(l.region) : ""}</dd>
      <dt>Website</dt><dd><a href="${esc(site)}" target="_blank" rel="noopener noreferrer">${esc(l.domain)}<span class="sr"> (opens in a new tab)</span></a></dd>
      <dt>Fit</dt><dd>${l.fit ?? "—"}/10 · reviewer says ${esc(l.verdict || "—")}</dd>
      <dt>Owner</dt><dd>${l.owner ? esc(l.owner) + (mine ? " (you)" : "") : "Nobody yet"}</dd>
    </dl>
    <div class="actions">
      ${primary}
      <label for="status-select">Status</label>
      <select id="status-select" onchange="update({status: this.value}, 'Status: ' + this.options[this.selectedIndex].text + '.')">
        ${STATUSES.map((s) => `<option value="${s}" ${s === l.status ? "selected" : ""}>${LABELS[s]}</option>`).join("")}
      </select>
    </div>

    <section class="block" aria-labelledby="h-contact">
      <h3 id="h-contact">How to reach them</h3>
      <ul class="contact">
        ${emails.map((e, i) => `<li><span class="k">Email</span><span>${esc(e)}</span>
          <button id="copy-mail-${i}" class="secondary small" data-copy="${esc(e)}" onclick="copy(this.dataset.copy, 'Email address copied.')">Copy<span class="sr"> ${esc(e)}</span></button></li>`).join("")
          || '<li><span class="k">Email</span><span>None published on their site</span></li>'}
        ${phones.map((p) => `<li><span class="k">Phone</span><a href="tel:${esc(p.replace(/[^\d+]/g, ""))}">${esc(p)}</a></li>`).join("")
          || '<li><span class="k">Phone</span><span>—</span></li>'}
      </ul>
    </section>
    </aside>
    <div class="main-col">
    <section class="block draft" aria-labelledby="h-draft">
      <h3 id="h-draft">First email</h3>
      <div class="letter">
        <p class="letter-label"><b>REVIEW DRAFT — NOT APPROVED FOR SENDING.</b> Read it, fix what's off and send it by hand from your own mailbox.</p>
        ${checks.length ? `<ul class="checks">${checks.map((c) => `<li>${c}</li>`).join("")}</ul>` : ""}
        <div class="letter-row"><span><span class="k">Subject</span>${esc(l.subject)}</span>
          <button id="copy-subject" class="secondary small" onclick="copy(current.subject, 'Subject copied.')">Copy subject</button></div>
        <pre class="letter-body">${esc(l.draft).replace(PLACEHOLDER, (m) => `<mark>${m}</mark>`)}</pre>
        <div class="letter-foot"><button id="copy-body" class="secondary" onclick="copy(current.draft, 'Email text copied.')">Copy email text</button></div>
      </div>
    </section>
    <details class="block research"><summary>Research: facts, hypotheses, unknowns</summary>${md(l.profile_md)}</details>
    </div>
    <section class="block notes" aria-labelledby="h-notes">
      <h3 id="h-notes">Notes and history</h3>
      <form class="note" onsubmit="event.preventDefault(); update({note: this.n.value}, 'Note added.').then((ok) => ok && ($('note-text').value = ''))">
        <label class="sr" for="note-text">Add a note</label>
        <textarea id="note-text" name="n" placeholder="What happened? e.g. sent from my mailbox, called, call back Tuesday" required></textarea>
        <button id="add-note" type="submit" class="secondary">Add note</button>
      </form>
      <ul class="events">${l.events.map((e) => `<li><div class="when">${new Date(e.at).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"})} · ${esc(e.who)}</div>${esc(e.text)}</li>`).join("")}</ul>
    </section>
    </div>`;
}

function takeOver() {
  if (confirm(`${current.owner} has claimed ${current.name}. Take it over?`)) update({owner: me()}, "It's yours now.");
}

async function copy(text, done) {
  try { await navigator.clipboard.writeText(text); say(done); }
  catch { say("Couldn't copy. Select the text and copy it by hand."); }
}

async function update(change, done) {
  const ok = await api("/api/lead", {method: "POST", body: JSON.stringify({id: openId, by: me(), ...change})});
  if (!ok) return false;
  const data = await api("/api/leads");
  if (data) { leads = data; fillFilters(); render(); }
  await openLead(openId, false);
  if (done) say(done);
  return true;
}

start();
setInterval(() => { if (!document.hidden && !$("app").hidden) api("/api/leads").then((d) => { if (d) { leads = d; fillFilters(); render(); } }); }, 30000);
