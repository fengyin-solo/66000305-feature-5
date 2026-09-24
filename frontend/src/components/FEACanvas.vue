<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useFEAStore, metricValues } from '../store/fea';
import type { Snapshot } from '../types';

const store = useFEAStore();
const canvas = ref<HTMLCanvasElement>();

let scale = 1;
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

interface Transform {
  drawScale: number;
  drawOffsetX: number;
  drawOffsetY: number;
}

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

interface DrawOptions {
  colorFor?: (elementId: number) => string;
  deformed?: boolean;                 // draw the dashed displaced mesh
  deformTint?: string;
  deformDash?: number[];
  elementOpacity?: number;
  elementDash?: number[];
  selectable?: boolean;               // honor store.selectedElement
  drawNodes?: boolean;
  drawLoads?: boolean;
}

function boundsOf(nodes: { x: number; y: number }[]): Bounds {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  return { minX, maxX, minY, maxY };
}

function fitTransform(b: Bounds, x: number, y: number, w: number, h: number): Transform {
  const margin = 40;
  const worldW = b.maxX - b.minX || 1;
  const worldH = b.maxY - b.minY || 1;
  const fit = Math.min(
    Math.max(1, w - margin * 2) / worldW,
    Math.max(1, h - margin * 2) / worldH
  );
  const drawScale = fit * scale;
  return {
    drawScale,
    drawOffsetX: x + margin - b.minX * drawScale + (w - margin * 2 - worldW * drawScale) / 2,
    drawOffsetY: y + margin - b.minY * drawScale + (h - margin * 2 - worldH * drawScale) / 2,
  };
}

function toScreen(t: Transform, x: number, y: number): [number, number] {
  return [x * t.drawScale + t.drawOffsetX, y * t.drawScale + t.drawOffsetY];
}

// ─── Scene pieces ───────────────────────────────────────────────────────────

function drawElements(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  t: Transform,
  opts: DrawOptions
) {
  const { nodes, elements } = snap.model;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  if (opts.elementOpacity !== undefined) ctx.globalAlpha = opts.elementOpacity;
  if (opts.elementDash) ctx.setLineDash(opts.elementDash);

  for (const el of elements) {
    const n1 = nodeById.get(el.nodeIds[0]);
    const n2 = nodeById.get(el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const [x1, y1] = toScreen(t, n1.x, n1.y);
    const [x2, y2] = toScreen(t, n2.x, n2.y);
    const isSelected = opts.selectable && store.selectedElement === el.id;

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = opts.colorFor ? opts.colorFor(el.id) : '#6b7280';
    ctx.lineWidth = isSelected ? 4 : 2.5;
    ctx.stroke();

    if (isSelected) {
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.setLineDash(opts.elementDash ?? []);
    }
  }

  ctx.setLineDash([]);
  ctx.globalAlpha = 1;
}

function drawDeformed(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  t: Transform,
  opts: DrawOptions
) {
  const { nodes, elements } = snap.model;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));
  const s = store.deformationScale;

  ctx.setLineDash(opts.deformDash ?? [5, 3]);
  for (const el of elements) {
    const n1 = nodeById.get(el.nodeIds[0]);
    const n2 = nodeById.get(el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const [x1, y1] = toScreen(t, n1.x + n1.displacementX * s, n1.y + n1.displacementY * s);
    const [x2, y2] = toScreen(t, n2.x + n2.displacementX * s, n2.y + n2.displacementY * s);

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = opts.deformTint ?? 'rgba(251,191,36,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.setLineDash([]);
}

function drawNodes(ctx: CanvasRenderingContext2D, snap: Snapshot, t: Transform, tint?: string) {
  for (const node of snap.model.nodes) {
    const [x, y] = toScreen(t, node.x, node.y);

    if (node.fixed) {
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x - 6, y + 4);
      ctx.lineTo(x + 6, y + 4);
      ctx.closePath();
      ctx.fillStyle = '#f97316';
      ctx.fill();
      ctx.strokeStyle = '#ea580c';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 1;
      for (let i = -8; i <= 8; i += 4) {
        ctx.beginPath();
        ctx.moveTo(x + i, y + 5);
        ctx.lineTo(x + i - 3, y + 10);
        ctx.stroke();
      }
    } else {
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fillStyle = tint ?? '#e2e8f0';
      ctx.fill();
      ctx.strokeStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }
}

function drawLoads(ctx: CanvasRenderingContext2D, snap: Snapshot, t: Transform) {
  const nodeById = new Map(snap.model.nodes.map((n) => [n.id, n]));
  for (const load of snap.model.loads) {
    const node = nodeById.get(load.nodeId);
    if (!node) continue;
    const [x, y] = toScreen(t, node.x, node.y);

    const mag = Math.sqrt(load.fx ** 2 + load.fy ** 2);
    if (mag === 0) continue;

    const arrowLen = 30;
    const dx = (load.fx / mag) * arrowLen;
    const dy = (load.fy / mag) * arrowLen;

    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const headLen = 8;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle - 0.4), y - headLen * Math.sin(angle - 0.4));
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle + 0.4), y - headLen * Math.sin(angle + 0.4));
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#fca5a5';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(mag / 1000).toFixed(1)}kN`, x - dx / 2, y - dy / 2 - 6);
  }
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  snap: Snapshot,
  t: Transform,
  opts: DrawOptions
) {
  drawElements(ctx, snap, t, opts);
  if (opts.deformed) drawDeformed(ctx, snap, t, opts);
  if (opts.drawNodes !== false) drawNodes(ctx, snap, t);
  if (opts.drawLoads !== false) drawLoads(ctx, snap, t);
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  maxVal: number,
  minVal: number,
  subtitle: string
) {
  const legendX = W - 36;
  const legendY = 30;
  const legendH = H - 60;
  const legendW = 14;

  const gradient = ctx.createLinearGradient(0, legendY, 0, legendY + legendH);
  gradient.addColorStop(0, 'rgb(255,0,0)');
  gradient.addColorStop(0.25, 'rgb(255,255,0)');
  gradient.addColorStop(0.5, 'rgb(0,255,0)');
  gradient.addColorStop(0.75, 'rgb(0,255,255)');
  gradient.addColorStop(1, 'rgb(0,0,128)');

  ctx.fillStyle = gradient;
  ctx.fillRect(legendX, legendY, legendW, legendH);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, legendW, legendH);

  const unit = store.heatmapMode === 'stress' ? 'MPa' :
    store.heatmapMode === 'strain' ? '%' : 'kN';

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${maxVal.toExponential(1)} ${unit}`, legendX - 4, legendY + 8);
  ctx.fillText(`${minVal.toExponential(1)} ${unit}`, legendX - 4, legendY + legendH);

  ctx.save();
  ctx.translate(legendX + legendW + 11, legendY + legendH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '11px sans-serif';
  ctx.fillText(store.heatmapMode.toUpperCase(), 0, 0);
  ctx.restore();

  if (subtitle) {
    ctx.save();
    ctx.fillStyle = '#94a3b8';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillText(subtitle, legendX - 4, legendY - 12);
    ctx.restore();
  }
}

function drawRegionHeader(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tag: string,
  tagColor: string,
  snap: Snapshot
) {
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = tagColor;
  ctx.fillText(tag, x + 8, y + 16);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    `位移 ${(snap.result.maxDisplacement * 1000).toFixed(3)}mm · ` +
      `应力 ${(snap.result.maxStress / 1e6).toFixed(2)}MPa`,
    x + 30,
    y + 16
  );
}

// ─── Views ──────────────────────────────────────────────────────────────────

function drawEmptyModel(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('选择一个预设模型开始分析', W / 2, H / 2);
}

function drawLive(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const { nodes, elements } = store.model;
  if (nodes.length === 0) {
    drawEmptyModel(ctx, W, H);
    return;
  }

  // Same auto-fit behaviour as before
  const b = boundsOf(nodes);
  const t = fitTransform(b, 0, 0, W, H);

  const fakeSnap: Snapshot = {
    id: 'live',
    createdAt: 0,
    preset: store.selectedPreset,
    heatmapMode: store.heatmapMode,
    model: store.model,
    result: store.result!,
  };

  drawScene(ctx, fakeSnap, t, {
    colorFor: (id) => store.elementColors.get(id) || '#6b7280',
    deformed: store.showDeformed && !!store.result,
    selectable: true,
  });

  let maxVal = 0;
  let minVal = 0;
  if (store.result) {
    const values = metricValues(store.result, store.model, store.heatmapMode);
    maxVal = Math.max(...values);
    minVal = Math.min(...values);
  }
  drawLegend(ctx, W, H, maxVal, minVal, '');
}

function drawCompareEmpty(ctx: CanvasRenderingContext2D, W: number, H: number) {
  ctx.fillStyle = '#94a3b8';
  ctx.font = '14px sans-serif';
  ctx.textAlign = 'center';
  if (store.snapshots.length === 0) {
    ctx.fillText('还没有结果快照', W / 2, H / 2 - 22);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('运行一次「求解 FEA」，快照会自动保存', W / 2, H / 2 + 4);
  } else if (store.snapshots.length === 1) {
    ctx.fillText('只有一份快照，暂时无法比对', W / 2, H / 2 - 22);
    ctx.font = '12px sans-serif';
    ctx.fillStyle = '#64748b';
    ctx.fillText('调整参数后再次求解，即可得到两份结果', W / 2, H / 2 + 4);
  } else {
    ctx.fillText('请在右侧快照列表中为 A、B 各选一份快照', W / 2, H / 2 - 10);
  }
}

function drawSideBySide(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const A = store.snapA;
  const B = store.snapB;
  if (!A || !B || !store.canCompare) {
    drawCompareEmpty(ctx, W, H);
    return;
  }

  const legendW = 52;
  const panelW = (W - legendW) / 2;

  // Common fit scale derived from both meshes so geometry sizes line up;
  // each panel keeps its own centering offsets.
  const bA = boundsOf(A.model.nodes);
  const bB = boundsOf(B.model.nodes);
  const union: Bounds = {
    minX: Math.min(bA.minX, bB.minX),
    maxX: Math.max(bA.maxX, bB.maxX),
    minY: Math.min(bA.minY, bB.minY),
    maxY: Math.max(bA.maxY, bB.maxY),
  };
  const shared = fitTransform(union, 0, 0, panelW, H);
  const reOffset = (b: Bounds, px: number): Transform => {
    const margin = 40;
    const worldW = b.maxX - b.minX || 1;
    const worldH = b.maxY - b.minY || 1;
    return {
      drawScale: shared.drawScale,
      drawOffsetX: px + margin - b.minX * shared.drawScale +
        (panelW - margin * 2 - worldW * shared.drawScale) / 2,
      drawOffsetY: margin - b.minY * shared.drawScale +
        (H - margin * 2 - worldH * shared.drawScale) / 2,
    };
  };
  const ttA = reOffset(bA, 0);
  const ttB = reOffset(bB, panelW);

  const colorFor = (snap: Snapshot) => (id: number) => store.colorForSnapshot(snap, id);
  const deformed = store.showDeformed;

  // Clip each panel so models stay inside their own region
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, panelW, H);
  ctx.clip();
  drawScene(ctx, A, ttA, {
    colorFor: colorFor(A),
    deformed,
    deformTint: 'rgba(251,191,36,0.7)',
  });
  ctx.restore();

  ctx.save();
  ctx.beginPath();
  ctx.rect(panelW, 0, panelW, H);
  ctx.clip();
  drawScene(ctx, B, ttB, {
    colorFor: colorFor(B),
    deformed,
    deformTint: 'rgba(34,211,238,0.7)',
  });
  ctx.restore();

  // Divider
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(panelW, 10);
  ctx.lineTo(panelW, H - 10);
  ctx.stroke();
  ctx.setLineDash([]);

  drawRegionHeader(ctx, 0, 0, 'A', '#fbbf24', A);
  drawRegionHeader(ctx, panelW, 0, 'B', '#22d3ee', B);

  // One shared legend for both panels
  const { min, max } = store.compareColorRange;
  drawLegend(ctx, W, H, max, min, 'A / B 共用刻度');
}

function drawOverlay(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const A = store.snapA;
  const B = store.snapB;
  if (!A || !B || !store.canCompare) {
    drawCompareEmpty(ctx, W, H);
    return;
  }

  const legendW = 52;
  const areaW = W - legendW;
  const bA = boundsOf(A.model.nodes);
  const bB = boundsOf(B.model.nodes);
  const union: Bounds = {
    minX: Math.min(bA.minX, bB.minX),
    maxX: Math.max(bA.maxX, bB.maxX),
    minY: Math.min(bA.minY, bB.minY),
    maxY: Math.max(bA.maxY, bB.maxY),
  };
  const t = fitTransform(union, 0, 0, areaW, H);
  const deformed = store.showDeformed;

  // A: solid colored elements; B: dashed colored elements so both partitions show
  drawScene(ctx, A, t, {
    colorFor: (id) => store.colorForSnapshot(A, id),
    deformed,
    deformTint: 'rgba(251,191,36,0.85)',
    elementOpacity: 0.9,
    drawLoads: false,
  });
  drawScene(ctx, B, t, {
    colorFor: (id) => store.colorForSnapshot(B, id),
    deformed,
    deformTint: 'rgba(34,211,238,0.85)',
    deformDash: [5, 3],
    elementOpacity: 0.55,
    elementDash: [7, 4],
    drawNodes: false,
    drawLoads: false,
  });
  // B nodes on top (cyan, open circles)
  drawNodes(ctx, B, t, '#67e8f9');
  // Loads from A only (reference), drawn last so arrows stay visible
  drawLoads(ctx, A, t);

  // Overlay key
  ctx.textAlign = 'left';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = '#fbbf24';
  ctx.fillText('A', 10, 18);
  ctx.fillStyle = '#22d3ee';
  ctx.fillText('B', 30, 18);
  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    `A 位移 ${(A.result.maxDisplacement * 1000).toFixed(3)}mm  ·  ` +
      `B 位移 ${(B.result.maxDisplacement * 1000).toFixed(3)}mm`,
    48,
    18
  );

  const { min, max } = store.compareColorRange;
  drawLegend(ctx, W, H, max, min, 'A / B 共用刻度');
}

// ─── Main render ────────────────────────────────────────────────────────────
function draw() {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx) return;

  const W = canvas.value!.width;
  const H = canvas.value!.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  if (store.comparisonOpen) {
    if (store.comparisonMode === 'overlay') drawOverlay(ctx, W, H);
    else drawSideBySide(ctx, W, H);
  } else {
    drawLive(ctx, W, H);
  }
}

// ─── Interaction ────────────────────────────────────────────────────────────

function handleMouseDown(e: MouseEvent) {
  isDragging = true;
  lastMouse = { x: e.clientX, y: e.clientY };
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging) return;
  lastMouse = { x: e.clientX, y: e.clientY };
  draw();
}

function handleMouseUp() {
  isDragging = false;
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  const factor = e.deltaY > 0 ? 0.9 : 1.1;
  scale = Math.max(0.1, Math.min(10, scale * factor));
  draw();
}

function handleClick(e: MouseEvent) {
  // Element picking only applies to the live (current result) view.
  if (store.comparisonOpen || !store.result || store.model.nodes.length === 0) return;

  const rect = canvas.value!.getBoundingClientRect();
  const mx = (e.clientX - rect.left) * (canvas.value!.width / rect.width);
  const my = (e.clientY - rect.top) * (canvas.value!.height / rect.height);

  const { nodes, elements } = store.model;
  const b = boundsOf(nodes);
  const W = canvas.value!.width;
  const H = canvas.value!.height;
  const t = fitTransform(b, 0, 0, W, H);

  let bestDist = 15;
  let bestId: number | null = null;
  const nodeById = new Map(nodes.map((n) => [n.id, n]));

  for (const el of elements) {
    const n1 = nodeById.get(el.nodeIds[0]);
    const n2 = nodeById.get(el.nodeIds[1]);
    if (!n1 || !n2) continue;

    const [x1, y1] = toScreen(t, n1.x, n1.y);
    const [x2, y2] = toScreen(t, n2.x, n2.y);

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let tt = ((mx - x1) * dx + (my - y1) * dy) / len2;
    tt = Math.max(0, Math.min(1, tt));
    const px = x1 + tt * dx;
    const py = y1 + tt * dy;
    const dist = Math.sqrt((mx - px) ** 2 + (my - py) ** 2);

    if (dist < bestDist) {
      bestDist = dist;
      bestId = el.id;
    }
  }

  store.selectElement(bestId);
  draw();
}

onMounted(() => {
  nextTick(draw);
});

watch(
  () => [
    store.model,
    store.result,
    store.showDeformed,
    store.deformationScale,
    store.selectedElement,
    store.heatmapMode,
    store.elementColors,
    store.comparisonOpen,
    store.comparisonMode,
    store.snapshots,
    store.compareA,
    store.compareB,
  ],
  () => nextTick(draw),
  { deep: true }
);
</script>

<template>
  <canvas
    ref="canvas"
    width="800"
    height="500"
    class="w-full rounded-lg border border-slate-700"
    :class="store.comparisonOpen ? 'cursor-default' : 'cursor-crosshair'"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @wheel="handleWheel"
    @click="handleClick"
  />
</template>
