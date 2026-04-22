// SettingsShell.js — Layout commun pour tous les écrans Settings.
// Expose un header (titre + back) + une row de tabs horizontaux + un slot pour
// le contenu du tab actif. Style "Notion" : underline noir sur l'onglet actif.
import { computed } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';

const TABS = [
  { key: 'profile',      label: 'Profil',       hash: '#/settings/profile' },
  { key: 'teams',        label: 'Équipes',      hash: '#/settings/teams' },
  { key: 'integrations', label: 'Intégrations', hash: '#/settings/integrations' }
];

export default {
  name: 'SettingsShell',
  props: {
    activeTab: { type: String, required: true } // 'profile' | 'teams' | 'integrations'
  },
  setup(props) {
    function goBack() {
      // Prefer real browser history (keeps Notion-style UX). Fallback to
      // companies of the last active team (we always have at least an espace
      // personnel thanks to the backend auto-seed).
      if (window.history.length > 1) {
        try { history.back(); return; } catch (e) {}
      }
      const slug = store.currentTeam?.slug || store.getLastTeamSlug();
      if (slug) location.hash = `#/${slug}/companies`;
      else location.hash = '#/onboarding';
    }

    function selectTab(hash) {
      location.hash = hash;
    }

    return { store, tabs: TABS, props, goBack, selectTab };
  },
  template: `
    <div class="min-h-screen bg-[#FAFAFA]">
      <div class="max-w-3xl mx-auto px-6 py-8">
        <div class="flex items-center gap-2 mb-5">
          <button class="btn btn-ghost text-[12px] -ml-2" @click="goBack">← Retour</button>
        </div>

        <h1 class="text-[22px] font-semibold tracking-tight mb-6">Paramètres</h1>

        <div class="settings-tabs">
          <button v-for="t in tabs" :key="t.key"
                  class="settings-tab"
                  :class="{ active: activeTab === t.key }"
                  @click="selectTab(t.hash)">
            {{ t.label }}
          </button>
        </div>

        <div class="mt-6">
          <slot></slot>
        </div>
      </div>
    </div>
  `
};
