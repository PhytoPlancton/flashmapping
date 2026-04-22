// Settings.js — Dispatcher. Route parsing happens in app.js (parseRoute) which
// sets route.value.{name, tab, slug, key}. Settings receives the current route
// via the global `location.hash` (watched reactively) and mounts the right
// sub-component inside a <SettingsShell>.
//
// Sub-routes:
//   /settings/profile              → ProfileTab
//   /settings/teams                → TeamsListTab
//   /settings/teams/{slug}         → TeamDetailTab
//   /settings/integrations         → IntegrationsListTab
//   /settings/integrations/pipedrive → IntegrationPipedriveTab
import { ref, computed, onMounted, onBeforeUnmount } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import SettingsShell from './SettingsShell.js';
import ProfileTab from './ProfileTab.js';
import TeamsListTab from './TeamsListTab.js';
import TeamDetailTab from './TeamDetailTab.js';
import IntegrationsListTab from './IntegrationsListTab.js';
import IntegrationPipedriveTab from './IntegrationPipedriveTab.js';

function parseHash() {
  const h = (location.hash || '').replace(/^#/, '') || '/';
  const parts = h.split('?')[0].split('/').filter(Boolean);
  // ['settings', tab?, extra?]
  if (parts[0] !== 'settings') return { tab: 'profile', extra: null };
  const tab = parts[1] || null;
  const extra = parts[2] ? decodeURIComponent(parts[2]) : null;
  return { tab, extra };
}

export default {
  name: 'Settings',
  components: {
    SettingsShell, ProfileTab, TeamsListTab, TeamDetailTab,
    IntegrationsListTab, IntegrationPipedriveTab
  },
  setup() {
    const routeState = ref(parseHash());

    function onHashChange() { routeState.value = parseHash(); }
    onMounted(() => window.addEventListener('hashchange', onHashChange));
    onBeforeUnmount(() => window.removeEventListener('hashchange', onHashChange));

    // Default: bare /settings → /settings/profile.
    // (The router in app.js also redirects, this is a belt + braces.)
    onMounted(() => {
      if (routeState.value.tab === null) {
        location.hash = '#/settings/profile';
      }
    });

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

    return { activeTab, view };
  },
  template: `
    <SettingsShell :activeTab="activeTab">
      <component :is="view.component" v-bind="view.props" />
    </SettingsShell>
  `
};
