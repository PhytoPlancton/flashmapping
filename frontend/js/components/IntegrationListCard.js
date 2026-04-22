// IntegrationListCard.js — Card single CRM dans la liste Intégrations.
// Props: integration { key, name, subtitle, logoHtml, available, status }
//   status: 'connected' | 'disconnected' | 'error' | 'coming-soon'
import { computed } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';

export default {
  name: 'IntegrationListCard',
  props: {
    integration: { type: Object, required: true }
  },
  emits: ['select'],
  setup(props, { emit }) {
    const status = computed(() => props.integration.status || 'disconnected');
    const available = computed(() => !!props.integration.available);

    const dotClass = computed(() => {
      if (status.value === 'connected') return 'status-dot status-green';
      if (status.value === 'error') return 'status-dot status-red';
      return 'status-dot status-grey';
    });

    const statusLabel = computed(() => {
      if (status.value === 'connected') return 'Connecté';
      if (status.value === 'error') return 'Erreur';
      if (status.value === 'coming-soon') return 'Bientôt';
      return 'Non configuré';
    });

    function onClick() {
      if (!available.value) return;
      emit('select', props.integration);
    }

    return { status, available, dotClass, statusLabel, onClick };
  },
  template: `
    <div class="integration-list-card"
         :class="{ 'is-disabled': !available }"
         @click="onClick">
      <div class="integration-logo" v-html="integration.logoHtml"></div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <div class="text-[14px] font-semibold">{{ integration.name }}</div>
          <span class="integration-status-row">
            <span :class="dotClass"></span>
            <span class="text-[11.5px] text-ink-500">{{ statusLabel }}</span>
          </span>
        </div>
        <div class="text-[11.5px] text-ink-500 mt-0.5">{{ integration.subtitle }}</div>
      </div>
      <div class="shrink-0">
        <span v-if="!available" class="btn btn-secondary !text-[11px] !px-2 !py-1 is-disabled-chip" aria-disabled="true">Bientôt</span>
        <button v-else class="btn btn-secondary !text-[12px]" @click.stop="onClick">Configurer →</button>
      </div>
    </div>
  `
};
