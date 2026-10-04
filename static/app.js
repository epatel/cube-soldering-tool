// Solder planner client. The server owns the state: every edit is sent as an op
// over the websocket and the page redraws from the snapshot that comes back.
// Nodes are [col, row] seen from the component side; pos() mirrors them for the solder-side view.

const U = 28, COLS = 18, ROWS = 24;
const NS = 'http://www.w3.org/2000/svg';
const $ = (s) => document.querySelector(s);
const svg = $('#board');
const WIRE_COLORS = ['#e5484d', '#2b2f36', '#f2c94c', '#3fb950', '#4c8dff', '#f5f5f5', '#f08c3a'];
const NET_COLORS = { GND: '#9aa4b1', VBAT: '#ff5d5d', '5V': '#ff9f43', '3V3': '#ffd43b' };
const HINTS = {
  select: 'Drag a pin to move it. Rigid parts move as one; Shift+drag moves any part as one. R rotates the clicked part. Click a link, then Delete.',
  solder: 'Drag across pads. Every pad the solder runs over is joined.',
  wire: 'Drag for a straight wire, or click point by point and click the last point again (or Enter) to finish. Only the two ends are joined.',
  erase: 'Click a solder path or wire to remove it.',
};

let state = null, netlist = null, check = null, pinNet = {}, ws = null;
let drag = null, solder = null, wire = null;
const ui = { view: localStorage.getItem('view') || 'bottom', tool: 'select', color: WIRE_COLORS[0],
  net: null, link: null, part: null, rats: false, hover: null,
  zoom: Number(localStorage.getItem('zoom')) || 1, fade: localStorage.getItem('fade') !== 'off' };

const el = (tag, attrs = {}, parent, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};
const layer = (name) => el('g', { id: name }, svg);
svg.setAttribute('viewBox', `${-5.5 * U} ${-2.7 * U} ${30 * U} ${30.9 * U}`);
const gBoard = layer('l-board'), gSolder = layer('l-solder'), gBody = layer('l-body'), gWires = layer('l-wires'),
  gPins = layer('l-pins'), gRats = layer('l-rats'), gGlow = layer('l-glow'), gPrev = layer('l-preview');

// ---- geometry ----
const validNode = ([c, r]) =>
  (c >= 1 && c <= COLS && r >= 1 && r <= ROWS) ||
  ((r === 0 || r === ROWS + 1) && c >= 2 && c <= COLS - 1) ||
  ((c === 0 || c === COLS + 1) && r >= 1 && r <= ROWS);
const key = ([c, r]) => (c === 0 ? 'railL' : c === COLS + 1 ? 'railR' : `${c},${r}`);
const same = (a, b) => !!a && !!b && a[0] === b[0] && a[1] === b[1];
const gx = (x) => (ui.view === 'bottom' ? COLS + 1 - x : x) * U;
function pos([c, r]) {
  const x = c === 0 ? 0.1 : c === COLS + 1 ? COLS + 0.9 : c;
  const y = r === 0 ? -1.1 : r === ROWS + 1 ? ROWS + 2.1 : r;
  return [gx(x), y * U];
}
function nodeAt(e) {
  const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(svg.getScreenCTM().inverse());
  let x = p.x / U;
  const y = p.y / U;
  if (ui.view === 'bottom') x = COLS + 1 - x;
  if (x < -0.4 || x > COLS + 1.4 || y < -1.9 || y > ROWS + 2.9) return null;
  const n = [x < 0.55 ? 0 : x > COLS + 0.45 ? COLS + 1 : Math.round(x), y < 0.2 ? 0 : y > ROWS + 0.8 ? ROWS + 1 : Math.round(y)];
  return validNode(n) ? n : null;
}
function nodeName([c, r]) {
  const cc = String(c).padStart(2, '0');
  if (c === 0 || c === COLS + 1) return `rail by column ${c === 0 ? '01' : COLS}`;
  if (r === 0) return `top pad ${cc}`;
  if (r === ROWS + 1) return `bottom pad ${cc}`;
  return String.fromCharCode(64 + r) + cc;
}
const netColor = (name) => {
  if (NET_COLORS[name]) return NET_COLORS[name];
  let h = 0;
  for (const ch of name) h = (h * 37 + ch.charCodeAt(0)) % 360;
  return `hsl(${h} 75% 62%)`;
};
const splitPin = (full) => [full.slice(0, full.indexOf('.')), full.slice(full.indexOf('.') + 1)];
const pinNode = (full) => { const [id, pn] = splitPin(full); return state.parts[id].pins[pn]; };
function pinsAt(n) {
  const out = [];
  for (const [part, p] of Object.entries(state.parts))
    for (const [pin, node] of Object.entries(p.pins)) if (same(node, n)) out.push({ part, pin });
  return out;
}

// ---- drawing ----
function drawBoard() {
  gBoard.replaceChildren();
  el('rect', { x: -0.9 * U, y: -2.2 * U, width: 20.8 * U, height: 29.4 * U, rx: 16, class: 'pcb' }, gBoard);
  for (const [x, y] of [[0, -1.3], [19, -1.3], [0, 26.3], [19, 26.3]])
    el('circle', { cx: x * U, cy: y * U, r: 0.42 * U, class: 'mount' }, gBoard);
  for (const c of [0, COLS + 1]) {
    const [x] = pos([c, 1]);
    el('rect', { x: x - 0.17 * U, y: 0.4 * U, width: 0.34 * U, height: 24.2 * U, rx: 2, class: 'rail' }, gBoard);
  }
  for (let c = 1; c <= COLS; c++) {
    const cc = String(c).padStart(2, '0');
    el('text', { x: gx(c), y: 0.22 * U, class: 'silk' }, gBoard, cc);
    el('text', { x: gx(c), y: 24.8 * U, class: 'silk' }, gBoard, cc);
    if (c >= 2 && c <= COLS - 1)
      for (const r of [0, ROWS + 1]) {
        const [x, y] = pos([c, r]);
        el('rect', { x: x - 0.31 * U, y: y - 0.65 * U, width: 0.62 * U, height: 1.3 * U, rx: 0.3 * U, class: 'pad' }, gBoard);
      }
    for (let r = 1; r <= ROWS; r++) {
      const [x, y] = pos([c, r]);
      el('circle', { cx: x, cy: y, r: 0.36 * U, class: 'pad' }, gBoard);
      el('circle', { cx: x, cy: y, r: 0.16 * U, class: 'hole' }, gBoard);
    }
  }
  for (let r = 1; r <= ROWS; r++)
    for (const x of [-0.5, COLS + 1.5]) el('text', { x: gx(x), y: r * U, class: 'silk' }, gBoard, String.fromCharCode(64 + r));
  el('text', { x: 9.5 * U, y: 27.85 * U, class: 'viewtag' }, gBoard,
    ui.view === 'bottom' ? 'SOLDER SIDE · SEEN FROM BELOW · MIRRORED' : 'COMPONENT SIDE · SEEN FROM ABOVE');
}

const points = (path) => path.map((n) => pos(n).join(',')).join(' ');

function drawLinks() {
  gSolder.replaceChildren();
  gWires.replaceChildren();
  for (const l of state.links) {
    const sel = ui.link === l.id ? ' sel-link' : '';
    if (l.type === 'solder') {
      el('polyline', { points: points(l.path), class: 'solder' + sel, 'data-link': l.id }, gSolder);
      continue;
    }
    el('polyline', { points: points(l.path), class: 'wire-case' + sel, 'data-link': l.id }, gWires);
    el('polyline', { points: points(l.path), class: 'wire', stroke: l.color, 'data-link': l.id }, gWires);
    for (const n of [l.path[0], l.path[l.path.length - 1]]) {
      const [x, y] = pos(n);
      el('circle', { cx: x, cy: y, r: 0.2 * U, fill: l.color, class: 'wire-end', 'data-link': l.id }, gWires);
    }
  }
}

// Bodies are drawn in a frame that runs from the first pin (at -len/2) to the last pin (+len/2).
function drawTwoPin(g, def, a, b, stroke) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
  const mid = `translate(${(a[0] + b[0]) / 2} ${(a[1] + b[1]) / 2})`;
  const body = el('g', { transform: `${mid} rotate(${ang})` }, g);
  el('line', { x1: -len / 2, y1: 0, x2: len / 2, y2: 0, class: 'lead' }, body);
  let labelOff = 0.75 * U;
  if (def.kind === 'resistor') {
    const w = 2.4 * U, h = 0.78 * U;
    el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: h * 0.4, fill: def.color, stroke, class: 'body-solid' }, body);
    (def.bands || []).forEach((c, i) =>
      el('rect', { x: -w / 2 + (i === 3 ? 0.78 : 0.16 + i * 0.16) * w, y: -h / 2, width: 0.08 * w, height: h, fill: c }, body));
  } else if (def.kind === 'ceramic') {
    el('ellipse', { rx: 0.95 * U, ry: 0.36 * U, fill: def.color, stroke, class: 'body-solid' }, body);
  } else {
    const r = 1.05 * U;
    labelOff = r + 0.3 * U;
    el('circle', { r, fill: def.color, stroke, class: 'body-solid' }, body);
    // the stripe on the can marks the negative leg, which is the first pin
    el('path', { d: `M ${-r / 2} ${-r * 0.866} A ${r} ${r} 0 0 0 ${-r / 2} ${r * 0.866} Z`, fill: '#c9ced6', opacity: 0.8 }, body);
  }
  const upright = ang > 90 || ang <= -90 ? ang + 180 : ang;
  const label = el('g', { transform: `${mid} rotate(${def.kind === 'elec' ? 0 : upright})` }, g);
  el('text', { x: 0, y: -labelOff, class: 'part-label' }, label, def.label);
}

// An off-board connector: drawn beside the board, one coloured wire per pin to the pad it is soldered to.
function drawConn(g, id, def, pins) {
  // JSON object keys that look like integers come back sorted, so order the pins by footprint instead
  const names = Object.keys(def.pins).sort((a, b) => def.pins[a][1] - def.pins[b][1] || def.pins[a][0] - def.pins[b][0]);
  const x = gx(def.dock[0]), top = def.dock[1] * U, pitch = 0.9 * U, n = names.length;
  const out = x < gx((COLS + 1) / 2) ? -1 : 1, inw = -out;
  g.setAttribute('class', 'body conn');
  // The wires run as one cable to a tie just off the board edge, then fan out to their pads.
  // Inside the tie they are stacked by where they end up, so the fan-out over the board does not cross.
  const tx = x + inw * 1.25 * U, ty = top + ((n - 1) * pitch) / 2, gap = 0.13 * U;
  const lands = names.map((pn) => pos(pins[pn]));
  const slot = [];
  names.map((_, i) => i)
    .sort((a, b) => lands[a][1] - lands[b][1] || inw * (lands[a][0] - lands[b][0]))
    .forEach((i, k) => { slot[i] = ty + (k - (n - 1) / 2) * gap; });
  names.forEach((pn, i) => {
    const y = top + i * pitch, col = def.wires[i] || '#999', sy = slot[i];
    const [nx, ny] = lands[i];
    const reach = Math.max(1.2 * U, Math.abs(nx - tx) * 0.45);
    const d = `M ${x} ${y} C ${x + inw * 0.7 * U} ${y}, ${tx - inw * 0.6 * U} ${sy}, ${tx} ${sy} ` +
      `C ${tx + inw * reach} ${sy}, ${nx - inw * reach * 0.6} ${ny}, ${nx} ${ny}`;
    el('path', { d, class: 'conn-case' }, g);
    el('path', { d, class: 'conn-wire', stroke: col }, g);
    el('circle', { cx: nx, cy: ny, r: 0.22 * U, fill: col, class: 'land' }, g);
  });
  el('rect', { x: tx - 0.13 * U, y: ty - (n * gap) / 2 - 0.08 * U, width: 0.26 * U, height: n * gap + 0.16 * U, rx: 2, class: 'tie' }, g);
  el('rect', { x: x - 0.5 * U, y: top - 0.55 * U, width: U, height: (n - 1) * pitch + 1.1 * U, rx: 4, class: 'conn-body hit' }, g);
  el('text', { x, y: top - 1.0 * U, class: 'part-label' }, g, def.label);
  names.forEach((pn, i) => {
    const y = top + i * pitch, net = pinNet[`${id}.${pn}`];
    el('circle', { cx: x, cy: y, r: 0.3 * U, fill: def.wires[i] || '#999', class: 'land hit' }, g);
    el('text', { x: x + out * 0.7 * U, y, class: 'pin-label', 'text-anchor': out < 0 ? 'end' : 'start' }, g, net && net !== pn ? `${pn} ${net}` : pn);
  });
}

function drawParts() {
  gBody.replaceChildren();
  gPins.replaceChildren();
  for (const [id, def] of Object.entries(netlist.parts)) {
    const dragging = drag && drag.part === id;
    const pins = dragging ? drag.pins : state.parts[id].pins;
    const bad = dragging && !drag.ok;
    if (def.kind === 'conn') {
      drawConn(el('g', { class: 'body', opacity: bad ? 0.4 : 1 }, gPins), id, def, pins);
      continue;
    }
    const pts = Object.entries(pins).map(([pn, n]) => [pn, pos(n)]);
    const xs = pts.map((p) => p[1][0]), ys = pts.map((p) => p[1][1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const g = el('g', { class: 'body' }, gBody);
    const stroke = ui.part === id ? '#fff' : '#0008';
    if (def.kind === 'esp' || def.kind === 'inline') {
      const pad = (def.kind === 'esp' ? 0.75 : 0.5) * U;
      el('rect', { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad, rx: 6,
        class: 'body-shape', fill: def.color, stroke: ui.part === id ? '#fff' : def.color }, g);
      el('text', { x: cx, y: def.kind === 'esp' ? cy : y0 - 0.95 * U, class: 'part-label' }, g, def.label);
    } else {
      drawTwoPin(g, def, pts[0][1], pts[pts.length - 1][1], stroke);
    }
    if (def.kind === 'esp' && pins.EN && pins.D23 && pins.VIN && pins['3V3']) {
      const mid = (a, b) => [(pos(a)[0] + pos(b)[0]) / 2, (pos(a)[1] + pos(b)[1]) / 2];
      const [ax, ay] = mid(pins.EN, pins.D23), [ux, uy] = mid(pins.VIN, pins['3V3']);
      el('text', { x: ax, y: ay, class: 'part-label' }, g, 'antenna end');
      el('text', { x: ux, y: uy, class: 'part-label' }, g, 'USB end');
    }
    for (const [pn, [x, y]] of pts) {
      const net = pinNet[`${id}.${pn}`];
      const col = net ? netColor(net) : '#7d8794';
      el('circle', { cx: x, cy: y, r: 0.33 * U, class: 'pin' + (bad ? ' bad' : ''), fill: col, stroke: col }, gPins);
      const t = { class: 'pin-label', 'text-anchor': 'middle', x, y: y - 0.62 * U };
      if (def.kind === 'esp') {
        const inward = x < cx ? 1 : -1;
        Object.assign(t, { x: x + inward * 0.5 * U, y, 'text-anchor': inward > 0 ? 'start' : 'end' });
      }
      el('text', t, gPins, pn);
    }
  }
}

function drawRats() {
  gRats.replaceChildren();
  if (!ui.rats) return;
  for (const [name, net] of Object.entries(check.nets)) {
    if (net.groups.length < 2) continue;
    const groups = net.groups.map((g) => g.map((p) => pos(pinNode(p))));
    const tree = [0], rest = groups.map((_, i) => i).slice(1);
    while (rest.length) {
      let best = null;
      for (const i of tree) for (const j of rest) for (const a of groups[i]) for (const b of groups[j]) {
        const d = (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2;
        if (!best || d < best.d) best = { d, a, b, j };
      }
      el('line', { x1: best.a[0], y1: best.a[1], x2: best.b[0], y2: best.b[1], class: 'rat' + (ui.net === name ? ' sel' : '') }, gRats);
      tree.push(best.j);
      rest.splice(rest.indexOf(best.j), 1);
    }
  }
}

function drawGlow() {
  gGlow.replaceChildren();
  const ring = (k, cls) => {
    if (k === 'railL' || k === 'railR') {
      const [x] = pos([k === 'railL' ? 0 : COLS + 1, 1]);
      el('rect', { x: x - 0.3 * U, y: 0.3 * U, width: 0.6 * U, height: 24.4 * U, rx: 4, class: cls }, gGlow);
    } else {
      const [x, y] = pos(k.split(',').map(Number));
      el('circle', { cx: x, cy: y, r: 0.47 * U, class: cls }, gGlow);
    }
  };
  if (ui.net && netlist.nets[ui.net]) for (const p of netlist.nets[ui.net]) ring(key(pinNode(p)), 'glow net');
  if (!ui.hover) return;
  const g = check.node_group[key(ui.hover)];
  if (g === undefined) return ring(key(ui.hover), 'glow');
  const cls = 'glow' + ((check.groups[g]?.nets.length || 0) > 1 ? ' short' : '');
  for (const [k, v] of Object.entries(check.node_group)) if (v === g) ring(k, cls);
}

function drawPreview() {
  gPrev.replaceChildren();
  if (solder) el('polyline', { points: points(solder), class: 'solder preview' }, gPrev);
  if (wire) {
    const path = ui.hover && !same(ui.hover, wire.path[wire.path.length - 1]) ? [...wire.path, ui.hover] : wire.path;
    el('polyline', { points: points(path), class: 'wire preview', stroke: ui.color }, gPrev);
  }
}

function renderSide() {
  const s = check.summary;
  const summary = $('#summary');
  summary.textContent = `${s.ok} of ${s.total} nets complete`;
  const sub = document.createElement('span');
  sub.textContent = `${s.shorts} shorts · ${s.verified} of ${s.total} nets verified`;
  summary.appendChild(sub);

  const issues = $('#issues');
  issues.replaceChildren();
  const note = (cls, text) => { const p = document.createElement('p'); p.className = cls; p.textContent = text; issues.appendChild(p); };
  for (const sh of check.shorts) note('short', `Short: ${sh.nets.join(' + ')} joined through ${sh.pins.join(', ')}`);
  for (const w of check.warnings) note('warn', w);

  const list = $('#nets');
  list.replaceChildren();
  for (const [name, net] of Object.entries(check.nets)) {
    const total = netlist.nets[name].length;
    const li = document.createElement('li');
    li.className = net.status + (ui.net === name ? ' sel' : '');
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
    st.textContent = net.status === 'ok' ? '✓ joined' : net.status === 'short' ? 'SHORT' : `${net.groups[0].length > 1 ? net.groups[0].length : 0}/${total} pins`;
    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.checked = net.verified;
    cb.title = 'I checked this net against the schematic';
    cb.onclick = (e) => e.stopPropagation();
    cb.onchange = () => send({ op: 'verify', net: name, value: cb.checked });
    row.append(dot, nm, st, cb);
    li.appendChild(row);
    if (ui.net === name) {
      const pins = document.createElement('div');
      pins.className = 'pins';
      net.groups.forEach((g, i) => {
        if (i) pins.append('  |  ');
        const span = document.createElement(i === 0 && g.length > 1 ? 'b' : 'span');
        span.textContent = g.join(' ');
        pins.appendChild(span);
      });
      li.appendChild(pins);
    }
    li.onclick = () => { ui.net = ui.net === name ? null : name; render(); };
    list.appendChild(li);
  }
}

function setStatus() {
  const n = ui.hover;
  if (!n || !check) return void ($('#status').textContent = HINTS[ui.tool]);
  const out = [nodeName(n)];
  const g = check.node_group[key(n)];
  const info = g === undefined ? null : check.groups[g];
  if (info) {
    out.push(info.pins.join(' '));
    out.push(info.nets.length ? `net ${info.nets.join(' + ')}${info.nets.length > 1 ? '  — SHORT' : ''}` : 'not in the schematic');
  } else if (g !== undefined) out.push('joined pads, no pin');
  $('#status').textContent = out.join('   ·   ');
}

function renderChrome() {
  for (const b of document.querySelectorAll('#tools button')) b.classList.toggle('on', b.dataset.tool === ui.tool);
  for (const b of document.querySelectorAll('#colors button')) b.classList.toggle('on', b.dataset.color === ui.color);
  $('#flip').textContent = ui.view === 'bottom' ? 'View: solder side' : 'View: component side';
  svg.classList.toggle('erasing', ui.tool === 'erase');
  svg.classList.toggle('view-bottom', ui.view === 'bottom');
  svg.classList.toggle('view-top', ui.view !== 'bottom');
  svg.classList.toggle('fade', ui.fade);
  $('#fade').checked = ui.fade;
  setStatus();
}

function render() {
  renderChrome();
  if (!state) return;
  drawLinks();
  drawParts();
  drawRats();
  drawGlow();
  drawPreview();
  renderSide();
}

// ---- server ----
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
    ({ state, netlist, check } = m);
    pinNet = {};
    for (const [net, pins] of Object.entries(netlist.nets)) for (const p of pins) pinNet[p] = net;
    if (ui.link && !state.links.some((l) => l.id === ui.link)) ui.link = null;
    if (ui.part && !state.parts[ui.part]) ui.part = null;
    $('#undo').disabled = !m.can_undo;
    $('#redo').disabled = !m.can_redo;
    render();
  };
}

// ---- editing ----
function extendSolder(path, n) {
  let last = path[path.length - 1];
  while (!same(last, n)) {
    const step = [last[0] + Math.sign(n[0] - last[0]), last[1] + Math.sign(n[1] - last[1])];
    if (!validNode(step)) return;
    if (same(path[path.length - 2], step)) path.pop();
    else path.push(step);
    last = path[path.length - 1];
  }
}
function finishWire() {
  if (wire && wire.path.length > 1) send({ op: 'add', link: { type: 'wire', path: wire.path, color: ui.color } });
  wire = null;
  drawPreview();
}
function cancelDrawing() {
  drag = solder = wire = null;
}
function setTool(t) {
  cancelDrawing();
  ui.tool = t;
  render();
}
function rotatePart() {
  const id = ui.part;
  if (!id) return flash('Click a part first, then press R');
  const pins = state.parts[id].pins;
  const [pc, pr] = Object.values(pins)[0];
  const out = {};
  for (const [name, [c, r]] of Object.entries(pins)) out[name] = [pc - (r - pr), pr + (c - pc)];
  if (!Object.values(out).every(validNode)) return flash('No room to rotate there');
  send({ op: 'move', part: id, pins: out });
}
function setZoom(z) {
  ui.zoom = Math.min(4, Math.max(1, z));
  localStorage.setItem('zoom', ui.zoom);
  svg.style.height = `${ui.zoom * 100}%`;
}
function flipView() {
  ui.view = ui.view === 'bottom' ? 'top' : 'bottom';
  localStorage.setItem('view', ui.view);
  drawBoard();
  render();
}

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !state) return;
  const n = nodeAt(e);
  const linkId = Number(e.target.getAttribute?.('data-link')) || null;
  if (ui.tool === 'erase') {
    if (linkId) send({ op: 'del', id: linkId });
    return;
  }
  if (ui.tool === 'solder') {
    if (n) { solder = [n]; svg.setPointerCapture(e.pointerId); drawPreview(); }
    return;
  }
  if (ui.tool === 'wire') {
    if (!n) return;
    if (!wire) { wire = { path: [n], dragging: true }; svg.setPointerCapture(e.pointerId); }
    else if (same(n, wire.path[wire.path.length - 1])) return finishWire();
    else wire.path.push(n);
    return drawPreview();
  }
  const hit = n && pinsAt(n)[0];
  if (hit) {
    ui.part = hit.part;
    ui.link = null;
    drag = { part: hit.part, pin: hit.pin, from: n, whole: netlist.parts[hit.part].rigid || e.shiftKey,
      pins: state.parts[hit.part].pins, ok: true, moved: false };
    svg.setPointerCapture(e.pointerId);
  } else {
    ui.link = linkId;
    ui.part = null;
  }
  render();
});

svg.addEventListener('pointermove', (e) => {
  if (!state) return;
  const n = nodeAt(e);
  if (same(n, ui.hover) || (!n && !ui.hover)) return;
  ui.hover = n;
  if (drag && n) {
    const start = state.parts[drag.part].pins;
    const [dc, dr] = [n[0] - drag.from[0], n[1] - drag.from[1]];
    drag.pins = drag.whole
      ? Object.fromEntries(Object.entries(start).map(([k, [c, r]]) => [k, [c + dc, r + dr]]))
      : { ...start, [drag.pin]: n };
    const ends = Object.values(drag.pins), minLen = netlist.parts[drag.part].min_len;
    drag.why = !ends.every(validNode) ? 'That would put a pin off the board'
      : minLen && Math.hypot(ends[0][0] - ends[1][0], ends[0][1] - ends[1][1]) < minLen ? `${drag.part} needs its pins at least ${minLen} holes apart`
      : null;
    drag.ok = !drag.why;
    drag.moved = dc !== 0 || dr !== 0;
    drawParts();
  }
  if (solder && n) extendSolder(solder, n);
  drawGlow();
  drawPreview();
  setStatus();
});

svg.addEventListener('pointerup', (e) => {
  const n = nodeAt(e);
  if (drag) {
    const d = drag;
    drag = null;
    if (!d.ok) flash(d.why);
    else if (d.moved) send({ op: 'move', part: d.part, pins: d.pins });
    render();
  }
  if (solder) {
    const path = solder;
    solder = null;
    if (path.length > 1) send({ op: 'add', link: { type: 'solder', path } });
    drawPreview();
  }
  if (wire && wire.dragging) {
    wire.dragging = false;
    if (n && !same(n, wire.path[0])) { wire.path.push(n); finishWire(); }
  }
});
svg.addEventListener('pointerleave', () => { ui.hover = null; drawGlow(); setStatus(); });

document.addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  const k = e.key.toLowerCase();
  if ((e.metaKey || e.ctrlKey) && k === 'z') { e.preventDefault(); return send({ op: e.shiftKey ? 'redo' : 'undo' }); }
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const tools = { v: 'select', s: 'solder', w: 'wire', e: 'erase' };
  if (tools[k]) setTool(tools[k]);
  else if (k === 'f') flipView();
  else if (k === '+' || k === '=') setZoom(ui.zoom * 1.25);
  else if (k === '-') setZoom(ui.zoom / 1.25);
  else if (k === 'r') rotatePart();
  else if (k === 'enter') finishWire();
  else if (k === 'escape') { cancelDrawing(); ui.link = ui.part = null; render(); }
  else if ((k === 'delete' || k === 'backspace') && ui.link) send({ op: 'del', id: ui.link });
});

for (const b of document.querySelectorAll('#tools button')) b.onclick = () => setTool(b.dataset.tool);
for (const c of WIRE_COLORS) {
  const b = document.createElement('button');
  b.dataset.color = c;
  b.style.background = c;
  b.style.setProperty('--c', c);
  b.title = 'Wire colour';
  b.onclick = () => { ui.color = c; renderChrome(); };
  $('#colors').appendChild(b);
}
$('#flip').onclick = flipView;
$('#zoomin').onclick = () => setZoom(ui.zoom * 1.25);
$('#zoomout').onclick = () => setZoom(ui.zoom / 1.25);
$('#rats').onchange = (e) => { ui.rats = e.target.checked; render(); };
$('#fade').onchange = (e) => { ui.fade = e.target.checked; localStorage.setItem('fade', ui.fade ? 'on' : 'off'); renderChrome(); };
$('#schem').onclick = () => { $('#schematic').hidden = !$('#schematic').hidden; };
$('#undo').onclick = () => send({ op: 'undo' });
$('#redo').onclick = () => send({ op: 'redo' });
$('#reset').onclick = () => send({ op: 'reset' });

setZoom(ui.zoom);
drawBoard();
renderChrome();
connect();
