// AccountToolbar.js — Zone C: sticky toolbar.
// Row 1: view toggle + right-side toggles (TechToMed/ICP/Reset).
// Row 2: category chips (horizontal scroll, no label).
// Row 3: country chips (horizontal scroll, no label). Only if any country detected.

import { computed, ref, watch, nextTick } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, CATEGORIES } from '../store.js';
import { extractCountry } from '../utils.js';
import { icons } from '../icons.js';

function readStoredViewMode(companyId) {
  if (!companyId) return 'levels';
  try {
    const v = localStorage.getItem('viewMode_' + companyId);
    return v === 'freeform' ? 'freeform' : 'levels';
  } catch (e) { return 'levels'; }
}
function writeStoredViewMode(companyId, mode) {
  if (!companyId) return;
  try { localStorage.setItem('viewMode_' + companyId, mode); } catch (e) {}
}

export default {
  name: 'AccountToolbar',
  props: {
    company: { type: Object, required: true }
  },
  emits: ['view-change'],
  setup(props, { emit }) {
    const companyId = computed(() => props.company?._id || props.company?.slug || '');
    const viewMode = ref(readStoredViewMode(companyId.value));

    watch(companyId, (id) => {
      const next = readStoredViewMode(id);
      viewMode.value = next;
      emit('view-change', next);
    }, { immediate: true });

    function setViewMode(mode) {
      if (mode !== 'levels' && mode !== 'freeform') return;
      if (viewMode.value === mode) return;
      viewMode.value = mode;
      writeStoredViewMode(companyId.value, mode);
      emit('view-change', mode);
    }

    /* ===== Category filters ===== */
    function toggleCategory(cat) { store.toggleCategory(cat); }
    function resetFilters() { store.resetFilters(); }
    function catColor(cat) { return `var(--c-${cat})`; }
    function isOff(cat) {
      return store.activeCategories.size > 0 && !store.activeCategories.has(cat);
    }
    function isCategoryActive(cat) {
      return store.activeCategories.has(cat);
    }

    /* Count of contacts per category for the current company. */
    const categoryCounts = computed(() => {
      const counts = Object.create(null);
      const list = props.company?.contacts || [];
      for (const c of list) {
        const key = c.category || 'other';
        counts[key] = (counts[key] || 0) + 1;
      }
      return counts;
    });
    function catCount(key) { return categoryCounts.value[key] || 0; }

    /* ===== Country filters ===== */
    const availableCountries = computed(() => {
      const byCode = new Map();
      const list = props.company?.contacts || [];
      for (const c of list) {
        const hit = extractCountry(c.location);
        if (!hit) continue;
        const existing = byCode.get(hit.code);
        if (existing) existing.count++;
        else byCode.set(hit.code, { ...hit, count: 1 });
      }
      return [...byCode.values()].sort((a, b) =>
        b.count - a.count || a.name.localeCompare(b.name)
      );
    });
    function toggleCountry(code) { store.toggleCountry(code); }
    function isCountryActive(code) { return store.activeCountries.has(code); }
    function isCountryOff(code) {
      return store.activeCountries.size > 0 && !store.activeCountries.has(code);
    }
    const hasActiveFilters = computed(
      () => store.activeCategories.size > 0 || store.activeCountries.size > 0
    );

    /* ===== ICP editor — opens the right-side drawer ===== */
    function openICPEditor(ev) {
      ev.stopPropagation();
      store.openICPDrawer();
    }

    // ICP match counts for the badge on the toolbar toggle.
    const icpTotalCount = computed(() => {
      const list = props.company?.contacts || [];
      return list.reduce((n, c) => n + ((c.icp_match_ids || []).length > 0 ? 1 : 0), 0);
    });
    const icpAccountCount = computed(() => {
      // How many contacts match AT LEAST one account-scoped ICP (excluding
      // contacts that only match team ICPs). Subtle badge next to the pill.
      const compIds = new Set(((props.company?.icps) || []).map(i => i.id));
      if (!compIds.size) return 0;
      const list = props.company?.contacts || [];
      let n = 0;
      for (const c of list) {
        const ids = c.icp_match_ids || [];
        if (ids.some(id => compIds.has(id))) n++;
      }
      return n;
    });

    return {
      store, CATEGORIES, icons,
      viewMode, setViewMode,
      toggleCategory, resetFilters, catColor, isOff, isCategoryActive,
      catCount,
      availableCountries, toggleCountry, isCountryActive, isCountryOff,
      hasActiveFilters,
      openICPEditor,
      icpTotalCount, icpAccountCount,
    };
  },
  template: `
    <div class="account-toolbar">
      <!-- Row 1: Niveaux/Freeform toggle + right-side filter toggles -->
      <div class="flex items-center gap-2">
        <div class="segment-toggle shrink-0" role="tablist" aria-label="Mode d'affichage">
          <button type="button" role="tab"
                  class="segment-toggle-btn"
                  :class="{ active: viewMode === 'levels' }"
                  :aria-selected="viewMode === 'levels'"
                  @click="setViewMode('levels')">
            <span class="segment-toggle-icon" v-html="icons.rows"></span>
            <span>Niveaux</span>
          </button>
          <button type="button" role="tab"
                  class="segment-toggle-btn"
                  :class="{ active: viewMode === 'freeform' }"
                  :aria-selected="viewMode === 'freeform'"
                  @click="setViewMode('freeform')">
            <span class="segment-toggle-icon" v-html="icons.scatter"></span>
            <span>Freeform</span>
          </button>
        </div>

        <div class="ml-auto flex items-center gap-2 shrink-0">
          <button v-if="hasActiveFilters"
                  class="text-[11px] text-ink-500 hover:text-ink-900"
                  @click="resetFilters">
            Réinitialiser
          </button>
          <button class="toggle-btn inline-flex items-center gap-1.5"
                  :class="{ active: store.techtomedOnly }"
                  @click="store.techtomedOnly = !store.techtomedOnly"
                  title="Afficher uniquement les contacts TechToMed">
            <span v-html="icons.star"></span>
            <span>TechToMed</span>
          </button>
          <div class="icp-btn-wrap">
            <button class="toggle-btn icp-btn"
                    :class="{ active: store.icpOnly }"
                    @click="store.icpOnly = !store.icpOnly"
                    title="Afficher uniquement les contacts ICP">
              <span>ICP</span>
              <span v-if="icpTotalCount > 0" class="icp-btn-count">{{ icpTotalCount }}</span>
              <span class="icp-edit-chip"
                    role="button"
                    tabindex="0"
                    title="Configurer les ICPs de l’équipe"
                    @click.stop="openICPEditor"
                    @keydown.enter.stop.prevent="openICPEditor">
                <span v-html="icons.pencil"></span>
              </span>
            </button>
            <span v-if="icpAccountCount > 0"
                  class="icp-account-badge"
                  :title="icpAccountCount + ' match' + (icpAccountCount > 1 ? 's' : '') + ' via ICP spécifique à ce compte'">
              +{{ icpAccountCount }}
            </span>
          </div>
        </div>
      </div>

      <!-- Row 2: Categories (no label, horizontal scroll) -->
      <div class="chip-row mt-2.5">
        <button v-for="c in CATEGORIES" :key="c.key"
                class="filter-chip"
                :class="{ off: isOff(c.key), active: isCategoryActive(c.key) }"
                @click="toggleCategory(c.key)">
          <span class="dot" :style="{ background: catColor(c.key) }"></span>
          <span class="filter-chip-label">{{ c.label }}</span>
          <span class="filter-chip-count">{{ catCount(c.key) }}</span>
        </button>
      </div>

      <!-- Row 3: Countries (no label, horizontal scroll). Only if any detected. -->
      <div v-if="availableCountries.length" class="chip-row mt-1.5">
        <button v-for="country in availableCountries"
                :key="country.code"
                class="country-chip"
                :class="{ active: isCountryActive(country.code), off: isCountryOff(country.code) }"
                :title="country.name"
                @click="toggleCountry(country.code)">
          <span class="country-chip-flag">{{ country.emoji }}</span>
          <span class="country-chip-name">{{ country.name }}</span>
          <span class="country-chip-count">{{ country.count }}</span>
        </button>
      </div>
    </div>
  `
};
