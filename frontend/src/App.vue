<script setup lang="ts">
import { onMounted } from 'vue';
import FEACanvas from './components/FEACanvas.vue';
import ElementInfo from './components/ElementInfo.vue';
import MeshControls from './components/MeshControls.vue';
import SnapshotPanel from './components/SnapshotPanel.vue';
import { useFEAStore } from './store/fea';

const store = useFEAStore();

onMounted(() => {
  store.loadPreset('cantilever');
});
</script>

<template>
  <div class="min-h-screen bg-slate-950 text-slate-100 flex flex-col">
    <!-- Header -->
    <header class="bg-slate-900 border-b border-slate-800 px-6 py-3 flex items-center justify-between">
      <h1 class="text-lg font-bold text-purple-400">
        🔬 有限元应力热力图可视化
      </h1>
      <div class="text-xs text-slate-500">
        节点: {{ store.model.nodes.length }} |
        单元: {{ store.model.elements.length }}
      </div>
    </header>

    <!-- Main content -->
    <div class="flex flex-1 overflow-hidden">
      <!-- Canvas area -->
      <div class="flex-1 p-3 flex flex-col gap-2" style="width: 75%">
        <div
          v-if="store.comparisonOpen && store.canCompare"
          class="flex items-center justify-between rounded border border-purple-800 bg-purple-950/50 px-3 py-1.5 text-xs"
        >
          <span class="text-purple-300">
            快照对比中 ·
            <span class="text-amber-400 font-bold">A</span>
            与
            <span class="text-cyan-400 font-bold">B</span>
            使用同一套颜色刻度（{{ store.comparisonMode === 'overlay' ? '叠加' : '并排' }}）
          </span>
          <button
            @click="store.setComparisonOpen(false)"
            class="text-slate-400 hover:text-slate-200 underline underline-offset-2"
          >
            返回当前结果
          </button>
        </div>
        <FEACanvas />
      </div>

      <!-- Right sidebar -->
      <div class="w-[25%] min-w-[260px] bg-slate-900 border-l border-slate-800 p-3 flex flex-col gap-3 overflow-y-auto">
        <MeshControls />
        <SnapshotPanel />
        <ElementInfo />
      </div>
    </div>

    <!-- Bottom status bar -->
    <footer class="bg-slate-900 border-t border-slate-800 px-6 py-2 flex items-center gap-6 text-xs text-slate-400">
      <span>
        最大应力:
        <span class="text-red-400 font-bold">
          {{ store.result ? (store.maxStress / 1e6).toFixed(2) + ' MPa' : '—' }}
        </span>
      </span>
      <span>
        最大位移:
        <span class="text-amber-400 font-bold">
          {{ store.result ? (store.maxDisplacement * 1000).toFixed(3) + ' mm' : '—' }}
        </span>
      </span>
      <span>
        快照数: <span class="text-slate-200">{{ store.snapshots.length }}</span>
      </span>
      <span>
        节点数: <span class="text-slate-200">{{ store.model.nodes.length }}</span>
      </span>
      <span>
        单元数: <span class="text-slate-200">{{ store.model.elements.length }}</span>
      </span>
      <span class="ml-auto text-slate-600">
        热力图: {{ store.heatmapMode }}
      </span>
    </footer>
  </div>
</template>

