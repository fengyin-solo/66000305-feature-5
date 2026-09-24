<script setup lang="ts">
import { ref, onMounted, watch, nextTick } from 'vue';
import { useFEAStore } from '../store/fea';
import type { FEAModel, Node, Snapshot, HeatmapMode } from '../types';
import {
  sharedHeatMax,
  colorsWithMax,
  heatUnit,
  formatLegendValue,
  presetLabel,
  formatTime,
  formatStress,
  formatDisplacement,
} from '../utils/snapshot';

const store = useFEAStore();
const canvas = ref<HTMLCanvasElement>();

// 平移 / 缩放（两种视图共用）
let panX = 0;
let panY = 0;
let zoom = 1;
let isDragging = false;
let lastMouse = { x: 0, y: 0 };

interface Rect { x: number; y: number; w: number; h: number }
interface Transform { scale: number; ox: number; oy: number }
type SceneVariant = 'live' | 'A' | 'B';

interface SceneOptions {
  colors: Map<number, string>;
  variant: SceneVariant;
  showDeformed: boolean;
  deformationScale: number;
  selectedId: number | null;
}

const ACCENT = {
  live: '#38bdf8',
  A: '#38bdf8',
  B: '#ec4899',
} as const;

// ─── 视图变换 ───────────────────────────────────────────────────────────────

function modelBounds(nodes: Node[]) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x);
    maxX = Math.max(maxX, n.x);
    minY = Math.min(minY, n.y);
    maxY = Math.max(maxY, n.y);
  }
  return { minX, maxX, minY, maxY };
}

function fitTransform(nodes: Node[], area: Rect, margin: number): Transform {
  const { minX, maxX, minY, maxY } = modelBounds(nodes);
  const worldW = maxX - minX || 1;
  const worldH = maxY - minY || 1;
  const fit = Math.min((area.w - margin * 2) / worldW, (area.h - margin * 2) / worldH);
  const scale = fit * zoom;
  return {
    scale,
    ox: area.x - minX * scale + (area.w - worldW * scale) / 2 + panX,
    oy: area.y - minY * scale + (area.h - worldH * scale) / 2 + panY,
  };
}

function unionBounds(snaps: Snapshot[]) {
  const nodes: Node[] = snaps.flatMap((s) => s.model.nodes);
  return modelBounds(nodes);
}

function fitTransformBounds(
  b: { minX: number; maxX: number; minY: number; maxY: number },
  area: Rect,
  margin: number
): Transform {
  const worldW = b.maxX - b.minX || 1;
  const worldH = b.maxY - b.minY || 1;
  const fit = Math.min((area.w - margin * 2) / worldW, (area.h - margin * 2) / worldH);
  const scale = fit * zoom;
  return {
    scale,
    ox: area.x - b.minX * scale + (area.w - worldW * scale) / 2 + panX,
    oy: area.y - b.minY * scale + (area.h - worldH * scale) / 2 + panY,
  };
}

// ─── 场景绘制 ───────────────────────────────────────────────────────────────

const nodeMap = (model: FEAModel) => {
  const m = new Map<number, Node>();
  for (const n of model.nodes) m.set(n.id, n);
  return m;
};

function drawScene(
  ctx: CanvasRenderingContext2D,
  model: FEAModel,
  tr: Transform,
  opts: SceneOptions
) {
  const { nodes, elements, loads } = model;
  const nmap = nodeMap(model);
  const toScreen = (n: Node): [number, number] => [
    n.x * tr.scale + tr.ox,
    n.y * tr.scale + tr.oy,
  ];
  const isOverlayB = opts.variant === 'B';
  const accent = ACCENT[opts.variant];

  // 构件（按颜色分布上色）
  for (const el of elements) {
    const n1 = nmap.get(el.nodeIds[0]);
    const n2 = nmap.get(el.nodeIds[1]);
    if (!n1 || !n2) continue;
    const [x1, y1] = toScreen(n1);
    const [x2, y2] = toScreen(n2);
    const color = opts.colors.get(el.id) || '#6b7280';
    const selected = opts.variant === 'live' && opts.selectedId === el.id;

    if (isOverlayB) {
      // 叠加模式下 B 用半透明描边衬底，避免与 A 混淆
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = 'rgba(236,72,153,0.55)';
      ctx.lineWidth = 6;
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth = selected ? 4 : 2.5;
    ctx.setLineDash(isOverlayB ? [6, 4] : []);
    ctx.stroke();
    ctx.setLineDash([]);

    if (selected) {
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // 变形网格叠加（各快照用各自的位移）
  if (opts.showDeformed) {
    ctx.setLineDash([5, 3]);
    for (const el of elements) {
      const n1 = nmap.get(el.nodeIds[0]);
      const n2 = nmap.get(el.nodeIds[1]);
      if (!n1 || !n2) continue;
      const s = opts.deformationScale;
      const d1: Node = { ...n1, x: n1.x + n1.displacementX * s, y: n1.y + n1.displacementY * s };
      const d2: Node = { ...n2, x: n2.x + n2.displacementX * s, y: n2.y + n2.displacementY * s };
      const [x1, y1] = toScreen(d1);
      const [x2, y2] = toScreen(d2);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = isOverlayB ? 'rgba(244,114,182,0.85)' : 'rgba(251,191,36,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // 节点与约束
  for (const node of nodes) {
    const [x, y] = toScreen(node);
    if (node.fixed) {
      ctx.beginPath();
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x - 6, y + 4);
      ctx.lineTo(x + 6, y + 4);
      ctx.closePath();
      ctx.fillStyle = isOverlayB ? '#f9a8d4' : '#f97316';
      ctx.fill();
      ctx.strokeStyle = isOverlayB ? '#db2777' : '#ea580c';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      ctx.strokeStyle = isOverlayB ? '#f9a8d4' : '#f97316';
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
      ctx.fillStyle = isOverlayB ? '#fbcfe8' : '#e2e8f0';
      ctx.fill();
      ctx.strokeStyle = isOverlayB ? '#db2777' : '#64748b';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
  }

  // 载荷箭头
  for (const load of loads) {
    const node = nmap.get(load.nodeId);
    if (!node) continue;
    const [x, y] = toScreen(node);
    const mag = Math.sqrt(load.fx ** 2 + load.fy ** 2);
    if (mag === 0) continue;

    const arrowLen = 30;
    const dx = (load.fx / mag) * arrowLen;
    const dy = (load.fy / mag) * arrowLen;

    ctx.beginPath();
    ctx.moveTo(x - dx, y - dy);
    ctx.lineTo(x, y);
    ctx.strokeStyle = isOverlayB ? '#f472b6' : '#ef4444';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    const headLen = 8;
    const angle = Math.atan2(dy, dx);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle - 0.4), y - headLen * Math.sin(angle - 0.4));
    ctx.moveTo(x, y);
    ctx.lineTo(x - headLen * Math.cos(angle + 0.4), y - headLen * Math.sin(angle + 0.4));
    ctx.strokeStyle = isOverlayB ? '#f472b6' : '#ef4444';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = isOverlayB ? '#fbcfe8' : '#fca5a5';
    ctx.font = '10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(`${(mag / 1000).toFixed(1)}kN`, x - dx / 2, y - dy / 2 - 6);
  }

  // 提示 accent 未被直接读取（颜色已内联），保留供扩展
  void accent;
}

// ─── 标签卡 / 空态 / 图例 ───────────────────────────────────────────────────

function drawChip(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tag: 'A' | 'B',
  snap: Snapshot
) {
  const w = 210;
  const h = 56;
  const accent = tag === 'A' ? ACCENT.A : ACCENT.B;

  ctx.fillStyle = 'rgba(15,23,42,0.85)';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 6);
  ctx.fill();
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.font = 'bold 12px sans-serif';
  ctx.fillStyle = accent;
  ctx.fillText(tag, x + 9, y + 19);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillText(`${presetLabel(snap.presetName)} #${snap.seq}`, x + 22, y + 19);

  ctx.font = '10px sans-serif';
  ctx.fillStyle = '#94a3b8';
  ctx.fillText(
    `σ ${formatStress(snap.result.maxStress)} MPa · d ${formatDisplacement(snap.result.maxDisplacement)} mm`,
    x + 9,
    y + 36
  );
  ctx.fillStyle = '#64748b';
  ctx.fillText(formatTime(snap.createdAt), x + 9, y + 50);
}

function drawEmptyState(ctx: CanvasRenderingContext2D, area: Rect, lines: string[]) {
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'center';
  ctx.font = '14px sans-serif';
  const lineH = 22;
  const startY = area.y + area.h / 2 - ((lines.length - 1) * lineH) / 2;
  lines.forEach((line, i) => {
    ctx.fillText(line, area.x + area.w / 2, startY + i * lineH);
  });
}

function jetGradient(ctx: CanvasRenderingContext2D, x0: number, y0: number, y1: number) {
  const gradient = ctx.createLinearGradient(0, y0, 0, y1);
  gradient.addColorStop(0, 'rgb(255,0,0)');
  gradient.addColorStop(0.25, 'rgb(255,255,0)');
  gradient.addColorStop(0.5, 'rgb(0,255,0)');
  gradient.addColorStop(0.75, 'rgb(0,255,255)');
  gradient.addColorStop(1, 'rgb(0,0,128)');
  return gradient;
}

/** 比对图例：刻度口径与两侧构件颜色完全一致 */
function drawSharedLegend(
  ctx: CanvasRenderingContext2D,
  W: number,
  H: number,
  mode: HeatmapMode,
  maxVal: number
) {
  const legendX = W - 40;
  const legendY = 30;
  const legendH = H - 60;
  const legendW = 15;

  ctx.fillStyle = jetGradient(ctx, 0, legendY, legendY + legendH);
  ctx.fillRect(legendX, legendY, legendW, legendH);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, legendW, legendH);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${formatLegendValue(maxVal, mode)} ${heatUnit(mode)}`, legendX - 4, legendY + 8);
  ctx.fillText('0', legendX - 4, legendY + legendH);

  ctx.save();
  ctx.translate(legendX + legendW + 12, legendY + legendH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#a78bfa';
  ctx.font = '11px sans-serif';
  ctx.fillText(`统一色标 · ${mode.toUpperCase()}`, 0, 0);
  ctx.restore();
}

// ─── 视图分发 ───────────────────────────────────────────────────────────────

function draw() {
  const ctx = canvas.value?.getContext('2d');
  if (!ctx || !canvas.value) return;
  const W = canvas.value.width;
  const H = canvas.value.height;

  ctx.clearRect(0, 0, W, H);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W, H);

  if (store.compareActive) {
    drawCompare(ctx, W, H);
  } else {
    drawLive(ctx, W, H);
  }
}

function drawLive(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const { nodes, elements, loads } = store.model;
  if (nodes.length === 0) {
    drawEmptyState(ctx, { x: 0, y: 0, w: W, h: H }, ['选择一个预设模型开始分析']);
    return;
  }

  const area: Rect = { x: 0, y: 0, w: W, h: H };
  const tr = fitTransform(nodes, area, 60);
  drawScene(ctx, store.model, tr, {
    colors: store.elementColors,
    variant: 'live',
    showDeformed: store.showDeformed,
    deformationScale: store.deformationScale,
    selectedId: store.selectedElement,
  });

  // 图例（保持实时分析视图原样）
  const legendX = W - 40;
  const legendY = 30;
  const legendH = H - 60;
  const legendW = 15;
  ctx.fillStyle = jetGradient(ctx, 0, legendY, legendY + legendH);
  ctx.fillRect(legendX, legendY, legendW, legendH);
  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 1;
  ctx.strokeRect(legendX, legendY, legendW, legendH);

  let maxVal = 0;
  if (store.result) {
    switch (store.heatmapMode) {
      case 'stress':
        maxVal = Math.max(...store.result.stresses.map(Math.abs));
        break;
      case 'strain':
        maxVal = Math.max(...store.result.strains.map(Math.abs));
        break;
      case 'force':
        maxVal = Math.max(...elements.map((e) => Math.abs(e.force)));
        break;
    }
  }
  const unit = heatUnit(store.heatmapMode);
  ctx.fillStyle = '#94a3b8';
  ctx.font = '10px sans-serif';
  ctx.textAlign = 'right';
  ctx.fillText(`${maxVal.toExponential(1)} ${unit}`, legendX - 4, legendY + 8);
  ctx.fillText('0', legendX - 4, legendY + legendH);

  ctx.save();
  ctx.translate(legendX + legendW + 10, legendY + legendH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.fillStyle = '#64748b';
  ctx.font = '11px sans-serif';
  ctx.fillText(store.heatmapMode.toUpperCase(), 0, 0);
  ctx.restore();

  void loads;
}

function compareEmptyLines(): string[] {
  if (store.snapshots.length === 0) {
    return ['还没有结果快照', '点击「求解 FEA」生成第一份快照，即可选择两份进行比对'];
  }
  if (store.snapshots.length === 1) {
    return ['当前只有 1 份快照', '再求解一次（可调整参数），即可把两份快照叠加或并排比对'];
  }
  return ['请在右侧分别选择两份不同的快照（A 与 B）', '选择后即可叠加或并排比对'];
}

function drawCompare(ctx: CanvasRenderingContext2D, W: number, H: number) {
  const snapA = store.compareSnapshotA;
  const snapB = store.compareSnapshotB;

  if (!store.canCompare || !snapA || !snapB) {
    drawEmptyState(ctx, { x: 0, y: 0, w: W, h: H }, compareEmptyLines());
    return;
  }

  const mode = store.heatmapMode;
  // 两侧共用同一刻度口径
  const sharedMax = sharedHeatMax([snapA, snapB], mode);
  const colorsA = colorsWithMax(snapA.model, snapA.result, mode, sharedMax);
  const colorsB = colorsWithMax(snapB.model, snapB.result, mode, sharedMax);

  if (store.compareMode === 'overlay') {
    const area: Rect = { x: 0, y: 0, w: W - 52, h: H };
    ctx.save();
    ctx.beginPath();
    ctx.rect(area.x, area.y, area.w, area.h);
    ctx.clip();
    const tr = fitTransformBounds(unionBounds([snapA, snapB]), area, 50);
    drawScene(ctx, snapA.model, tr, {
      colors: colorsA,
      variant: 'A',
      showDeformed: store.showDeformed,
      deformationScale: store.deformationScale,
      selectedId: null,
    });
    drawScene(ctx, snapB.model, tr, {
      colors: colorsB,
      variant: 'B',
      showDeformed: store.showDeformed,
      deformationScale: store.deformationScale,
      selectedId: null,
    });
    ctx.restore();

    drawChip(ctx, 10, 10, 'A', snapA);
    drawChip(ctx, 10, 10 + 56 + 8, 'B', snapB);
  } else {
    const legendW = 52;
    const paneW = (W - legendW) / 2;
    const panes: { rect: Rect; snap: Snapshot; colors: Map<number, string>; tag: 'A' | 'B' }[] = [
      { rect: { x: 0, y: 0, w: paneW, h: H }, snap: snapA, colors: colorsA, tag: 'A' },
      { rect: { x: paneW, y: 0, w: paneW, h: H }, snap: snapB, colors: colorsB, tag: 'B' },
    ];

    for (const pane of panes) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(pane.rect.x, pane.rect.y, pane.rect.w, pane.rect.h);
      ctx.clip();
      const tr = fitTransform(pane.snap.model.nodes, pane.rect, 46);
      drawScene(ctx, pane.snap.model, tr, {
        colors: pane.colors,
        variant: pane.tag,
        showDeformed: store.showDeformed,
        deformationScale: store.deformationScale,
        selectedId: null,
      });
      ctx.restore();

      ctx.strokeStyle = '#1e293b';
      ctx.lineWidth = 1;
      ctx.strokeRect(pane.rect.x + 1, pane.rect.y + 1, pane.rect.w - 2, pane.rect.h - 2);
      drawChip(ctx, pane.rect.x + 10, 10, pane.tag, pane.snap);
    }
  }

  drawSharedLegend(ctx, W, H, mode, sharedMax);
}

// ─── 交互 ───────────────────────────────────────────────────────────────────

function liveTransform(): Transform | null {
  const nodes = store.model.nodes;
  if (!canvas.value || nodes.length === 0) return null;
  return fitTransform(nodes, { x: 0, y: 0, w: canvas.value.width, h: canvas.value.height }, 60);
}

function handleMouseDown(e: MouseEvent) {
  isDragging = true;
  lastMouse = { x: e.clientX, y: e.clientY };
}

function handleMouseMove(e: MouseEvent) {
  if (!isDragging) return;
  panX += e.clientX - lastMouse.x;
  panY += e.clientY - lastMouse.y;
  lastMouse = { x: e.clientX, y: e.clientY };
  draw();
}

function handleMouseUp() {
  isDragging = false;
}

function handleWheel(e: WheelEvent) {
  e.preventDefault();
  zoom *= e.deltaY > 0 ? 0.9 : 1.1;
  zoom = Math.max(0.1, Math.min(10, zoom));
  draw();
}

function handleClick(e: MouseEvent) {
  if (store.compareActive) return; // 比对视图中不选单元
  const tr = liveTransform();
  if (!tr || !canvas.value) return;

  const rect = canvas.value.getBoundingClientRect();
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;
  const { nodes, elements } = store.model;
  const nmap = nodeMap(store.model);

  let bestDist = 15;
  let bestId: number | null = null;
  for (const el of elements) {
    const n1 = nmap.get(el.nodeIds[0]);
    const n2 = nmap.get(el.nodeIds[1]);
    if (!n1 || !n2) continue;
    const x1 = n1.x * tr.scale + tr.ox;
    const y1 = n1.y * tr.scale + tr.oy;
    const x2 = n2.x * tr.scale + tr.ox;
    const y2 = n2.y * tr.scale + tr.oy;

    const dx = x2 - x1;
    const dy = y2 - y1;
    const len2 = dx * dx + dy * dy;
    if (len2 === 0) continue;
    let t = ((mx - x1) * dx + (my - y1) * dy) / len2;
    t = Math.max(0, Math.min(1, t));
    const dist = Math.sqrt((mx - (x1 + t * dx)) ** 2 + (my - (y1 + t * dy)) ** 2);
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
    store.compareActive,
    store.compareMode,
    store.compareAId,
    store.compareBId,
    store.snapshots,
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
    :class="store.compareActive ? 'cursor-grab' : 'cursor-crosshair'"
    @mousedown="handleMouseDown"
    @mousemove="handleMouseMove"
    @mouseup="handleMouseUp"
    @mouseleave="handleMouseUp"
    @wheel="handleWheel"
    @click="handleClick"
  />
</template>
