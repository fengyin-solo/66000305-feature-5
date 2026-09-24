import { jetColormap } from './fea-solver';
import type { FEAModel, FEAResult, HeatmapMode, Snapshot } from '../types';

// ─── 快照取值与统一色标 ─────────────────────────────────────────────────────

/** 按热力图模式取出每个单元的标量（取绝对值用于着色） */
export function heatValues(model: FEAModel, result: FEAResult, mode: HeatmapMode): number[] {
  switch (mode) {
    case 'stress':
      return result.stresses.map((v) => Math.abs(v));
    case 'strain':
      return result.strains.map((v) => Math.abs(v));
    case 'force':
      return model.elements.map((e) => Math.abs(e.force));
    default:
      return result.stresses.map((v) => Math.abs(v));
  }
}

/**
 * 计算统一色标的口径：取参与比对的所有快照、全部构件标量的共同最大值，
 * 两侧（叠加或并排）都按这同一口径映射颜色，互不各算各的。
 */
export function sharedHeatMax(snapshots: Snapshot[], mode: HeatmapMode): number {
  let max = 0;
  for (const snap of snapshots) {
    for (const v of heatValues(snap.model, snap.result, mode)) {
      if (v > max) max = v;
    }
  }
  return max;
}

/** 按统一色标上限为一份快照的每个单元生成颜色 */
export function colorsWithMax(model: FEAModel, result: FEAResult, mode: HeatmapMode, max: number): Map<number, string> {
  const values = heatValues(model, result, mode);
  const colors = new Map<number, string>();
  model.elements.forEach((el, i) => {
    colors.set(el.id, jetColormap(values[i] ?? 0, 0, max || 1));
  });
  return colors;
}

// ─── 图例口径 ───────────────────────────────────────────────────────────────

export const heatUnit = (mode: HeatmapMode): string =>
  mode === 'stress' ? 'MPa' : mode === 'strain' ? '%' : 'kN';

/** 把色标原始数值换算成显示单位（应力 Pa→MPa、应变换算为 %、轴力 N→kN） */
export function formatLegendValue(raw: number, mode: HeatmapMode): string {
  if (mode === 'stress') return (raw / 1e6).toExponential(1);
  if (mode === 'strain') return (raw * 100).toExponential(1);
  return (raw / 1000).toExponential(1);
}

// ─── 展示辅助 ───────────────────────────────────────────────────────────────

export function presetLabel(name: string): string {
  switch (name) {
    case 'cantilever':
      return '悬臂梁';
    case 'bridge':
      return '桥梁桁架';
    case 'frame':
      return '简单框架';
    default:
      return name || '自定义模型';
  }
}

export function formatTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

export function formatStress(v: number): string {
  return (v / 1e6).toFixed(2);
}

export function formatDisplacement(v: number): string {
  return (v * 1000).toFixed(3);
}
