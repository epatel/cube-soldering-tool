// Print sheets: both sides of the board as line art on white, plus the wiring lists.
// Read-only: it takes one snapshot from the websocket and redraws when the board changes.

const U = 28, COLS = 18, ROWS = 24;
const NS = 'http://www.w3.org/2000/svg';
const $ = (s) => document.querySelector(s);
const COLOR_NAMES = { '#e5484d': 'red', '#2b2f36': 'black', '#f2c94c': 'yellow', '#3fb950': 'green',
  '#4c8dff': 'blue', '#f5f5f5': 'white', '#f08c3a': 'orange', '#8b5a2b': 'brown' };

let state = null, netlist = null, check = null, pinNet = {}, heavy = new Set();

const el = (tag, attrs = {}, parent, text) => {
  const e = document.createElementNS(NS, tag);
  for (const k in attrs) e.setAttribute(k, attrs[k]);
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
};
const html = (tag, parent, text, cls) => {
  const e = document.createElement(tag);
  if (text !== undefined) e.textContent = text;
  if (cls) e.className = cls;
  if (parent) parent.appendChild(e);
  return e;
};

const key = ([c, r]) => (c === 0 ? 'railL' : c === COLS + 1 ? 'railR' : `${c},${r}`);
function nodeName([c, r]) {
  const cc = String(c).padStart(2, '0');
  if (c === 0 || c === COLS + 1) return `rail by column ${c === 0 ? '01' : COLS}`;
  if (r === 0) return `top pad ${cc}`;
  if (r === ROWS + 1) return `bottom pad ${cc}`;
  return String.fromCharCode(64 + r) + cc;
}
const netAt = (node) => {
  const g = check.node_group[key(node)];
  return (g !== undefined && check.groups[g]?.nets.join(' + ')) || '';
};
// JSON keys that look like integers come back sorted, so order pins by footprint instead.
const pinOrder = (def) => Object.keys(def.pins).sort((a, b) => def.pins[a][1] - def.pins[b][1] || def.pins[a][0] - def.pins[b][0]);
const colorName = (c) => COLOR_NAMES[c] || c;

function drawSide(svg, view) {
  const bottom = view === 'bottom';
  const gx = (x) => (bottom ? COLS + 1 - x : x) * U;
  const pos = ([c, r]) => [gx(c === 0 ? 0.1 : c === COLS + 1 ? COLS + 0.9 : c), (r === 0 ? -1.1 : r === ROWS + 1 ? ROWS + 2.1 : r) * U];
  const points = (path) => path.map((n) => pos(n).join(',')).join(' ');
  svg.replaceChildren();
  svg.setAttribute('viewBox', `${-1.6 * U} ${-2.5 * U} ${22.2 * U} ${30.4 * U}`);

  // board
  el('rect', { x: -0.9 * U, y: -2.2 * U, width: 20.8 * U, height: 29.4 * U, rx: 16, class: 'pcb' }, svg);
  for (const [x, y] of [[0, -1.3], [19, -1.3], [0, 26.3], [19, 26.3]]) el('circle', { cx: x * U, cy: y * U, r: 0.42 * U, class: 'mount' }, svg);
  for (const c of [0, COLS + 1]) el('rect', { x: pos([c, 1])[0] - 0.17 * U, y: 0.4 * U, width: 0.34 * U, height: 24.2 * U, rx: 2, class: 'rail' }, svg);
  for (let c = 1; c <= COLS; c++) {
    const cc = String(c).padStart(2, '0');
    el('text', { x: gx(c), y: 0.22 * U, class: 'silk' }, svg, cc);
    el('text', { x: gx(c), y: 24.8 * U, class: 'silk' }, svg, cc);
    if (c >= 2 && c <= COLS - 1) for (const r of [0, ROWS + 1]) {
      const [x, y] = pos([c, r]);
      el('rect', { x: x - 0.31 * U, y: y - 0.65 * U, width: 0.62 * U, height: 1.3 * U, rx: 0.3 * U, class: 'pad' }, svg);
    }
    for (let r = 1; r <= ROWS; r++) {
      const [x, y] = pos([c, r]);
      el('circle', { cx: x, cy: y, r: 0.34 * U, class: 'pad' }, svg);
      el('circle', { cx: x, cy: y, r: 0.1 * U, class: 'hole' }, svg);
    }
  }
  for (let r = 1; r <= ROWS; r++) for (const x of [-0.5, COLS + 1.5]) el('text', { x: gx(x), y: r * U, class: 'silk' }, svg, String.fromCharCode(64 + r));

  // solder: on the solder side, so pale when seen from the component side
  const far = (isFar) => (isFar ? ' far' : '');
  for (const l of state.links.filter((x) => x.type === 'solder'))
    el('polyline', { points: points(l.path), class: 'solder' + far(!bottom) + (bottom && heavy.has(l.id) ? ' heavy' : '') }, svg);

  // component bodies: on the component side
  for (const [id, def] of Object.entries(netlist.parts)) {
    if (def.kind === 'conn') continue;
    const pts = pinOrder(def).map((pn) => pos(state.parts[id].pins[pn]));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const shape = 'shape' + far(bottom), fill = bottom ? 'none' : def.color;
    if (def.kind === 'esp' || def.kind === 'inline') {
      const pad = 0.46 * U;
      el('rect', { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + 2 * pad, rx: 6, class: shape,
        fill: bottom ? 'none' : def.color, 'fill-opacity': 0.12 }, svg);
      el('text', { x: cx, y: def.kind === 'esp' ? cy : y0 - 0.95 * U, class: 'part-label' + far(bottom) }, svg, def.label);
      continue;
    }
    const [a, b] = [pts[0], pts[pts.length - 1]];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
    const mid = `translate(${cx} ${cy})`;
    const g = el('g', { transform: `${mid} rotate(${ang})` }, svg);
    el('line', { x1: -len / 2, y1: 0, x2: len / 2, y2: 0, class: 'lead' + far(bottom) }, g);
    let off = 0.75 * U;
    if (def.kind === 'resistor') {
      const w = 2.4 * U, h = 0.78 * U;
      el('rect', { x: -w / 2, y: -h / 2, width: w, height: h, rx: h * 0.4, class: shape, fill }, g);
      if (!bottom) (def.bands || []).forEach((c, i) =>
        el('rect', { x: -w / 2 + (i === 3 ? 0.78 : 0.16 + i * 0.16) * w, y: -h / 2, width: 0.08 * w, height: h, fill: c }, g));
    } else if (def.kind === 'ceramic') {
      el('ellipse', { rx: 0.95 * U, ry: 0.36 * U, class: shape, fill }, g);
    } else {
      const r = 1.05 * U;
      off = r + 0.3 * U;
      el('circle', { r, class: shape, fill, 'fill-opacity': 0.75 }, g);
      el('path', { d: `M ${-r / 2} ${-r * 0.866} A ${r} ${r} 0 0 0 ${-r / 2} ${r * 0.866} Z`, fill: bottom ? '#e3e3e3' : '#d5d8dd' }, g);
    }
    const upright = ang > 90 || ang <= -90 ? ang + 180 : ang;
    const lg = el('g', { transform: `${mid} rotate(${def.kind === 'elec' ? 0 : upright})` }, svg);
    el('text', { x: 0, y: -off, class: 'part-label' + far(bottom) }, lg, def.label);
  }

  // jumper wires: on the component side
  state.links.filter((x) => x.type === 'wire').forEach((l, i) => {
    if (bottom) return void el('polyline', { points: points(l.path), class: 'wire far' }, svg);
    const hv = heavy.has(l.id) ? ' heavy' : '';
    el('polyline', { points: points(l.path), class: 'wire-case' + hv }, svg);
    el('polyline', { points: points(l.path), class: 'wire' + hv, stroke: l.color }, svg);
    const [a, b] = [pos(l.path[0]), pos(l.path[1])];
    el('text', { x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, class: 'tag' }, svg, `W${i + 1}`);
  });

  // pins and the pads where connector wires land
  for (const [id, def] of Object.entries(netlist.parts)) {
    const names = pinOrder(def);
    const cx = names.reduce((s, pn) => s + pos(state.parts[id].pins[pn])[0], 0) / names.length;
    names.forEach((pn, i) => {
      const [x, y] = pos(state.parts[id].pins[pn]);
      const t = { class: 'pin-label', 'text-anchor': 'middle', x, y: y - 0.6 * U };
      let text = pn;
      if (def.kind === 'conn') {
        el('circle', { cx: x, cy: y, r: 0.26 * U, fill: def.wires[i] || '#999', class: 'land' + far(!bottom) }, svg);
        text = id.length < 3 ? `${id}.${pn}` : pn;
      } else {
        el('circle', { cx: x, cy: y, r: 0.3 * U, class: 'pin' }, svg);
        if (def.kind === 'esp') {
          // outside the socket outline: the pads between the pin rows are often in use
          const outward = x < cx ? -1 : 1;
          Object.assign(t, { x: x + outward * 0.56 * U, y, 'text-anchor': outward > 0 ? 'start' : 'end' });
        }
      }
      el('text', t, svg, text);
    });
  }
}

function table(parent, title, head, rows, note) {
  const box = html('div', parent);
  html('h2', box, title);
  if (note) html('p', box, note, 'note');
  const t = html('table', box);
  const tr = html('tr', html('thead', t));
  for (const h of head) html('th', tr, h);
  const body = html('tbody', t);
  for (const row of rows) {
    const r = html('tr', body);
    for (const cell of row) {
      const td = html('td', r);
      if (cell && cell.swatch) {
        html('span', td, undefined, 'swatch').style.background = cell.swatch;
        td.append(colorName(cell.swatch));
      } else if (cell === '[]') html('span', td, undefined, 'box');
      else if (cell && cell.heavy) { td.textContent = cell.heavy; td.className = 'heavy'; }
      else { td.textContent = cell ?? ''; if (typeof cell === 'string' && /^[A-X]\d\d|pad|rail/.test(cell)) td.className = 'mono'; }
    }
  }
}

// A solder path as its corner points: X03 > V03 > V08
function corners(path) {
  const out = [path[0]];
  for (let i = 1; i < path.length - 1; i++) {
    const [a, b, c] = [path[i - 1], path[i], path[i + 1]];
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1]) out.push(b);
  }
  out.push(path[path.length - 1]);
  return out.map(nodeName).join(' › ');
}

function drawLists() {
  const root = $('#lists');
  root.replaceChildren();
  html('h1', root, 'Wiring lists');
  const s = check.summary;
  html('p', root, `Check when printed: ${s.ok} of ${s.total} nets joined, ${s.shorts} shorts. Holes are named row letter + column number, as printed on the board.`, 'note');
  const cols = html('div', root, undefined, 'cols');

  for (const [id, def] of Object.entries(netlist.parts)) {
    if (def.kind !== 'conn') continue;
    table(cols, `${def.label} - connector wires`, ['', 'Pin', 'Colour', 'Solder to', 'Net'],
      pinOrder(def).map((pn, i) => ['[]', pn, { swatch: def.wires[i] }, nodeName(state.parts[id].pins[pn]), pinNet[`${id}.${pn}`] || '']));
  }

  const wires = state.links.filter((x) => x.type === 'wire');
  table(cols, 'Jumper wires - component side', ['', '#', 'From', 'To', 'Colour', 'Net', ''],
    wires.map((l, i) => ['[]', `W${i + 1}`, nodeName(l.path[0]), nodeName(l.path[l.path.length - 1]), { swatch: l.color },
      netAt(l.path[0]), heavy.has(l.id) ? { heavy: 'HEAVY' } : '']),
    'HEAVY = carries motor current: use thick wire (about 0.5 mm² / AWG 20).');

  const legs = [];
  for (const [id, def] of Object.entries(netlist.parts)) {
    if (def.kind === 'conn' || def.kind === 'esp') continue;
    for (const pn of pinOrder(def)) legs.push(['[]', def.label, pn, nodeName(state.parts[id].pins[pn]), pinNet[`${id}.${pn}`] || '']);
  }
  table(cols, 'Component legs', ['', 'Part', 'Pin', 'Hole', 'Net'], legs);

  const esp = Object.entries(netlist.parts).filter(([, d]) => d.kind === 'esp');
  for (const [id, def] of esp)
    table(cols, `${def.label} socket - pins in use`, ['Pin', 'Hole', 'Net'],
      pinOrder(def).filter((pn) => pinNet[`${id}.${pn}`]).map((pn) => [pn, nodeName(state.parts[id].pins[pn]), pinNet[`${id}.${pn}`]]),
      `Socket rows: ${pinOrder(def).length / 2} pins each. Unlisted pins are not connected.`);

  const solder = state.links.filter((x) => x.type === 'solder')
    .map((l) => ({ l, net: netAt(l.path[0]) })).sort((a, b) => a.net.localeCompare(b.net));
  table(cols, 'Solder runs - solder side', ['', 'Net', 'Path', ''],
    solder.map(({ l, net }) => ['[]', net, corners(l.path), heavy.has(l.id) ? { heavy: 'HEAVY' } : '']),
    'HEAVY = reinforce with bare copper wire under the solder.');

  table(cols, 'Continuity check after soldering', ['', 'Net', 'Pins that must beep together'],
    Object.entries(netlist.nets).map(([net, pins]) => ['[]', net, pins.map((p) => {
      const [id, pn] = [p.slice(0, p.indexOf('.')), p.slice(p.indexOf('.') + 1)];
      return `${p} ${nodeName(state.parts[id].pins[pn])}`;
    }).join(', ')]),
    'Also check that no two different nets beep together, VBAT and GND first.');
}

function render() {
  heavy = new Set(check.heavy || []);
  drawSide($('#bottom'), 'bottom');
  drawSide($('#top'), 'top');
  drawLists();
  const s = check.summary;
  $('#info').textContent = `${s.ok}/${s.total} nets joined · ${s.shorts} shorts · follows the planner live`;
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
  ws.onclose = () => { $('#info').textContent = 'offline - showing the last loaded plan'; setTimeout(connect, 1000); };
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.t !== 'state') return;
    ({ state, netlist, check } = m);
    pinNet = {};
    for (const [net, pins] of Object.entries(netlist.nets)) for (const p of pins) pinNet[p] = net;
    render();
  };
}

$('#print').onclick = () => window.print();
connect();
