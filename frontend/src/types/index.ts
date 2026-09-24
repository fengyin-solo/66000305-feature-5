export interface Node {
  id: number;
  x: number;
  y: number;
  fixed: boolean;       // boundary condition
  displacementX: number;
  displacementY: number;
}

export interface Element {
  id: number;
  nodeIds: [number, number];  // 2-node truss element
  area: number;               // cross-section area (m²)
  youngsModulus: number;      // Pa
  stress: number;             // computed
  strain: number;             // computed
  force: number;              // computed
}

export interface Load {
  nodeId: number;
  fx: number;   // force X component (N)
  fy: number;   // force Y component (N)
}

export interface FEAModel {
  nodes: Node[];
  elements: Element[];
  loads: Load[];
}

export interface FEAResult {
  displacements: number[];    // global displacement vector
  stresses: number[];          // per-element stress
  strains: number[];           // per-element strain
  maxDisplacement: number;
  maxStress: number;
  reactionForces: { nodeId: number; fx: number; fy: number }[];
}

export type HeatmapMode = 'stress' | 'strain' | 'force';

export type CompareMode = 'overlay' | 'sideBySide';

/**
 * 一次分析开始时留存的结果快照：
 * 完整保存当时的划分（节点/单元）、载荷与求解结果，颜色分布可据此按任意热力图模式重现。
 */
export interface Snapshot {
  id: string;
  seq: number;                 // 自增序号，便于辨认
  createdAt: number;           // 时间戳
  presetName: string;
  heatmapMode: HeatmapMode;    // 生成快照时选用的热力图模式
  model: FEAModel;
  result: FEAResult;
}
