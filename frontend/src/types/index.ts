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

// Immutable record captured every time an analysis is run
export interface Snapshot {
  id: string;
  createdAt: number;                  // epoch ms
  preset: string;                     // preset key used at solve time
  heatmapMode: HeatmapMode;           // color distribution captured with the result
  model: FEAModel;                    // frozen mesh (partitioning + loads)
  result: FEAResult;                  // frozen per-element values & displacement extrema
}
