// TeamsListTab.js — Vue management des teams (liste + créer/rejoindre).
// Wireframe §3.1 du UX doc : header "Mes équipes (N)" + actions + liste de
// TeamListCard. L'espace personnel est toujours visible (is_personal: true).
import { computed, onMounted } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import TeamListCard from './TeamListCard.js';

export default {
  name: 'TeamsListTab',
  components: { TeamListCard },
  setup() {
    onMounted(async () => {
      // Keep the list fresh every time the tab is opened.
      await store.initTeams();
    });

    const teams = computed(() => {
      // Personal team first, then the rest. Current team is highlighted via
      // the active flag on each card.
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

    function goCreate() {
      // Route onboarding with a hint so the back button goes back to /settings/teams.
      try { sessionStorage.setItem('onboarding_origin', '#/settings/teams'); } catch (e) {}
      location.hash = '#/onboarding';
    }
    function goJoin() {
      try { sessionStorage.setItem('onboarding_origin', '#/settings/teams'); } catch (e) {}
      location.hash = '#/onboarding';
    }

    return { store, teams, nonPersonalCount, emptyCollab, doSwitch, goCreate, goJoin };
  },
  template: `
    <div class="space-y-4" style="max-width:768px">
      <div class="flex items-center justify-between">
        <h2 class="text-[15px] font-semibold">Mes équipes ({{ teams.length }})</h2>
        <div class="flex items-center gap-2">
          <button class="btn btn-secondary" @click="goJoin">+ Rejoindre</button>
          <button class="btn btn-primary" @click="goCreate">+ Créer</button>
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

      <!-- Empty collab state — espace personnel toujours présent, mais pas de
           teams de collaboration. -->
      <div v-if="emptyCollab" class="mt-4 p-4 rounded-lg bg-ink-50 border border-ink-200 text-[12.5px] text-ink-600">
        Tu es seul dans ton espace personnel — crée ou rejoins une équipe pour collaborer.
      </div>
    </div>
  `
};
