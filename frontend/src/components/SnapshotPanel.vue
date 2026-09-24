<script setup lang="ts">
import { useFEAStore } from '../store/fea';
import type { Snapshot } from '../types';

const store = useFEAStore();

const PRESET_LABELS: Record<string, string> = {
  cantilever: '悬臂梁',
  bridge: '桥梁桁架',
  frame: '简单框架',
};

function presetLabel(snap: Snapshot): string {
  return PRESET_LABELS[snap.preset] ?? snap.preset;
}

function timeLabel(ts: number): string {
  return new Date(ts).toLocaleTimeString('zh-CN', { hour12: false });
}

function assignSlot(slot: 'A' | 'B', id: string) {
  store.selectCompareSlot(slot, id);
}
</script>

<template>
  <div class="bg-slate-800 rounded-lg p-4 space-y-3">
    <div class="flex items-center justify-between border-b border-slate-700 pb-2">
      <h3 class="text-sm font-bold text-slate-200">结果快照</h3>
      <span class="text-[10px] text-slate-500">{{ store.snapshots.length }} 份</span>
    </div>

    <!-- Empty state -->
    <div
      v-if="store.snapshots.length === 0"
      class="text-xs text-slate-500 text-center py-5 px-2 border border-dashed border-slate-700 rounded"
    >
      还没有快照。<br />
      点击上方「求解 FEA」开始一次分析后，<br />
      划分、颜色分布与位移极值会自动存为一份快照。
    </div>

    <template v-else>
      <!-- Snapshot list, newest first -->
      <div class="space-y-1.5 max-h-64 overflow-y-auto pr-0.5">
        <div
          v-for="snap in store.snapshotsDesc"
          :key="snap.id"
          class="rounded border p-2 transition"
          :class="
            snap.id === store.compareA || snap.id === store.compareB
              ? 'border-sky-600 bg-slate-700/60'
              : 'border-slate-700 bg-slate-900/60'
          "
        >
          <div class="flex items-center justify-between gap-1">
            <div class="min-w-0">
              <div class="text-xs font-medium text-slate-200 truncate">
                {{ presetLabel(snap) }}
              </div>
              <div class="text-[10px] text-slate-500 font-mono">
                {{ timeLabel(snap.createdAt) }}
              </div>
            </div>
            <div class="flex gap-1 shrink-0">
              <button
                @click="assignSlot('A', snap.id)"
                class="w-6 h-6 rounded text-[11px] font-bold transition"
                :class="
                  store.compareA === snap.id
                    ? 'bg-amber-500 text-slate-900'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                "
                title="作为比对 A"
              >
                A
              </button>
              <button
                @click="assignSlot('B', snap.id)"
                class="w-6 h-6 rounded text-[11px] font-bold transition"
                :class="
                  store.compareB === snap.id
                    ? 'bg-cyan-500 text-slate-900'
                    : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
                "
                title="作为比对 B"
              >
                B
              </button>
            </div>
          </div>
          <div class="flex gap-3 mt-1 text-[10px] text-slate-400 font-mono">
            <span>位移 {{ (snap.result.maxDisplacement * 1000).toFixed(2) }}mm</span>
            <span>应力 {{ (snap.result.maxStress / 1e6).toFixed(1) }}MPa</span>
          </div>
        </div>
      </div>

      <!-- Can't compare yet -->
      <div
        v-if="!store.canCompare"
        class="text-[11px] text-slate-500 text-center py-3 px-2 border border-dashed border-slate-700 rounded leading-5"
      >
        <template v-if="store.snapshots.length < 2">
          仅有 1 份快照，无法比对。<br />再运行一次分析（可调整参数后求解）即可。
        </template>
        <template v-else>
          请为 A、B 两个槽位各选一份不同的快照。
        </template>
      </div>

      <!-- Comparison controls -->
      <div v-else class="space-y-2 border-t border-slate-700 pt-2">
        <div class="grid grid-cols-2 gap-1">
          <button
            @click="store.setComparisonMode('sideBySide')"
            class="py-1.5 rounded text-[10px] font-medium transition"
            :class="
              store.comparisonMode === 'sideBySide'
                ? 'bg-purple-700 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            "
          >
            ⬌ 并排
          </button>
          <button
            @click="store.setComparisonMode('overlay')"
            class="py-1.5 rounded text-[10px] font-medium transition"
            :class="
              store.comparisonMode === 'overlay'
                ? 'bg-purple-700 text-white'
                : 'bg-slate-700 text-slate-400 hover:bg-slate-600'
            "
          >
            ▦ 叠加
          </button>
        </div>
        <button
          v-if="!store.comparisonOpen"
          @click="store.setComparisonOpen(true)"
          class="w-full py-2 rounded text-xs font-bold bg-sky-700 text-white hover:bg-sky-600 transition"
        >
          查看 A / B 对比
        </button>
        <button
          v-else
          @click="store.setComparisonOpen(false)"
          class="w-full py-2 rounded text-xs font-bold bg-slate-700 text-slate-200 hover:bg-slate-600 transition"
        >
          退出对比，回到当前结果
        </button>
      </div>
    </template>
  </div>
</template>
