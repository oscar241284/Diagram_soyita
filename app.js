// PDF → Diagrama de flujo animado
// Flujo: 1) extraer texto del PDF  2) obtener pasos (JSON, manual o con IA)  3) dibujar con layout y animación

const CONFIG = window.APP_CONFIG || {};
const $ = (id) => document.getElementById(id);

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    "https://cdn.jsdelivr.net/npm/pdfjs-dist@3.11.174/build/pdf.worker.min.js";
}

const logos = {}; // nombre (minúsculas, sin extensión) -> data URL
let paused = false;

// ---------- Utilidades ----------
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function setStatus(msg, isError = false) {
  const el = $("status");
  el.textContent = msg;
  el.className = "status" + (isError ? " error" : " ok");
}

// ---------- 1. Extraer texto del PDF ----------
async function extractPdfText(file) {
  if (!window.pdfjsLib) throw new Error("No se pudo cargar PDF.js (revisa la conexión).");
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  let out = "";
  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const lines = content.items.map((it) => it.str + (it.hasEOL ? "\n" : " "));
    out += lines.join("").trim() + "\n\n";
  }
  return out.trim();
}

$("pdfInput").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus("Leyendo PDF…");
  try {
    const text = await extractPdfText(file);
    $("pdfText").value = text;
    setStatus(text ? `Texto extraído (${text.length} caracteres).` : "El PDF no tiene texto seleccionable (¿es escaneado?).", !text);
    $("btnAnalyze").disabled = !CONFIG.analyzeUrl || !text;
  } catch (err) {
    setStatus("Error al leer el PDF: " + err.message, true);
  }
});

// ---------- 2. Obtener pasos ----------
// Opcional: un servicio propio que recibe {text} y devuelve el JSON de pasos (ver README).
$("btnAnalyze").addEventListener("click", async () => {
  setStatus("Analizando el procedimiento con IA…");
  try {
    const res = await fetch(CONFIG.analyzeUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: $("pdfText").value }),
    });
    const json = await res.json();
    if (!res.ok) throw new Error(json.error || "HTTP " + res.status);
    $("jsonInput").value = JSON.stringify(json, null, 2);
    setStatus("Pasos generados. Revísalos y pulsa \"Dibujar diagrama\".");
  } catch (err) {
    setStatus("No se pudo analizar: " + err.message, true);
  }
});

$("btnSample").addEventListener("click", () => {
  $("jsonInput").value = JSON.stringify(SAMPLE, null, 2);
  setStatus("Ejemplo cargado.");
});

// ---------- 3. Layout ----------
const TASK = { w: 170, h: 56 };
const DECISION = { w: 130, h: 80 };
const TERMINAL = { w: 120, h: 44 };
const LANE_MIN_H = 130;
const LANE_LABEL_W = 150;
const COL_W = 210;
const TOP = 70;
const LEFT = 20;

function normalizeNext(step) {
  const list = Array.isArray(step.next) ? step.next : step.next ? [step.next] : [];
  return list.map((n) => (typeof n === "string" ? { to: n, label: "" } : { to: n.to, label: n.label || "" }));
}

function layout(model) {
  const steps = model.steps || [];
  const byId = Object.fromEntries(steps.map((s) => [s.id, s]));
  const actors = model.actors && model.actors.length
    ? model.actors
    : [...new Set(steps.map((s) => s.actor || "General"))].map((a) => ({ id: a, name: a }));
  const laneIndex = Object.fromEntries(actors.map((a, i) => [a.id, i]));

  // Niveles: distancia más larga desde el inicio (acotado para evitar ciclos)
  const level = {};
  const starts = steps.filter((s) => s.type === "start");
  (starts.length ? starts : [steps[0]]).forEach((s) => { if (s) level[s.id] = 0; });
  for (let i = 0; i < steps.length; i++) {
    for (const s of steps) {
      if (level[s.id] === undefined) continue;
      for (const n of normalizeNext(s)) {
        if (!byId[n.to]) continue;
        const cand = level[s.id] + 1;
        if (level[n.to] === undefined || cand > level[n.to]) {
          if (cand <= steps.length) level[n.to] = cand;
        }
      }
    }
  }
  steps.forEach((s) => { if (level[s.id] === undefined) level[s.id] = 0; });

  // Posiciones: columna = nivel, carril = actor, apilado si coinciden
  const cellCount = {};
  const pos = {};
  for (const s of steps) {
    const lane = laneIndex[s.actor || actors[0]?.id] ?? 0;
    const key = level[s.id] + "-" + lane;
    const slot = cellCount[key] || 0;
    cellCount[key] = slot + 1;
    pos[s.id] = { col: level[s.id], lane, slot };
  }
  const maxSlots = Array(actors.length).fill(1);
  for (const id in pos) maxSlots[pos[id].lane] = Math.max(maxSlots[pos[id].lane], pos[id].slot + 1);
  const laneY = [];
  let y = TOP;
  actors.forEach((_, i) => {
    laneY[i] = y;
    y += Math.max(LANE_MIN_H, maxSlots[i] * 74 + 30);
  });
  const height = y + 20;
  const maxCol = Math.max(0, ...Object.values(pos).map((p) => p.col));
  const width = LEFT + LANE_LABEL_W + (maxCol + 1) * COL_W + 40;

  const nodes = steps.map((s) => {
    const p = pos[s.id];
    const dim = s.type === "decision" ? DECISION : s.type === "start" || s.type === "end" ? TERMINAL : TASK;
    const cx = LEFT + LANE_LABEL_W + p.col * COL_W + COL_W / 2;
    const cy = laneY[p.lane] + Math.max(LANE_MIN_H, maxSlots[p.lane] * 74 + 30) / 2 + (p.slot - (maxSlots[p.lane] - 1) / 2) * 74;
    return { ...s, cx, cy, ...dim };
  });

  return { actors, laneY, laneHeights: actors.map((_, i) => Math.max(LANE_MIN_H, maxSlots[i] * 74 + 30)), nodes, width, height, byId: Object.fromEntries(nodes.map((n) => [n.id, n])) };
}

// ---------- 4. Dibujo ----------
function nodeSvg(n, logoFor) {
  const x = n.cx - n.w / 2, y = n.cy - n.h / 2;
  const text = `<text class="node-text" x="${n.cx}" y="${n.cy + 4}">${esc(n.label)}</text>`;
  if (n.type === "decision") {
    const pts = `${n.cx},${y} ${x + n.w},${n.cy} ${n.cx},${y + n.h} ${x},${n.cy}`;
    return `<g class="node-decision"><polygon points="${pts}"/>${text}</g>`;
  }
  const cls = n.type === "start" ? "node-start" : n.type === "end" ? "node-end" : "node-task";
  return `<g class="${cls}"><rect x="${x}" y="${y}" width="${n.w}" height="${n.h}"/>${text}</g>`;
}

function edgePath(a, b) {
  const x1 = a.cx + a.w / 2, y1 = a.cy;
  const x2 = b.cx - b.w / 2, y2 = b.cy;
  const dx = Math.max(30, (x2 - x1) / 2);
  return `M${x1} ${y1} C${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}

function draw(model) {
  const L = layout(model);
  const parts = [];

  // Carriles
  L.actors.forEach((a, i) => {
    const h = L.laneHeights[i];
    parts.push(`<rect class="lane-bg" x="${LEFT}" y="${L.laneY[i]}" width="${L.width - LEFT - 20}" height="${h}" rx="8"/>`);
    const logo = logos[(a.name || a.id).toLowerCase()] || logos[a.id.toLowerCase()];
    const ly = L.laneY[i] + h / 2;
    if (logo) parts.push(`<image href="${logo}" x="${LEFT + 8}" y="${ly - 16}" width="32" height="32" preserveAspectRatio="xMidYMid meet"/>`);
    parts.push(`<text class="lane-label" x="${LEFT + (logo ? 48 : 10)}" y="${ly + 4}">${esc(a.name || a.id)}</text>`);
  });

  // Conexiones con etiqueta y punto animado
  const edges = [];
  const dots = [];
  let idx = 0;
  for (const s of L.nodes) {
    for (const n of normalizeNext(s)) {
      const t = L.byId[n.to];
      if (!t) continue;
      const d = edgePath(s, t);
      edges.push(`<path class="edge" d="${d}"/>`);
      if (n.label) {
        const mx = (s.cx + s.w / 2 + t.cx - t.w / 2) / 2;
        const my = (s.cy + t.cy) / 2 - 6;
        edges.push(`<text class="edge-label" x="${mx}" y="${my}" text-anchor="middle">${esc(n.label)}</text>`);
      }
      const begin = (idx * 0.2).toFixed(2);
      dots.push(`<circle class="dot" r="5"><animateMotion dur="2.6s" begin="${begin}s" repeatCount="indefinite" path="${d}"/></circle>`);
      idx++;
    }
  }

  const nodeMarkup = L.nodes.map((n) => nodeSvg(n)).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${L.width}" height="${L.height}" viewBox="0 0 ${L.width} ${L.height}" font-family="system-ui, sans-serif">
${parts.join("\n")}
${edges.join("\n")}
${dots.join("\n")}
${nodeMarkup}
</svg>`;

  $("diagTitle").textContent = model.title || "Diagrama";
  $("diagram").innerHTML = svg;
  $("diagram").dataset.ready = "1";
  paused = false;
  $("btnPause").textContent = "Pausar";
}

$("btnDraw").addEventListener("click", () => {
  let model;
  try {
    model = JSON.parse($("jsonInput").value);
    if (!Array.isArray(model.steps) || !model.steps.length) throw new Error("El JSON debe tener una lista 'steps'.");
  } catch (err) {
    setStatus("JSON inválido: " + err.message, true);
    return;
  }
  draw(model);
  setStatus(`Diagrama con ${model.steps.length} pasos.`);
});

$("btnPause").addEventListener("click", () => {
  const svg = $("diagram").querySelector("svg");
  if (!svg) return;
  paused = !paused;
  paused ? svg.pauseAnimations() : svg.unpauseAnimations();
  $("diagram").classList.toggle("paused", paused);
  $("btnPause").textContent = paused ? "Reanudar" : "Pausar";
});

$("btnSvg").addEventListener("click", () => {
  const svg = $("diagram").querySelector("svg");
  if (!svg) return setStatus("Primero dibuja un diagrama.", true);
  const blob = new Blob([new XMLSerializer().serializeToString(svg)], { type: "image/svg+xml" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = ($("diagTitle").textContent || "diagrama") + ".svg";
  a.click();
});

// ---------- Logos ----------
$("logoInput").addEventListener("change", async (e) => {
  for (const f of e.target.files) {
    const key = f.name.replace(/\.[^.]+$/, "").toLowerCase();
    logos[key] = await new Promise((res) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.readAsDataURL(f);
    });
  }
  setStatus(`Logos cargados: ${Object.keys(logos).join(", ")}. Vuelve a dibujar para verlos.`);
});

// ---------- Ejemplo ----------
const SAMPLE = {
  title: "Ejemplo: pedido a despacho",
  actors: [
    { id: "ventas", name: "Ventas" },
    { id: "almacen", name: "Almacén" },
    { id: "sap", name: "SAP" },
  ],
  steps: [
    { id: "s1", type: "start", label: "Inicio", actor: "ventas", next: ["s2"] },
    { id: "s2", type: "task", label: "Registrar pedido", actor: "ventas", next: ["s3"] },
    { id: "s3", type: "task", label: "Crear orden en SAP", actor: "sap", next: ["s4"] },
    { id: "s4", type: "decision", label: "¿Hay stock?", actor: "almacen", next: [{ to: "s5", label: "Sí" }, { to: "s6", label: "No" }] },
    { id: "s5", type: "task", label: "Preparar despacho", actor: "almacen", next: ["s7"] },
    { id: "s6", type: "task", label: "Solicitar reposición", actor: "sap", next: ["s3"] },
    { id: "s7", type: "end", label: "Fin", actor: "almacen" },
  ],
};
