// TeamsListTab.js — Vue management des teams (liste + créer/rejoindre).
// Create / Join now happens INLINE in this tab (no full-page onboarding
// navigation), so the Settings modal stays open and click-outside closes
// it like any other modal.
import { computed, onMounted, ref, nextTick } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import * as api from '../api.js';
import TeamListCard from './TeamListCard.js';

export default {
  name: 'TeamsListTab',
  components: { TeamListCard },
  setup() {
    const mode = ref('list'); // 'list' | 'create' | 'join'
    const creatingName = ref('');
    const joinCode = ref('');
    const creating = ref(false);
    const joining = ref(false);
    const nameInputEl = ref(null);
    const codeInputEl = ref(null);

    onMounted(async () => {
      await store.initTeams();
    });

    const teams = computed(() => {
      const list = [...(store.teams || [])];
      list.sort((a, b) => {
        const pa = a.is_personal ? 0 : 1;
        const pb = b.is_personal ? 0 : 1;
        if (pa !== pb) return pa - pb;
        return (a.name || '').localeCompare(b.name || '');
      });
      return list;
    });

    const nonPersonalCount = computed(() =>
      (store.teams || []).filter(t => !t.is_personal).length
    );
    const emptyCollab = computed(() => nonPersonalCount.value === 0);

    async function doSwitch(team) {
      if (!team?.slug) return;
      await store.switchTeam(team.slug);
    }

    async function showCreate() {
      mode.value = 'create';
      await nextTick();
      nameInputEl.value?.focus();
    }
    async function showJoin() {
      mode.value = 'join';
      await nextTick();
      codeInputEl.value?.focus();
    }
    function backToList() {
      mode.value = 'list';
      creatingName.value = '';
      joinCode.value = '';
    }

    async function createTeam() {
      const name = creatingName.value.trim();
      if (!name) {
        store.toast?.('Donne un nom à ton équipe', 'error');
        return;
      }
      creating.value = true;
      try {
        const team = await api.createTeam({ name });
        store.toast?.('Équipe créée', 'success');
        await store.initTeams();
        if (team?.slug) await store.switchTeam(team.slug, { navigate: false });
        backToList();
      } catch (e) {
        store.toast?.(e.message || 'Échec création équipe', 'error');
      } finally {
        creating.value = false;
      }
    }

    async function joinTeam() {
      const code = joinCode.value.trim();
      if (!code) {
        store.toast?.("Colle le code d'invitation", 'error');
        return;
      }
      joining.value = true;
      try {
        const res = await api.acceptInvite({ code });
        const team = res?.team || res;
        store.toast?.("Bienvenue dans l'équipe", 'success');
        await store.initTeams();
        if (team?.slug) await store.switchTeam(team.slug, { navigate: false });
        backToList();
      } catch (e) {
        store.toast?.(e.message || 'Code invalide ou expiré', 'error');
      } finally {
        joining.value = false;
      }
    }

    return {
      store, teams, nonPersonalCount, emptyCollab, doSwitch,
      mode, showCreate, showJoin, backToList,
      creatingName, joinCode, creating, joining, createTeam, joinTeam,
      nameInputEl, codeInputEl,
    };
  },
  template: `
    <div class="space-y-4" style="max-width:768px">
      <!-- LIST MODE -->
      <template v-if="mode === 'list'">
        <div class="flex items-center justify-between">
          <h2 class="text-[15px] font-semibold">Mes équipes ({{ teams.length }})</h2>
          <div class="flex items-center gap-2">
            <button class="btn btn-secondary" @click="showJoin">+ Rejoindre</button>
            <button class="btn btn-primary" @click="showCreate">+ Créer</button>
          </div>
        </div>

        <div v-if="store.teamsLoading && teams.length === 0" class="space-y-3">
          <div class="team-list-card skeleton"></div>
          <div class="team-list-card skeleton"></div>
        </div>

        <div v-else class="space-y-3">
          <TeamListCard v-for="t in teams" :key="t._id || t.slug"
                        :team="t"
                        :active="t.slug === store.currentTeam?.slug"
                        @switch="doSwitch" />
        </div>

        <div v-if="emptyCollab" class="mt-4 p-4 rounded-lg bg-ink-50 border border-ink-200 text-[12.5px] text-ink-600">
          Tu es seul dans ton espace personnel — crée ou rejoins une équipe pour collaborer.
        </div>
      </template>

      <!-- CREATE MODE -->
      <template v-else-if="mode === 'create'">
        <button type="button" class="btn-ghost text-[12px] -ml-2" @click="backToList">← Retour</button>
        <div class="bg-white border border-ink-200 rounded-xl p-5">
          <h2 class="text-[15px] font-semibold">Créer une équipe</h2>
          <p class="text-[12.5px] text-ink-500 mt-1 mb-4">
            Démarre un nouvel espace de travail. Tu en seras le propriétaire.
          </p>
          <form @submit.prevent="createTeam" class="space-y-3">
            <div>
              <label class="label">Nom de l'équipe</label>
              <input class="input" v-model="creatingName" ref="nameInputEl"
                     placeholder="Ma super équipe" />
            </div>
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn btn-secondary" @click="backToList">Annuler</button>
              <button type="submit" class="btn btn-primary" :disabled="creating">
                {{ creating ? 'Création…' : "Créer l'équipe" }}
              </button>
            </div>
          </form>
        </div>
      </template>

      <!-- JOIN MODE -->
      <template v-else-if="mode === 'join'">
        <button type="button" class="btn-ghost text-[12px] -ml-2" @click="backToList">← Retour</button>
        <div class="bg-white border border-ink-200 rounded-xl p-5">
          <h2 class="text-[15px] font-semibold">Rejoindre une équipe</h2>
          <p class="text-[12.5px] text-ink-500 mt-1 mb-4">
            Utilise le code d'invitation que ton coéquipier t'a partagé.
          </p>
          <form @submit.prevent="joinTeam" class="space-y-3">
            <div>
              <label class="label">Code d'invitation</label>
              <input class="input font-mono tracking-wider" v-model="joinCode" ref="codeInputEl"
                     placeholder="XXXXXXXXXX" maxlength="24" />
            </div>
            <div class="flex items-center justify-end gap-2">
              <button type="button" class="btn btn-secondary" @click="backToList">Annuler</button>
              <button type="submit" class="btn btn-primary" :disabled="joining">
                {{ joining ? 'Vérification…' : 'Rejoindre' }}
              </button>
            </div>
          </form>
        </div>
      </template>
    </div>
  `
};
