import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { FEAModel, FEAResult, HeatmapMode, Snapshot, CompareMode } from '../types';
import {
  solve as feaSolve,
  presetCantileverBeam,
  presetBridgeTruss,
  presetSimpleFrame,
  jetColormap,
} from '../utils/fea-solver';

const STORAGE_KEY = 'fea-snapshots-v1';

interface PersistedState {
  snapshots: Snapshot[];
  nextSeq: number;
  compareAId: string | null;
  compareBId: string | null;
  compareMode: CompareMode;
  compareActive: boolean;
}

function isSnapshot(x: unknown): x is Snapshot {
  const s = x as Snapshot;
  return (
    !!s &&
    typeof s.id === 'string' &&
    typeof s.seq === 'number' &&
    typeof s.createdAt === 'number' &&
    !!s.model &&
    Array.isArray(s.model.nodes) &&
    Array.isArray(s.model.elements) &&
    !!s.result &&
    Array.isArray(s.result.stresses)
  );
}

function loadPersisted(): Partial<PersistedState> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    if (!Array.isArray(parsed.snapshots)) return {};
    parsed.snapshots = parsed.snapshots.filter(isSnapshot);
    return parsed;
  } catch {
    return {};
  }
}

export const useFEAStore = defineStore('fea', () => {
  const model = ref<FEAModel>({ nodes: [], elements: [], loads: [] });
  const result = ref<FEAResult | null>(null);
  const selectedPreset = ref<string>('cantilever');
  const showDeformed = ref(false);
  const deformationScale = ref(10);
  const selectedElement = ref<number | null>(null);
  const heatmapMode = ref<HeatmapMode>('stress');

  // ─── 结果快照 ─────────────────────────────────────────────────────────────
  const persisted = loadPersisted();
  const snapshots = ref<Snapshot[]>(persisted.snapshots ?? []);
  const nextSeq = ref<number>(
    persisted.nextSeq ??
      (snapshots.value.length > 0
        ? Math.max(...snapshots.value.map((s) => s.seq)) + 1
        : 1)
  );
  const compareAId = ref<string | null>(persisted.compareAId ?? null);
  const compareBId = ref<string | null>(persisted.compareBId ?? null);
  const compareMode = ref<CompareMode>(persisted.compareMode ?? 'overlay');
  const compareActive = ref<boolean>(persisted.compareActive ?? false);

  // 持久化：重新进入时恢复快照列表与最近一次比对选择
  watch(
    [snapshots, nextSeq, compareAId, compareBId, compareMode, compareActive],
    () => {
      const state: PersistedState = {
        snapshots: snapshots.value,
        nextSeq: nextSeq.value,
        compareAId: compareAId.value,
        compareBId: compareBId.value,
        compareMode: compareMode.value,
        compareActive: compareActive.value,
      };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
      } catch {
        // 存储不可用时静默降级
      }
    },
    { deep: true }
  );

  // ─── Actions ──────────────────────────────────────────────────────────────
  function loadPreset(name: string) {
    selectedPreset.value = name;
    result.value = null;
    selectedElement.value = null;
    switch (name) {
      case 'cantilever':
        model.value = presetCantileverBeam();
        break;
      case 'bridge':
        model.value = presetBridgeTruss();
        break;
      case 'frame':
        model.value = presetSimpleFrame();
        break;
      default:
        model.value = presetCantileverBeam();
    }
  }

  function solve() {
    result.value = feaSolve(model.value);

    // 每次开始分析都留存一份快照（当时的划分、颜色分布所需的结果、位移极值）
    const snap: Snapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      seq: nextSeq.value++,
      createdAt: Date.now(),
      presetName: selectedPreset.value,
      heatmapMode: heatmapMode.value,
      model: JSON.parse(JSON.stringify(model.value)) as FEAModel,
      result: JSON.parse(JSON.stringify(result.value)) as FEAResult,
    };
    snapshots.value.push(snap);
    snapshots.value.sort((a, b) => a.createdAt - b.createdAt);
  }

  function removeSnapshot(id: string) {
    snapshots.value = snapshots.value.filter((s) => s.id !== id);
    if (compareAId.value === id || compareBId.value === id) {
      if (compareAId.value === id) compareAId.value = null;
      if (compareBId.value === id) compareBId.value = null;
      compareActive.value = false;
    }
  }

  function clearSnapshots() {
    snapshots.value = [];
    compareAId.value = null;
    compareBId.value = null;
    compareActive.value = false;
  }

  /** 选择快照放入 A / B 槽；同一份快照在另一槽时自动对调 */
  function selectCompare(slot: 'A' | 'B', id: string) {
    if (slot === 'A') {
      if (compareBId.value === id) compareBId.value = compareAId.value;
      compareAId.value = id;
    } else {
      if (compareAId.value === id) compareAId.value = compareBId.value;
      compareBId.value = id;
    }
  }

  function setCompareMode(mode: CompareMode) {
    compareMode.value = mode;
  }

  function startCompare() {
    compareActive.value = true;
  }

  function exitCompare() {
    compareActive.value = false;
  }

  function toggleDeformed() {
    showDeformed.value = !showDeformed.value;
  }

  function selectElement(id: number | null) {
    selectedElement.value = id;
  }

  function setHeatmapMode(mode: HeatmapMode) {
    heatmapMode.value = mode;
  }

  function addLoad(nodeId: number, fx: number, fy: number) {
    model.value.loads.push({ nodeId, fx, fy });
  }

  function toggleFixed(nodeId: number) {
    const node = model.value.nodes.find((n) => n.id === nodeId);
    if (node) node.fixed = !node.fixed;
  }

  // ─── Computed ─────────────────────────────────────────────────────────────
  const maxStress = computed(() => result.value?.maxStress ?? 0);
  const maxDisplacement = computed(() => result.value?.maxDisplacement ?? 0);

  const elementColors = computed(() => {
    const colors = new Map<number, string>();
    if (!result.value || model.value.elements.length === 0) {
      for (const el of model.value.elements) {
        colors.set(el.id, '#6b7280');
      }
      return colors;
    }

    let values: number[];
    switch (heatmapMode.value) {
      case 'stress':
        values = result.value.stresses.map(Math.abs);
        break;
      case 'strain':
        values = result.value.strains.map(Math.abs);
        break;
      case 'force':
        values = model.value.elements.map((e) => Math.abs(e.force));
        break;
      default:
        values = result.value.stresses.map(Math.abs);
    }

    const min = Math.min(...values);
    const max = Math.max(...values);

    for (let i = 0; i < model.value.elements.length; i++) {
      colors.set(
        model.value.elements[i].id,
        jetColormap(values[i], min, max)
      );
    }
    return colors;
  });

  /** 按时间倒序排列（最新在最前），但保留原数组的时间正序便于管理 */
  const snapshotsByTime = computed(() =>
    [...snapshots.value].sort((a, b) => b.createdAt - a.createdAt)
  );

  const compareSnapshotA = computed(
    () => snapshots.value.find((s) => s.id === compareAId.value) ?? null
  );
  const compareSnapshotB = computed(
    () => snapshots.value.find((s) => s.id === compareBId.value) ?? null
  );

  /** 两份快照齐备且不是同一份时才构成有效比对 */
  const canCompare = computed(
    () =>
      !!compareSnapshotA.value &&
      !!compareSnapshotB.value &&
      compareSnapshotA.value.id !== compareSnapshotB.value.id
  );

  return {
    model,
    result,
    selectedPreset,
    showDeformed,
    deformationScale,
    selectedElement,
    heatmapMode,
    snapshots,
    snapshotsByTime,
    compareAId,
    compareBId,
    compareMode,
    compareActive,
    compareSnapshotA,
    compareSnapshotB,
    canCompare,
    maxStress,
    maxDisplacement,
    elementColors,
    loadPreset,
    solve,
    removeSnapshot,
    clearSnapshots,
    selectCompare,
    setCompareMode,
    startCompare,
    exitCompare,
    toggleDeformed,
    selectElement,
    setHeatmapMode,
    addLoad,
    toggleFixed,
  };
});
