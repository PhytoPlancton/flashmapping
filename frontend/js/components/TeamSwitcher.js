import { ref, onMounted, onBeforeUnmount, computed } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, initialsOf, ROLE_LABELS } from '../store.js';
import { icons } from '../icons.js';

export default {
  name: 'TeamSwitcher',
  setup() {
    const open = ref(false);
    const rootEl = ref(null);

    function toggle() { open.value = !open.value; }
    function close() { open.value = false; }

    function onDocClick(ev) {
      if (!open.value) return;
      if (rootEl.value && !rootEl.value.contains(ev.target)) close();
    }

    onMounted(() => document.addEventListener('mousedown', onDocClick));
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));

    async function pick(slug) {
      close();
      if (slug === store.currentTeam?.slug) return;
      await store.switchTeam(slug);
    }

    function goSettings() { close(); store.openSettingsModal(); }
    function goManageTeams() { close(); store.openSettingsModal(); location.hash = '#/settings/teams'; }
    function goOnboarding() {
      close();
      try { sessionStorage.setItem('onboarding_origin', location.hash || ''); } catch (e) {}
      location.hash = '#/onboarding';
    }

    const current = computed(() => store.currentTeam);
    const initials = computed(() => initialsOf(current.value?.name || '?'));

    return {
      store, icons, open, rootEl,
      toggle, close, pick, goSettings, goManageTeams, goOnboarding,
      current, initials, initialsOf, ROLE_LABELS
    };
  },
  template: `
    <div class="relative" ref="rootEl">
      <button type="button"
              class="team-switcher-btn"
              :class="{ active: open }"
              @click="toggle">
        <div class="team-avatar">{{ initials }}</div>
        <div class="flex-1 min-w-0 text-left">
          <div class="text-[13px] font-semibold truncate">
            {{ current?.name || 'Choisir une équipe' }}
          </div>
          <div class="text-[10.5px] text-ink-400 truncate">
            {{ current?.role ? ROLE_LABELS[current.role] : 'Aucune équipe' }}
          </div>
        </div>
        <span class="text-ink-400 shrink-0" v-html="icons.chevronDown"></span>
      </button>

      <div v-if="open" class="team-switcher-pop">
        <div class="px-3 pt-2 pb-1 text-[10.5px] uppercase tracking-wider text-ink-400 font-semibold">
          Équipes
        </div>
        <div class="max-h-[260px] overflow-y-auto py-1">
          <button v-for="t in store.teams" :key="t._id || t.slug"
                  class="team-switcher-item"
                  :class="{ active: t.slug === current?.slug }"
                  @click="pick(t.slug)">
            <div class="team-avatar sm">{{ initialsOf(t.name) }}</div>
            <div class="flex-1 min-w-0 text-left">
              <div class="text-[13px] font-medium truncate">{{ t.name }}</div>
              <div class="text-[10.5px] text-ink-400 truncate">{{ ROLE_LABELS[t.role] || t.role }}</div>
            </div>
            <span v-if="t.slug === current?.slug" class="text-[10px] text-ink-500">✓</span>
          </button>
          <div v-if="!store.teams.length" class="px-3 py-3 text-[12px] text-ink-400">
            Aucune équipe.
          </div>
        </div>
        <div class="border-t border-ink-100 py-1">
          <button class="team-switcher-item" @click="goManageTeams">
            <span class="w-6 h-6 flex items-center justify-center text-ink-500" v-html="icons.building"></span>
            <span class="flex-1 text-left text-[13px]">Gérer les équipes</span>
          </button>
          <button class="team-switcher-item" @click="goSettings">
            <span class="w-6 h-6 flex items-center justify-center text-ink-500" v-html="icons.pencil"></span>
            <span class="flex-1 text-left text-[13px]">Paramètres</span>
          </button>
          <button class="team-switcher-item" @click="goOnboarding">
            <span class="w-6 h-6 flex items-center justify-center text-ink-500" v-html="icons.plus"></span>
            <span class="flex-1 text-left text-[13px]">Créer / rejoindre une équipe</span>
          </button>
        </div>
      </div>
    </div>
  `
};
