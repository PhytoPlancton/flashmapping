import { store, CATEGORIES } from '../store.js';

export default {
  name: 'FilterBar',
  setup() {
    function toggle(cat) { store.toggleCategory(cat); }
    function reset() { store.resetFilters(); }
    function catColor(cat) { return `var(--c-${cat})`; }
    function isOff(cat) {
      return store.activeCategories.size > 0 && !store.activeCategories.has(cat);
    }
    return { store, CATEGORIES, toggle, reset, catColor, isOff };
  },
  template: `
    <div class="sticky top-0 z-[2] bg-white border-b border-ink-200 px-7 py-3 flex items-center gap-4 flex-wrap">
      <div class="flex items-center gap-2">
        <span class="text-[10.5px] uppercase tracking-wider text-ink-400 font-semibold mr-1">Catégories</span>
        <button v-for="c in CATEGORIES" :key="c.key"
                class="filter-chip"
                :class="{ off: isOff(c.key) }"
                @click="toggle(c.key)">
          <span class="dot" :style="{ background: catColor(c.key) }"></span>
          {{ c.label }}
        </button>
        <button v-if="store.activeCategories.size > 0"
                class="text-[11px] text-ink-500 hover:text-ink-900 ml-1"
                @click="reset">
          Réinitialiser
        </button>
      </div>

      <div class="flex items-center gap-2 ml-auto">
        <button class="toggle-btn"
                :class="{ active: store.techtomedOnly }"
                @click="store.techtomedOnly = !store.techtomedOnly">
          ★ TechToMed
        </button>
        <button class="toggle-btn"
                :class="{ active: store.icpOnly }"
                @click="store.icpOnly = !store.icpOnly">
          ICP only
        </button>
      </div>
    </div>
  `
};
