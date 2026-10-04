// Netlist verifier: the schematic picture with one net of netlist.json highlighted on top.
// schematic-map.json (from tools/trace_schematic.py) gives each pin's place in the picture and
// the wire runs traced from it. The netlist decides which pins are ringed; the trace decides
// which wires are drawn. Where the two disagree, the page says so.

const NS = 'http://www.w3.org/2000/svg';
const $ = (s) => document.querySelector(s);
const svg = $('#schem');
const NET_COLORS = { GND: '#00a3a3', VBAT: '#e03131', '5V': '#f76707', '3V3': '#e8a400' };
const el = (tag, attrs = {}, parent, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};

let map = null, netlist = null, check = null, pinNet = {}, sel = null, ws = null;
let zoom = Number(localStorage.getItem('vzoom')) || 1;
let gVeil, gWires, gPins, gHits;

const netColor = (name) => {
  if (NET_COLORS[name]) return NET_COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 37 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 90% 42%)`;
};

function setup() {
  const [w, h] = map.size;
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  el('image', { href: map.image, width: w, height: h }, svg);
  gVeil = el('rect', { width: w, height: h, class: 'veil' }, svg);
  gWires = el('g', {}, svg);
  gPins = el('g', {}, svg);
  gHits = el('g', {}, svg);
  for (const [name, [x, y]] of Object.entries(map.pins)) {
    const hit = el('circle', { cx: x, cy: y, r: 12, class: 'pin-hit' }, gHits);
    el('title', {}, hit, name);
    hit.addEventListener('click', () => {
      if (pinNet[name]) select(pinNet[name]);
      else flash(`${name} is not in the netlist (unused pin, or a part left off the board)`);
    });
  }
  setZoom(zoom);
}

function setZoom(z) {
  zoom = Math.min(5, Math.max(1, z));
  localStorage.setItem('vzoom', zoom);
  svg.style.width = `${zoom * 100}%`;
}

// Pins the traced wires of this net reach, to compare with what the netlist says.
const traced = (net) => new Set(map.wires.filter((w) => w.net === net).flatMap((w) => w.pins));

function problems(net) {
  const out = [];
  const reach = traced(net);
  const internal = new Set((netlist.internal || []).flat());
  for (const p of netlist.nets[net]) {
    if (!map.pins[p]) out.push(`${p} is not drawn in the picture`);
    else if (!reach.has(p) && !internal.has(p)) out.push(`${p}: no traced wire reaches it - look closely`);
  }
  for (const p of reach) if (!pinNet[p]) out.push(`${p} is on this wire in the picture but left off the board`);
  return out;
}

function draw() {
  gWires.replaceChildren();
  gPins.replaceChildren();
  gVeil.style.display = sel ? '' : 'none';
  if (!sel) return;
  const col = netColor(sel);
  for (const w of map.wires.filter((x) => x.net === sel))
    for (const [x1, y1, x2, y2] of w.segs) el('line', { x1, y1, x2, y2, stroke: col, class: 'hl-wire' }, gWires);
  const reach = traced(sel);
  for (const p of netlist.nets[sel]) {
    const at = map.pins[p];
    if (!at) continue;
    const [x, y] = at;
    el('circle', { cx: x, cy: y, r: 15, stroke: col, class: 'hl-pin' + (reach.has(p) ? '' : ' unsure') }, gPins);
    el('text', { x: x + 12, y: y - 14, class: 'hl-label', transform: `rotate(-35 ${x + 12} ${y - 14})` }, gPins, p);
  }
  for (const p of reach) {
    if (pinNet[p]) continue;
    const [x, y] = map.pins[p];
    el('circle', { cx: x, cy: y, r: 13, class: 'hl-pin left-out' }, gPins);
  }
}

function renderList() {
  const s = check.summary;
  $('#summary').textContent = `${s.verified} of ${s.total} nets verified`;
  const issues = $('#issues');
  issues.replaceChildren();
  if (sel) for (const text of problems(sel)) {
    const p = document.createElement('p');
    p.className = 'warn';
    p.textContent = text;
    issues.appendChild(p);
  }
  const list = $('#nets');
  list.replaceChildren();
  for (const [name, pins] of Object.entries(netlist.nets)) {
    const li = document.createElement('li');
    li.className = (check.nets[name].verified ? 'ok' : '') + (sel === name ? ' sel' : '');
    const row = document.createElement('div');
    row.className = 'row';
    const dot = document.createElement('span');
    dot.className = 'dot';
    dot.style.background = netColor(name);
    const nm = document.createElement('span');
    nm.className = 'name';
    nm.textContent = name;
    const st = document.createElement('span');
    st.className = 'st';
    st.textContent = problems(name).length ? `${pins.length} pins · check` : `${pins.length} pins`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = check.nets[name].verified;
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => send({ op: 'verify', net: name, value: cb.checked });
    row.append(dot, nm, st, cb);
    li.appendChild(row);
    if (sel === name) {
      const detail = document.createElement('div');
      detail.className = 'pins';
      detail.textContent = pins.join('  ');
      li.appendChild(detail);
    }
    li.onclick = () => select(sel === name ? null : name);
    list.appendChild(li);
    if (sel === name) li.scrollIntoView({ block: 'nearest' });
  }
}

function select(net) {
  sel = net;
  draw();
  renderList();
}

function flash(msg) {
  $('#toast').textContent = msg;
  clearTimeout(flash.timer);
  flash.timer = setTimeout(() => ($('#toast').textContent = ''), 4000);
}
function send(op) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(op));
  else flash('Not connected - change not saved');
}
function connect() {
  ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onopen = () => { $('#conn').textContent = 'saved live'; $('#conn').className = ''; };
  ws.onclose = () => { $('#conn').textContent = 'offline'; $('#conn').className = 'off'; setTimeout(connect, 1000); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t === 'error') return flash(m.message);
    ({ netlist, check } = m);
    pinNet = {};
    for (const [net, pins] of Object.entries(netlist.nets)) for (const p of pins) pinNet[p] = net;
    if (sel && !netlist.nets[sel]) sel = null;
    draw();
    renderList();
  };
}

document.addEventListener('keydown', (e) => {
  if (!netlist || e.metaKey || e.ctrlKey || e.altKey) return;
  const names = Object.keys(netlist.nets);
  const i = names.indexOf(sel);
  if (e.key === 'ArrowDown') select(names[Math.min(names.length - 1, i + 1)]);
  else if (e.key === 'ArrowUp') select(names[Math.max(0, i - 1)]);
  else if (e.key === ' ' && sel) send({ op: 'verify', net: sel, value: !check.nets[sel].verified });
  else if (e.key === 'Escape') select(null);
  else if (e.key === '+' || e.key === '=') setZoom(zoom * 1.25);
  else if (e.key === '-') setZoom(zoom / 1.25);
  else return;
  e.preventDefault();
});
$('#zoomin').onclick = () => setZoom(zoom * 1.25);
$('#zoomout').onclick = () => setZoom(zoom / 1.25);
$('#none').onclick = () => select(null);

fetch('/schematic-map.json').then((r) => r.json()).then((m) => { map = m; setup(); connect(); });
