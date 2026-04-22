import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import * as api from '../api.js';
import { icons } from '../icons.js';

export default {
  name: 'Onboarding',
  setup() {
    const creatingName = ref('');
    const joinCode = ref('');
    const creating = ref(false);
    const joining = ref(false);

    // Back button: hidden only if the user has zero teams — which is the
    // blocking first-login case. Because the backend auto-creates an
    // "espace personnel", this is rare. Fallback: route to last team's companies
    // or to the stored onboarding_origin (set by TeamSwitcher / TeamsListTab).
    const canGoBack = computed(() => (store.teams?.length || 0) > 0);

    function goBack() {
      // Priority 1: explicit origin hash (e.g. /settings/teams).
      try {
        const origin = sessionStorage.getItem('onboarding_origin');
        if (origin) {
          sessionStorage.removeItem('onboarding_origin');
          location.hash = origin;
          return;
        }
      } catch (e) {}
      // Priority 2: browser history.
      if (window.history.length > 1) {
        try { history.back(); return; } catch (e) {}
      }
      // Priority 3: last active team's companies.
      const slug = store.currentTeam?.slug || store.getLastTeamSlug();
      if (slug) location.hash = `#/${slug}/companies`;
    }

    async function afterJoin(team) {
      if (!team || !team.slug) {
        store.toast('Équipe invalide', 'error');
        return;
      }
      await store.initTeams();
      await store.switchTeam(team.slug);
    }

    async function createTeam() {
      const name = creatingName.value.trim();
      if (!name) {
        store.toast('Donne un nom à ton équipe', 'error');
        return;
      }
      creating.value = true;
      try {
        const team = await api.createTeam({ name });
        store.toast('Équipe créée', 'success');
        await afterJoin(team);
      } catch (e) {
        store.toast(e.message || 'Échec création équipe', 'error');
      } finally {
        creating.value = false;
      }
    }

    async function joinTeam() {
      const code = joinCode.value.trim();
      if (!code) {
        store.toast('Colle le code d\u2019invitation', 'error');
        return;
      }
      joining.value = true;
      try {
        const res = await api.acceptInvite({ code });
        const team = res?.team || res;
        store.toast('Bienvenue dans l\u2019équipe', 'success');
        await afterJoin(team);
      } catch (e) {
        store.toast(e.message || 'Code invalide ou expiré', 'error');
      } finally {
        joining.value = false;
      }
    }

    function logout() { store.logout(); }

    return {
      store, icons,
      creatingName, joinCode, creating, joining,
      createTeam, joinTeam, logout, canGoBack, goBack
    };
  },
  template: `
    <div class="min-h-screen bg-white flex flex-col">
      <header class="px-8 py-4 flex items-center justify-between border-b border-ink-100">
        <div class="flex items-center gap-3">
          <button v-if="canGoBack" class="btn btn-ghost text-[12px] -ml-2" @click="goBack">← Retour</button>
          <div class="flex items-center gap-2">
            <div class="w-7 h-7 rounded-md bg-ink-900 text-white flex items-center justify-center text-[12px] font-semibold">M</div>
            <div class="text-[13px] font-semibold">FlashMapping</div>
          </div>
        </div>
        <div class="flex items-center gap-3">
          <div class="text-[12px] text-ink-500" v-if="store.user">{{ store.user.email }}</div>
          <button class="btn btn-ghost text-[12px]" @click="logout">Se déconnecter</button>
        </div>
      </header>

      <main class="flex-1 flex items-center justify-center px-6 py-10">
        <div class="w-full max-w-3xl">
          <div class="text-center mb-10">
            <h1 class="text-[26px] font-semibold tracking-tight">Bienvenue sur FlashMapping</h1>
            <p class="text-ink-500 text-[13px] mt-2">
              Avant de commencer, rejoins une équipe existante ou crée la tienne.
              <br/>Chaque équipe dispose de ses propres comptes et contacts.
            </p>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <!-- Create team -->
            <div class="bg-white border border-ink-200 rounded-xl p-6 shadow-card flex flex-col">
              <div class="w-10 h-10 rounded-lg bg-ink-900 text-white flex items-center justify-center mb-4">
                <span v-html="icons.plus"></span>
              </div>
              <h2 class="text-[15px] font-semibold">Créer une équipe</h2>
              <p class="text-[12.5px] text-ink-500 mt-1 mb-4">
                Démarre un nouvel espace de travail. Tu en seras le propriétaire.
              </p>
              <form @submit.prevent="createTeam" class="mt-auto space-y-3">
                <div>
                  <label class="label">Nom de l\u2019équipe</label>
                  <input class="input" v-model="creatingName"
                         placeholder="Ma super équipe" autofocus />
                </div>
                <button type="submit" class="btn btn-primary w-full justify-center"
                        :disabled="creating">
                  {{ creating ? 'Création…' : 'Créer l\u2019équipe' }}
                </button>
              </form>
            </div>

            <!-- Join team -->
            <div class="bg-white border border-ink-200 rounded-xl p-6 shadow-card flex flex-col">
              <div class="w-10 h-10 rounded-lg bg-white border border-ink-200 text-ink-800 flex items-center justify-center mb-4">
                <span v-html="icons.building"></span>
              </div>
              <h2 class="text-[15px] font-semibold">Rejoindre une équipe</h2>
              <p class="text-[12.5px] text-ink-500 mt-1 mb-4">
                Utilise le code d\u2019invitation que ton coéquipier t\u2019a partagé.
              </p>
              <form @submit.prevent="joinTeam" class="mt-auto space-y-3">
                <div>
                  <label class="label">Code d\u2019invitation</label>
                  <input class="input font-mono tracking-wider" v-model="joinCode"
                         placeholder="XXXXXXXXXX" maxlength="24" />
                </div>
                <button type="submit" class="btn btn-secondary w-full justify-center"
                        :disabled="joining">
                  {{ joining ? 'Vérification…' : 'Rejoindre' }}
                </button>
              </form>
            </div>
          </div>

        </div>
      </main>
    </div>
  `
};
