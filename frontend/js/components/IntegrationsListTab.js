// IntegrationsListTab.js — Liste des CRMs de la team courante.
// Wireframe §3.3 du UX doc. "Connectés" en haut + "Disponibles" grisés en
// dessous. Scope = team courante (une clé API Pipedrive appartient à une team).
import { ref, computed, onMounted, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import * as api from '../api.js';
import { icons } from '../icons.js';
import IntegrationListCard from './IntegrationListCard.js';

// Placeholder HubSpot / Salesforce logos (Heroicons-style).
const HUBSPOT_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-10 h-10"><rect x="1" y="1" width="22" height="22" rx="5" fill="#FF7A59"/><path d="M15.5 12.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0z" fill="#fff"/><path d="M13 10V7a2 2 0 1 0-2 0v3" stroke="#fff" stroke-width="1.4" fill="none" stroke-linecap="round"/></svg>`;
const SALESFORCE_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" class="w-10 h-10"><rect x="1" y="1" width="22" height="22" rx="5" fill="#00A1E0"/><path d="M7 13a3 3 0 0 1 6-1 3 3 0 0 1 5 3 3 3 0 0 1-6 2 3 3 0 0 1-5-4z" fill="#fff"/></svg>`;

export default {
  name: 'IntegrationsListTab',
  components: { IntegrationListCard },
  setup() {
    const pipedriveStatus = ref('disconnected'); // connected | disconnected | error
    const loading = ref(false);
    const companyDomain = ref('');
    const connectedAt = ref(null);

    async function loadStatus() {
      const slug = store.currentTeam?.slug;
      if (!slug) { pipedriveStatus.value = 'disconnected'; return; }
      loading.value = true;
      try {
        const s = await api.pipedriveStatus(slug);
        if (s?.configured) {
          pipedriveStatus.value = s?.error ? 'error' : 'connected';
          companyDomain.value = s?.company_domain || s?.user?.company_domain || '';
          connectedAt.value = s?.connected_at || null;
        } else {
          pipedriveStatus.value = 'disconnected';
        }
      } catch (e) {
        pipedriveStatus.value = 'error';
      } finally {
        loading.value = false;
      }
    }

    onMounted(loadStatus);
    watch(() => store.currentTeam?.slug, loadStatus);

    const pipedriveIntegration = computed(() => ({
      key: 'pipedrive',
      name: 'Pipedrive',
      subtitle: pipedriveStatus.value === 'connected' && companyDomain.value
        ? `${companyDomain.value}.pipedrive.com`
        : 'Synchronise tes comptes et contacts vers Pipedrive',
      logoHtml: icons.pipedriveColored.replace('class="w-4 h-4"', 'class="w-10 h-10"'),
      available: true,
      status: pipedriveStatus.value
    }));

    const comingSoon = computed(() => ([
      { key: 'hubspot',    name: 'HubSpot',    subtitle: 'CRM inbound / marketing automation', logoHtml: HUBSPOT_LOGO,    available: false, status: 'coming-soon' },
      { key: 'salesforce', name: 'Salesforce', subtitle: 'CRM enterprise',                     logoHtml: SALESFORCE_LOGO, available: false, status: 'coming-soon' }
    ]));

    function onSelect(integration) {
      if (integration.key === 'pipedrive') {
        location.hash = '#/settings/integrations/pipedrive';
      }
    }

    return { store, loading, pipedriveIntegration, comingSoon, onSelect };
  },
  template: `
    <div style="max-width:768px">
      <div class="mb-5">
        <h2 class="text-[15px] font-semibold">
          Intégrations<span v-if="store.currentTeam?.name"> de {{ store.currentTeam.name }}</span>
        </h2>
        <p class="text-[12.5px] text-ink-500 mt-1">Connecte un CRM pour synchroniser tes comptes et contacts.</p>
      </div>

      <div class="space-y-5">
        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-ink-400 font-semibold mb-2">Connectés</div>
          <IntegrationListCard :integration="pipedriveIntegration" @select="onSelect" />
        </div>

        <div>
          <div class="text-[10.5px] uppercase tracking-wider text-ink-400 font-semibold mb-2">Disponibles</div>
          <div class="space-y-2">
            <IntegrationListCard v-for="i in comingSoon" :key="i.key" :integration="i" @select="onSelect" />
          </div>
        </div>
      </div>
    </div>
  `
};
