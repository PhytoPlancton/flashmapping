// CompanyHeader.js — Zones A (identité + actions) + B (attributs).
// Toggle Niveaux/Freeform + filtres sont dans AccountToolbar.
// Menu ⋯ (export, éditer, archiver, copier URL) dans ActionsMenu.

import { computed, ref, watch, onBeforeUnmount } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, priorityChipClass, countryFlag } from '../store.js';
import { icons } from '../icons.js';
import * as api from '../api.js';
import ActionsMenu from './ActionsMenu.js';

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'à l\u2019instant';
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} j`;
  const mo = Math.round(d / 30);
  return `${mo} mois`;
}

const MAX_AREAS_VISIBLE = 5;

export default {
  name: 'CompanyHeader',
  components: { ActionsMenu },
  props: { company: { type: Object, required: true } },
  setup(props) {
    const initials = computed(() => {
      const n = props.company?.name || '';
      return n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '—';
    });

    /* ===== Website link ===== */
    const websiteHref = computed(() => {
      const d = props.company?.domain;
      if (!d) return '';
      return /^https?:\/\//i.test(d) ? d : `https://${d.replace(/^\/+/, '')}`;
    });
    const websiteLabel = computed(() => {
      const d = props.company?.domain || '';
      return d.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    });

    /* ===== HQ: city + country (no street) for compactness ===== */
    const hqShort = computed(() => {
      const hq = props.company?.hq;
      if (!hq) return '';
      // Heuristic: keep last comma-separated segment (city / region) if the
      // raw HQ contains street addresses. Fallback to full string.
      const parts = String(hq).split(',').map(s => s.trim()).filter(Boolean);
      if (parts.length >= 2) return parts.slice(-2).join(', ');
      return hq;
    });

    const countryEmoji = computed(() => countryFlag(props.company?.country) || '');

    /* ===== Add contact (primary CTA) ===== */
    function addContact() { store.modal = { type: 'contact-create' }; }

    /* ===== Pipedrive sync (secondary, always visible) ===== */
    const syncing = ref(false);
    // Force re-computation of the "synced il y a" sub-label every 30s.
    const tick = ref(0);
    let timer = null;
    watch(() => props.company?._id, () => {
      if (timer) clearInterval(timer);
      timer = setInterval(() => { tick.value++; }, 30000);
    }, { immediate: true });
    onBeforeUnmount(() => { if (timer) clearInterval(timer); });

    const crmIdInt = computed(() => {
      const raw = props.company?.crm_id;
      if (raw === null || raw === undefined) return null;
      const s = String(raw).trim();
      if (!s) return null;
      const n = parseInt(s, 10);
      return Number.isFinite(n) && n > 0 ? n : null;
    });

    // `pipedrive_configured` is published by the backend on team.settings
    // (TeamSettingsPublic.from_settings). When false, we don't show the sync
    // button at all — instead a "Connecter Pipedrive" CTA opens the Settings
    // modal straight to the Pipedrive tab.
    const pipedriveConfigured = computed(
      () => !!store.currentTeam?.settings?.pipedrive_configured
    );
    const canSync = computed(
      () => pipedriveConfigured.value && crmIdInt.value !== null && !syncing.value
    );
    function openPipedriveSettings() {
      store.openSettingsModal();
      // The Settings modal reads location.hash to pick the active tab.
      location.hash = '#/settings/integrations/pipedrive';
    }

    const lastSyncedAt = computed(() => {
      // eslint-disable-next-line no-unused-expressions
      tick.value;
      const contacts = props.company?.contacts || [];
      let best = 0;
      for (const c of contacts) {
        if (c.pipedrive_synced_at) {
          const t = new Date(c.pipedrive_synced_at).getTime();
          if (Number.isFinite(t) && t > best) best = t;
        }
      }
      return best > 0 ? new Date(best).toISOString() : '';
    });

    const lastSyncedRel = computed(() => formatRelative(lastSyncedAt.value));

    async function syncPipedrive() {
      const teamSlug = store.currentTeam?.slug;
      const companySlug = props.company?.slug;
      if (!teamSlug || !companySlug) {
        store.toast('Contexte équipe/compte manquant', 'error');
        return;
      }
      if (crmIdInt.value === null) {
        store.toast('Définis le CRM_ID de la company avant de sync', 'error');
        return;
      }
      syncing.value = true;
      try {
        const res = await api.syncCompanyToPipedrive(teamSlug, companySlug);
        const errCount = (res?.errors || []).length;
        const msg = `${res.synced} contact${res.synced > 1 ? 's' : ''} synchronisé${res.synced > 1 ? 's' : ''}` +
                    ` (${res.created} créé${res.created > 1 ? 's' : ''}, ${res.updated} mis à jour)` +
                    (errCount ? ` — ${errCount} erreur${errCount > 1 ? 's' : ''}` : '');
        store.toast(msg, errCount ? 'error' : 'success');
        await store.refreshActiveCompany();
      } catch (e) {
        store.toast(e.message || 'Sync Pipedrive échouée', 'error');
      } finally {
        syncing.value = false;
      }
    }

    const syncTooltip = computed(() => {
      if (crmIdInt.value === null) return 'Définis le CRM_ID de la company avant de sync';
      if (syncing.value) return 'Synchronisation en cours…';
      return 'Pousser tous les contacts vers Pipedrive';
    });

    /* ===== Therapeutic areas overflow (+N → popover) ===== */
    const areasPopoverOpen = ref(false);
    const areasWrapRef = ref(null);

    const allAreas = computed(() => {
      const raw = props.company?.therapeutic_areas;
      return Array.isArray(raw) ? raw.filter(Boolean) : [];
    });
    const displayedAreas = computed(() => allAreas.value.slice(0, MAX_AREAS_VISIBLE));
    const overflowCount = computed(() => Math.max(0, allAreas.value.length - MAX_AREAS_VISIBLE));
    const overflowAreas = computed(() => allAreas.value.slice(MAX_AREAS_VISIBLE));

    function toggleAreasPopover() { areasPopoverOpen.value = !areasPopoverOpen.value; }
    function closeAreasPopover() { areasPopoverOpen.value = false; }

    function onAreasDocClick(e) {
      if (!areasPopoverOpen.value) return;
      const el = areasWrapRef.value;
      if (el && !el.contains(e.target)) closeAreasPopover();
    }
    function onAreasKey(e) {
      if (e.key === 'Escape') closeAreasPopover();
    }
    // Set up / tear down listeners lazily — only while open would also work
    // but this is simpler and very cheap.
    document.addEventListener('mousedown', onAreasDocClick);
    document.addEventListener('keydown', onAreasKey);
    onBeforeUnmount(() => {
      document.removeEventListener('mousedown', onAreasDocClick);
      document.removeEventListener('keydown', onAreasKey);
    });

    /* ===== Contacts count ===== */
    const contactCount = computed(() => (props.company?.contacts || []).length);

    // Expose the live company reference (computed so Vue tracks prop swaps).
    const company = computed(() => props.company || {});

    return {
      company,
      initials, websiteHref, websiteLabel,
      hqShort, countryEmoji,
      addContact,
      syncPipedrive, syncing, canSync, crmIdInt, syncTooltip,
      pipedriveConfigured, openPipedriveSettings,
      lastSyncedRel,
      displayedAreas, overflowCount, overflowAreas,
      areasPopoverOpen, areasWrapRef, toggleAreasPopover,
      contactCount,
      priorityChipClass, icons
    };
  },
  template: `
    <header class="account-header">
      <!-- Zone A: identité + actions -->
      <section class="account-zone-a">
        <div class="flex items-start gap-4">
          <div class="w-10 h-10 rounded-lg bg-white border border-ink-200 flex items-center justify-center
                      font-bold text-[13px] text-ink-800 shrink-0">
            {{ initials }}
          </div>

          <div class="flex-1 min-w-0">
            <div class="flex items-baseline gap-2.5 flex-wrap">
              <h1 class="text-[22px] font-semibold tracking-tight leading-tight text-ink-900 truncate max-w-full"
                  :title="company.name">
                {{ company.name }}
              </h1>
              <span :class="priorityChipClass(company.priority)">{{ company.priority || '—' }}</span>
              <a v-if="websiteHref"
                 :href="websiteHref" target="_blank" rel="noopener"
                 class="text-[12px] text-ink-500 inline-flex items-center gap-1 hover:text-ink-700">
                {{ websiteLabel }}
                <span v-html="icons.arrowUpRight"></span>
              </a>
            </div>

            <div class="mt-1.5 flex items-center gap-3 text-[12.5px] text-ink-500 flex-wrap">
              <span v-if="hqShort" class="inline-flex items-center gap-1.5">
                <span v-html="icons.mapPin"></span>
                <span>{{ hqShort }}</span>
                <span v-if="countryEmoji" class="text-sm leading-none">{{ countryEmoji }}</span>
              </span>
              <span v-if="!hqShort && countryEmoji" class="inline-flex items-center gap-1.5">
                <span v-html="icons.mapPin"></span>
                <span class="text-sm leading-none">{{ countryEmoji }}</span>
              </span>
              <span v-if="company.headcount" class="inline-flex items-center gap-1.5">
                <span v-html="icons.users"></span>
                <span class="tabular-nums">{{ Number(company.headcount).toLocaleString('fr-FR') }} emp.</span>
              </span>
              <span v-if="company.industry" class="inline-flex items-center gap-1.5">
                <span v-html="icons.building"></span>
                <span>{{ company.industry }}</span>
              </span>
            </div>
          </div>

          <!-- Actions right -->
          <div class="flex flex-col items-end gap-1 shrink-0">
            <div class="flex items-center gap-2">
              <ActionsMenu :company="company" />
              <button v-if="!pipedriveConfigured"
                      class="btn btn-secondary pipedrive-connect-cta"
                      @click="openPipedriveSettings"
                      title="Configurer la clé API Pipedrive dans les paramètres">
                <span v-html="icons.plug"></span>
                Connecter Pipedrive
              </button>
              <button v-else
                      class="btn btn-secondary"
                      :disabled="!canSync"
                      :title="syncTooltip"
                      @click="syncPipedrive">
                <span v-if="syncing"
                      class="inline-block w-4 h-4 border-2 border-ink-300 border-t-ink-800 rounded-full animate-spin"
                      aria-hidden="true"></span>
                <span v-else v-html="icons.arrowPath"></span>
                {{ syncing ? 'Synchronisation…' : 'Synchroniser Pipedrive' }}
              </button>
              <button class="btn btn-primary" @click="addContact">
                <span v-html="icons.plus"></span>
                Ajouter contact
              </button>
            </div>
            <div v-if="!pipedriveConfigured" class="text-[11px] text-ink-400">
              Aucune clé API connectée
            </div>
            <div v-else-if="lastSyncedRel" class="text-[11px] text-ink-400">
              Synchronisé il y a {{ lastSyncedRel }}
            </div>
            <div v-else-if="crmIdInt === null" class="text-[11px] text-ink-400">
              CRM_ID manquant — sync indisponible
            </div>
          </div>
        </div>
      </section>

      <!-- Zone B: attributs -->
      <section class="account-zone-b mt-3">
        <!-- Therapeutic areas row -->
        <div v-if="displayedAreas.length" class="flex items-start gap-3 mb-2.5 flex-wrap">
          <span class="text-[10.5px] uppercase tracking-wider text-ink-400 font-medium shrink-0 pt-[3px]">
            Aires thérapeutiques
          </span>
          <div class="flex items-center gap-1.5 flex-wrap">
            <span v-for="a in displayedAreas" :key="a" class="pill pill-monochrome">{{ a }}</span>
            <div v-if="overflowCount > 0" class="ta-overflow-wrap" ref="areasWrapRef">
              <button type="button"
                      class="pill pill-monochrome pill-overflow"
                      :aria-expanded="areasPopoverOpen ? 'true' : 'false'"
                      @click="toggleAreasPopover">
                +{{ overflowCount }}
              </button>
              <div v-if="areasPopoverOpen" class="ta-popover" role="menu">
                <span v-for="a in overflowAreas" :key="a" class="pill pill-monochrome">{{ a }}</span>
              </div>
            </div>
          </div>
        </div>

        <!-- Key-value meta row -->
        <div class="flex items-center gap-4 text-[12px] flex-wrap">
          <span class="inline-flex items-center">
            <span class="text-ink-400 font-medium">PIC</span>
            <span class="text-ink-800 ml-1">{{ company.pic || '—' }}</span>
          </span>
          <span class="text-ink-300">·</span>
          <span v-if="company.crm_status" class="inline-flex items-center">
            <span class="text-ink-400 font-medium">Statut CRM</span>
            <span class="chip-status-amber ml-1.5">{{ company.crm_status }}</span>
          </span>
          <template v-if="company.next_step">
            <span class="text-ink-300">·</span>
            <span class="inline-flex items-center min-w-0">
              <span class="text-ink-400 font-medium shrink-0">Next</span>
              <span class="text-ink-800 ml-1 truncate max-w-[260px]"
                    :title="company.next_step">
                {{ company.next_step }}
              </span>
            </span>
          </template>
          <span class="ml-auto text-ink-500 tabular-nums">
            {{ contactCount }} contact{{ contactCount > 1 ? 's' : '' }}
          </span>
        </div>
      </section>
    </header>
  `
};
