import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import type { FEAModel, FEAResult, Snapshot, HeatmapMode } from '../types';
import {
  solve as feaSolve,
  presetCantileverBeam,
  presetBridgeTruss,
  presetSimpleFrame,
  jetColormap,
} from '../utils/fea-solver';

const STORAGE_KEY = 'fea-snapshots-v1';

export function metricValues(
  result: FEAResult,
  model: FEAModel,
  mode: HeatmapMode
): number[] {
  switch (mode) {
    case 'stress':
      return result.stresses.map(Math.abs);
    case 'strain':
      return result.strains.map(Math.abs);
    case 'force':
      return model.elements.map((e) => Math.abs(e.force));
  }
}

interface PersistedState {
  snapshots: Snapshot[];
  compareA: string | null;
  compareB: string | null;
  comparisonMode: 'sideBySide' | 'overlay';
  comparisonOpen: boolean;
}

function loadPersisted(): PersistedState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedState;
    if (!Array.isArray(parsed.snapshots)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export const useFEAStore = defineStore('fea', () => {
  const persisted = loadPersisted();

  const model = ref<FEAModel>({ nodes: [], elements: [], loads: [] });
  const result = ref<FEAResult | null>(null);
  const selectedPreset = ref<string>('cantilever');
  const showDeformed = ref(false);
  const deformationScale = ref(10);
  const selectedElement = ref<number | null>(null);
  const heatmapMode = ref<HeatmapMode>('stress');

  // ─── Snapshots (newest last) ──────────────────────────────────────────────
  const snapshots = ref<Snapshot[]>(persisted?.snapshots ?? []);
  const compareA = ref<string | null>(persisted?.compareA ?? null);
  const compareB = ref<string | null>(persisted?.compareB ?? null);
  const comparisonOpen = ref<boolean>(persisted?.comparisonOpen ?? false);
  const comparisonMode = ref<'sideBySide' | 'overlay'>(
    persisted?.comparisonMode === 'overlay' ? 'overlay' : 'sideBySide'
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
    const feResult = feaSolve(model.value);
    result.value = feResult;

    // Snapshot the partitioning, color distribution and displacement extrema
    // at the moment this analysis was started.
    const snap: Snapshot = {
      id: `snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: Date.now(),
      preset: selectedPreset.value,
      heatmapMode: heatmapMode.value,
      model: JSON.parse(JSON.stringify(model.value)) as FEAModel,
      result: JSON.parse(JSON.stringify(feResult)) as FEAResult,
    };
    snapshots.value.push(snap);

    // Default the comparison pair to the two newest results.
    if (snapshots.value.length === 1) {
      compareA.value = snap.id;
    } else {
      compareA.value = snapshots.value[snapshots.value.length - 2].id;
      compareB.value = snap.id;
    }
  }

  function selectCompareSlot(slot: 'A' | 'B', id: string | null) {
    if (slot === 'A') compareA.value = id;
    else compareB.value = id;
  }

  function setComparisonMode(mode: 'sideBySide' | 'overlay') {
    comparisonMode.value = mode;
  }

  function setComparisonOpen(open: boolean) {
    comparisonOpen.value = open;
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

    const values = metricValues(result.value, model.value, heatmapMode.value);
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

  // Snapshots ordered newest-first for listing.
  const snapshotsDesc = computed(() => [...snapshots.value].reverse());

  const snapshotById = (id: string | null): Snapshot | null =>
    (id && snapshots.value.find((s) => s.id === id)) || null;

  const snapA = computed(() => snapshotById(compareA.value));
  const snapB = computed(() => snapshotById(compareB.value));

  // A real comparison needs two distinct snapshots.
  const canCompare = computed(
    () =>
      !!snapA.value &&
      !!snapB.value &&
      snapA.value.id !== snapB.value.id &&
      snapshots.value.length >= 2
  );

  // Single shared color scale across both compared snapshots: one common
  // [min, max] range so element colors mean the same thing on both sides.
  const compareColorRange = computed(() => {
    if (!snapA.value || !snapB.value) return { min: 0, max: 0 };
    const mode = heatmapMode.value;
    const va = metricValues(snapA.value.result, snapA.value.model, mode);
    const vb = metricValues(snapB.value.result, snapB.value.model, mode);
    const min = Math.min(...va, ...vb);
    const max = Math.max(...va, ...vb);
    return { min, max };
  });

  function colorForSnapshot(snap: Snapshot, elementId: number): string {
    const idx = snap.model.elements.findIndex((e) => e.id === elementId);
    if (idx < 0) return '#6b7280';
    const values = metricValues(snap.result, snap.model, heatmapMode.value);
    return jetColormap(values[idx], compareColorRange.value.min, compareColorRange.value.max);
  }

  // Persist snapshots and the last comparison selection.
  if (typeof window !== 'undefined') {
    watch(
      [snapshots, compareA, compareB, comparisonMode, comparisonOpen],
      () => {
        try {
          localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify({
              snapshots: snapshots.value,
              compareA: compareA.value,
              compareB: compareB.value,
              comparisonMode: comparisonMode.value,
              comparisonOpen: comparisonOpen.value,
            } satisfies PersistedState)
          );
        } catch {
          // storage full / unavailable — snapshots still work for this session
        }
      },
      { deep: true }
    );
  }

  return {
    model,
    result,
    selectedPreset,
    showDeformed,
    deformationScale,
    selectedElement,
    heatmapMode,
    maxStress,
    maxDisplacement,
    elementColors,
    // snapshots
    snapshots,
    snapshotsDesc,
    compareA,
    compareB,
    comparisonOpen,
    comparisonMode,
    snapA,
    snapB,
    canCompare,
    compareColorRange,
    colorForSnapshot,
    selectCompareSlot,
    setComparisonMode,
    setComparisonOpen,
    loadPreset,
    solve,
    toggleDeformed,
    selectElement,
    setHeatmapMode,
    addLoad,
    toggleFixed,
  };
});
