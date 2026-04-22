// app.js — Vue 3 root + hash router + auth flow
import { createApp, computed, onMounted, ref, watch, h } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';

import { store } from './store.js';
import { isAuthenticated } from './auth.js';

import Login from './components/Login.js';
import Register from './components/Register.js';
import Onboarding from './components/Onboarding.js';
import Settings from './components/Settings.js';
import Sidebar from './components/Sidebar.js';
import CompanyHeader from './components/CompanyHeader.js';
import AccountToolbar from './components/AccountToolbar.js';
import OrgTree from './components/OrgTree.js';
import OrgTreeFreeform from './components/OrgTreeFreeform.js';
import ContactModal from './components/ContactModal.js';
import CompanyModal from './components/CompanyModal.js';
import InviteModal from './components/InviteModal.js';
import UndoToast from './components/UndoToast.js';
import ICPPanel from './components/ICPPanel.js';
import SettingsModal from './components/SettingsModal.js';

/* ================== Hash router ==================

Recognised hashes:
  #/login
  #/register
  #/onboarding
  #/settings                              → redirects to /settings/profile
  #/settings/profile
  #/settings/teams
  #/settings/teams/{slug}
  #/settings/integrations
  #/settings/integrations/pipedrive
  #/{team_slug}/companies
  #/{team_slug}/companies/{company_slug}

Legacy `#/companies` and `#/companies/{slug}` are auto-upgraded to team-scoped.
================================================== */

const RESERVED = new Set(['login', 'register', 'onboarding', 'settings', 'companies', '']);

function parseRoute(hash) {
  const h = (hash || '').replace(/^#/, '') || '/';
  const parts = h.split('?')[0].split('/').filter(Boolean);
  const first = parts[0];

  if (!first) return { name: 'home' };
  if (first === 'login') return { name: 'login' };
  if (first === 'register') return { name: 'register' };
  if (first === 'onboarding') return { name: 'onboarding' };

  if (first === 'settings') {
    // #/settings  → redirect
    if (!parts[1]) return { name: 'settings', tab: null };
    const tab = parts[1];
    if (tab === 'profile') return { name: 'settings', tab: 'profile' };
    if (tab === 'teams') {
      if (parts[2]) return { name: 'settings', tab: 'teams', slug: decodeURIComponent(parts[2]) };
      return { name: 'settings', tab: 'teams' };
    }
    if (tab === 'integrations') {
      if (parts[2]) return { name: 'settings', tab: 'integrations', key: decodeURIComponent(parts[2]) };
      return { name: 'settings', tab: 'integrations' };
    }
    // Unknown sub-route: redirect to profile
    return { name: 'settings', tab: null };
  }

  // Legacy routes: #/companies, #/companies/{slug}
  if (first === 'companies') {
    if (parts[1]) return { name: 'legacy-company', slug: decodeURIComponent(parts[1]) };
    return { name: 'legacy-companies' };
  }

  // Team-scoped: first segment is team slug
  const teamSlug = decodeURIComponent(first);
  if (parts[1] === 'companies') {
    if (parts[2]) return { name: 'company', teamSlug, slug: decodeURIComponent(parts[2]) };
    return { name: 'companies', teamSlug };
  }

  return { name: 'home' };
}

const route = ref(parseRoute(location.hash));
window.addEventListener('hashchange', () => { route.value = parseRoute(location.hash); });

function navigate(to) {
  if (location.hash !== to) location.hash = to;
}

/* ================== Companies layout ================== */

const CompaniesLayout = {
  name: 'CompaniesLayout',
  components: { Sidebar, CompanyHeader, AccountToolbar, OrgTree, OrgTreeFreeform },
  setup() {
    function readViewMode(id) {
      if (!id) return 'levels';
      try {
        const v = localStorage.getItem('viewMode_' + id);
        return v === 'freeform' ? 'freeform' : 'levels';
      } catch (e) { return 'levels'; }
    }
    const viewMode = ref('levels');
    function onViewChange(mode) {
      viewMode.value = mode === 'freeform' ? 'freeform' : 'levels';
    }
    // Sync viewMode to the active company's stored preference whenever
    // it changes (first load, switch company, etc.).
    watch(() => store.activeCompany?._id || store.activeCompany?.slug, (id) => {
      viewMode.value = readViewMode(id);
    }, { immediate: true });

    // When route changes, ensure currentTeam matches teamSlug and load data.
    watch(() => route.value, async (r) => {
      if (r.name !== 'company' && r.name !== 'companies') return;
      // If teamSlug differs from currentTeam, switch (without re-navigating).
      if (r.teamSlug && r.teamSlug !== store.currentTeam?.slug) {
        const match = store.teams.find(t => t.slug === r.teamSlug);
        if (match) {
          store.setCurrentTeam(match);
          await store.loadCompanies();
        } else {
          // Team slug not found in user's teams — try refetch, then onboarding.
          await store.initTeams();
          const again = store.teams.find(t => t.slug === r.teamSlug);
          if (again) {
            store.setCurrentTeam(again);
            await store.loadCompanies();
          } else if (store.teams.length === 0) {
            navigate('#/onboarding');
            return;
          } else {
            // Redirect to first available team
            const t = store.pickInitialTeam();
            await store.switchTeam(t.slug);
            return;
          }
        }
      }

      if (r.name === 'company' && r.slug && r.slug !== store.activeSlug) {
        await store.loadCompany(r.slug);
      } else if (r.name === 'companies' && store.activeSlug) {
        store.activeSlug = null;
        store.activeCompany = null;
      }
    }, { immediate: true });

    const showingCompany = computed(() => route.value.name === 'company' && !!store.activeCompany);
    const loadingCompany = computed(() => store.activeCompanyLoading);

    return { store, route, showingCompany, loadingCompany, viewMode, onViewChange };
  },
  template: `
    <div class="flex h-screen overflow-hidden">
      <Sidebar />
      <main class="flex-1 min-w-0 flex flex-col overflow-hidden">
        <div class="flex-1 overflow-auto">
          <template v-if="loadingCompany">
            <div class="p-16 text-center text-ink-400 text-sm">Chargement du compte…</div>
          </template>
          <template v-else-if="showingCompany">
            <CompanyHeader :company="store.activeCompany" />
            <AccountToolbar :company="store.activeCompany" @view-change="onViewChange" />
            <OrgTree v-if="viewMode === 'levels'" :company="store.activeCompany" />
            <OrgTreeFreeform v-else :company="store.activeCompany" />
          </template>
          <template v-else>
            <div class="h-full flex flex-col items-center justify-center text-center px-8 text-ink-400">
              <div class="w-14 h-14 rounded-2xl bg-white border border-ink-200 flex items-center justify-center mb-4 shadow-card">
                <span class="text-2xl">·</span>
              </div>
              <h3 class="text-base text-ink-700 font-semibold mb-1">Sélectionne un compte</h3>
              <p class="text-sm max-w-sm">
                Choisis un compte dans la barre latérale pour afficher sa carte d'org-chart
                et ses contacts par niveau.
              </p>
            </div>
          </template>
        </div>
      </main>
    </div>
  `
};

/* ================== Modal host ================== */

const ModalHost = {
  name: 'ModalHost',
  components: { ContactModal, CompanyModal, InviteModal },
  setup() {
    function close() { store.modal = null; }
    function onInviteCreated(_inv) { /* Settings tab will re-fetch on close */ }
    return { store, close, onInviteCreated };
  },
  template: `
    <div>
      <ContactModal v-if="store.modal?.type === 'contact-create'"
                    mode="create" :initial="store.modal.payload || {}"
                    @close="close" />
      <ContactModal v-if="store.modal?.type === 'contact-edit'"
                    mode="edit" :initial="store.modal.payload || {}"
                    @close="close" />
      <CompanyModal v-if="store.modal?.type === 'company-create'"
                    mode="create" :initial="store.modal.payload || {}"
                    @close="close" />
      <CompanyModal v-if="store.modal?.type === 'company-edit'"
                    mode="edit" :initial="store.modal.payload || {}"
                    @close="close" />
      <InviteModal  v-if="store.modal?.type === 'invite-create'"
                    @close="close"
                    @created="onInviteCreated" />
    </div>
  `
};

/* ================== Toast host ================== */

const ToastHost = {
  name: 'ToastHost',
  components: { UndoToast },
  setup() { return { store }; },
  template: `
    <div>
      <div class="toast-stack">
        <div v-for="t in store.toasts" :key="t.id"
             class="toast" :class="t.variant">
          {{ t.message }}
        </div>
      </div>
      <UndoToast v-if="store.undoToast"
                 :message="store.undoToast.message"
                 :actionLabel="store.undoToast.actionLabel || 'Annuler'"
                 :duration="store.undoToast.duration || 5000"
                 @undo="store.undoToast && store.undoToast.onUndo && store.undoToast.onUndo()"
                 @dismiss="store.clearUndoToast()" />
    </div>
  `
};

/* ================== App root ================== */

const App = {
  name: 'App',
  components: { Login, Register, Onboarding, Settings, CompaniesLayout, ModalHost, ToastHost, ICPPanel, SettingsModal },
  setup() {
    const booting = ref(true);

    async function routeAfterAuth() {
      // Called after we have a valid user+token.
      await store.initTeams();

      // Legacy `#/companies` → upgrade to team slug
      const r = route.value;
      if (r.name === 'legacy-companies' || r.name === 'legacy-company') {
        if (store.teams.length === 0) {
          navigate('#/onboarding');
          return;
        }
        const t = store.pickInitialTeam();
        if (r.name === 'legacy-company') {
          navigate(`#/${t.slug}/companies/${r.slug}`);
        } else {
          navigate(`#/${t.slug}/companies`);
        }
        store.setCurrentTeam(t);
        return;
      }

      if (store.teams.length === 0) {
        navigate('#/onboarding');
        return;
      }

      // Initial route: pick last used / first team
      const preferred = store.pickInitialTeam();
      store.setCurrentTeam(preferred);

      // Bare #/settings → /settings/profile
      if (location.hash === '#/settings') {
        navigate('#/settings/profile');
        return;
      }

      if (!location.hash
          || location.hash === '#/'
          || location.hash === '#/login'
          || location.hash === '#/register'
          || location.hash === '#/onboarding') {
        navigate(`#/${preferred.slug}/companies`);
      }
    }

    async function boot() {
      booting.value = true;
      await store.checkBootstrap();

      if (store.bootstrapNeeded) {
        navigate('#/register');
      } else if (!isAuthenticated()) {
        navigate('#/login');
      } else {
        const u = await store.fetchMe();
        if (!u) {
          navigate('#/login');
        } else {
          await routeAfterAuth();
        }
      }
      booting.value = false;
    }

    onMounted(boot);

    // Guard: when on onboarding or settings but there's no user → login.
    // Also handles #/settings → #/settings/profile redirect.
    watch(() => route.value, (r) => {
      if (booting.value) return;
      if (r.name === 'login' || r.name === 'register') return;
      if (!isAuthenticated()) { navigate('#/login'); return; }
      if (r.name === 'settings' && !store.user) { navigate('#/login'); return; }
      // Redirect bare #/settings → /settings/profile
      if (r.name === 'settings' && r.tab === null) {
        navigate('#/settings/profile');
      }
    }, { immediate: true });

    // Route screen resolver. When the Settings MODAL is open, suppress the
    // "settings" full-page screen so the underlying page (companies) stays
    // mounted behind the modal overlay.
    const screen = computed(() => {
      const r = route.value;
      if (r.name === 'login') return 'login';
      if (r.name === 'register') return 'register';
      if (r.name === 'onboarding') return 'onboarding';
      if (r.name === 'settings') return store.settingsModalOpen ? 'companies' : 'settings';
      return 'companies';
    });

    return { store, route, booting, screen };
  },
  template: `
    <div>
      <div v-if="booting" class="min-h-screen flex items-center justify-center text-ink-400 text-sm">
        <span>Chargement…</span>
      </div>
      <template v-else>
        <Login       v-if="screen === 'login'" />
        <Register    v-else-if="screen === 'register'" />
        <Onboarding  v-else-if="screen === 'onboarding'" />
        <Settings    v-else-if="screen === 'settings'" />
        <CompaniesLayout v-else />
      </template>

      <ModalHost />
      <ToastHost />
      <ICPPanel />
      <SettingsModal />
    </div>
  `
};

const _app = createApp(App);
_app.config.errorHandler = (err, _instance, info) => {
  const el = document.getElementById('__boot_err');
  if (el) {
    el.style.display = 'block';
    el.textContent = (el.textContent ? el.textContent + '\n\n' : '') +
      `[vue ${info}] ` + (err && err.stack || err && err.message || String(err));
  }
  console.error('[vue]', info, err);
};
_app.config.warnHandler = (msg, _instance, trace) => {
  console.warn('[vue-warn]', msg, trace);
};
_app.mount('#app');
