// SettingsModal.js — displays the Settings content (Profil / Équipes /
// Intégrations) in a centered popup layered over the underlying page. The
// background is lightly blurred. Click-outside closes the modal.
//
// We re-use the existing Settings tab components (ProfileTab, TeamsListTab,
// TeamDetailTab, IntegrationsListTab, IntegrationPipedriveTab) and keep the
// hash-driven tab routing — only the visual shell differs from the full-page
// Settings view.
import { computed, onBeforeUnmount, onMounted, ref } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';

import ProfileTab from './ProfileTab.js';
import TeamsListTab from './TeamsListTab.js';
import TeamDetailTab from './TeamDetailTab.js';
import IntegrationsListTab from './IntegrationsListTab.js';
import IntegrationPipedriveTab from './IntegrationPipedriveTab.js';

const TABS = [
  { key: 'profile',      label: 'Profil',       hash: '#/settings/profile' },
  { key: 'teams',        label: 'Équipes',      hash: '#/settings/teams' },
  { key: 'integrations', label: 'Intégrations', hash: '#/settings/integrations' }
];

function parseHash() {
  const h = (location.hash || '').replace(/^#/, '') || '/';
  const parts = h.split('?')[0].split('/').filter(Boolean);
  if (parts[0] !== 'settings') return { tab: 'profile', extra: null };
  const tab = parts[1] || 'profile';
  const extra = parts[2] ? decodeURIComponent(parts[2]) : null;
  return { tab, extra };
}

export default {
  name: 'SettingsModal',
  components: {
    ProfileTab, TeamsListTab, TeamDetailTab,
    IntegrationsListTab, IntegrationPipedriveTab
  },
  setup() {
    const open = computed(() => store.settingsModalOpen);
    const routeState = ref(parseHash());

    function onHashChange() { routeState.value = parseHash(); }
    onMounted(() => window.addEventListener('hashchange', onHashChange));
    onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange));

    const activeTab = computed(() => {
      const t = routeState.value.tab;
      if (t === 'teams' || t === 'integrations' || t === 'profile') return t;
      return 'profile';
    });

    const view = computed(() => {
      const { tab, extra } = routeState.value;
      if (tab === 'profile') return { component: 'ProfileTab', props: {} };
      if (tab === 'teams') {
        if (extra) return { component: 'TeamDetailTab', props: { slug: extra } };
        return { component: 'TeamsListTab', props: {} };
      }
      if (tab === 'integrations') {
        if (extra === 'pipedrive') return { component: 'IntegrationPipedriveTab', props: {} };
        return { component: 'IntegrationsListTab', props: {} };
      }
      return { component: 'ProfileTab', props: {} };
    });

    function selectTab(hash) { location.hash = hash; }
    function close() { store.closeSettingsModal(); }
    function onOverlayClick() { close(); }
    function onCardClick(ev) { ev.stopPropagation(); }

    function onEsc(ev) {
      if (ev.key === 'Escape' && open.value) close();
    }
    onMounted(() => document.addEventListener('keydown', onEsc));
    onBeforeUnmount(() => document.removeEventListener('keydown', onEsc));

    return {
      open, tabs: TABS, activeTab, view,
      selectTab, close, onOverlayClick, onCardClick,
    };
  },
  template: `
    <transition name="settings-modal">
      <div v-if="open" class="settings-modal-overlay" @click="onOverlayClick">
        <div class="settings-modal-card" @click="onCardClick" role="dialog" aria-label="Paramètres">
          <header class="settings-modal-header">
            <h2>Paramètres</h2>
            <button class="settings-modal-close" @click="close" aria-label="Fermer">×</button>
          </header>

          <div class="settings-modal-tabs">
            <button v-for="t in tabs" :key="t.key"
                    class="settings-tab"
                    :class="{ active: activeTab === t.key }"
                    @click="selectTab(t.hash)">
              {{ t.label }}
            </button>
          </div>

          <div class="settings-modal-body">
            <component :is="view.component" v-bind="view.props" />
          </div>
        </div>
      </div>
    </transition>
  `
};
