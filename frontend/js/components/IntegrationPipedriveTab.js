// IntegrationPipedriveTab.js — Détail Pipedrive (wireframe §3.4).
// Reprend le contenu actuel de la section "Intégrations" de Settings.js,
// en propre. Scope = team courante.
//
// V4 ajoute une section "Mapping des champs" (collapsible) qui :
//  - affiche chaque champ interne connu (linkedin_url, catégorie, …)
//  - laisse l'utilisateur le brancher à un champ Pipedrive (standard ou
//    custom) via un <select> pré-rempli par l'auto-détection
//  - permet de forcer une re-détection ou de sauvegarder un mapping manuel
//
// L'état local `mapping` est un clone éditable de la réponse serveur.
// On ne PATCH qu'au clic "Sauvegarder" pour garder un flux prévisible.
import { ref, reactive, computed, onMounted, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import * as api from '../api.js';
import { icons } from '../icons.js';

// Labels FR alignés avec le backend (`FIELD_LABELS_FR` dans
// routes/pipedrive.py). Gardés ici en plus pour éviter un round-trip
// supplémentaire — si un champ n'est pas trouvé, on retombe sur la clé.
const OUR_FIELD_LABELS = {
  linkedin_url: 'LinkedIn URL',
  headline: 'Headline LinkedIn',
  category: 'Catégorie',
  seniority: 'Séniorité / Hiérarchie',
  source: 'Source / Provenance',
  qualification: 'Statut du lead',
  title: 'Intitulé du poste (custom)',
  school: 'École',
  persona: 'Persona',
  comments: 'Commentaires',
  relation: 'Relation',
  sales_navigator_url: 'Sales Navigator URL',
  initiatives: 'Initiatives',
  language: 'Langue',
  gender: 'Genre',
  newsletter: 'Newsletter'
};

export default {
  name: 'IntegrationPipedriveTab',
  setup() {
    const pipedrive = reactive({
      loading: false,
      configured: false,
      user: null,
      error: '',
      companyDomain: '',
      connectedAt: null,
      source: null, // "db" | "env"
      apiKeyInput: '',
      connecting: false,
      connectError: '',
      disconnecting: false
    });

    // ---- Mapping state ----
    // `mapping` is the *editable* copy bound to <select>s. `savedMapping`
    // is what the server last confirmed — used to show a dirty badge and
    // to disable the "Sauvegarder" button when nothing changed.
    const mappingState = reactive({
      loading: false,
      saving: false,
      refreshing: false,
      open: false,
      error: '',
      fields: [],                 // Pipedrive field catalog
      availableOurFields: [],     // whitelist (rendering order)
      autoDetected: [],           // keys auto-filled by heuristic
      mapping: {},                // editable { our_key: pd_key | '' }
      savedMapping: {},           // last confirmed from the server
      cachedAt: null
    });

    // Build an editable dict with an entry for every `our_key` — Vue's
    // `v-model` on <select> needs the key to exist upfront, otherwise
    // changing the select wouldn't propagate to the reactive proxy.
    function _hydrateMapping(resp) {
      const serverMap = resp?.mapping || {};
      const keys = Array.isArray(resp?.available_our_fields)
        ? resp.available_our_fields
        : [];
      const editable = {};
      for (const k of keys) editable[k] = serverMap[k] || '';
      return { editable, saved: { ...serverMap } };
    }

    async function loadMapping() {
      const slug = store.currentTeam?.slug;
      if (!slug || !pipedrive.configured) {
        // Don't try if the integration isn't wired — keep the panel quiet.
        return;
      }
      mappingState.loading = true;
      mappingState.error = '';
      try {
        const resp = await api.pipedriveListFields(slug);
        mappingState.fields = Array.isArray(resp?.fields) ? resp.fields : [];
        mappingState.availableOurFields = Array.isArray(resp?.available_our_fields)
          ? resp.available_our_fields
          : [];
        mappingState.autoDetected = Array.isArray(resp?.auto_detected)
          ? resp.auto_detected
          : [];
        const h = _hydrateMapping(resp);
        mappingState.mapping = h.editable;
        mappingState.savedMapping = h.saved;
        mappingState.cachedAt = resp?.cached_at || null;
      } catch (e) {
        mappingState.error = e?.message || 'Impossible de charger le mapping';
      } finally {
        mappingState.loading = false;
      }
    }

    async function refreshMapping() {
      const slug = store.currentTeam?.slug;
      if (!slug) return;
      mappingState.refreshing = true;
      mappingState.error = '';
      try {
        const resp = await api.pipedriveRefreshFields(slug);
        mappingState.fields = Array.isArray(resp?.fields) ? resp.fields : [];
        mappingState.availableOurFields = Array.isArray(resp?.available_our_fields)
          ? resp.available_our_fields
          : [];
        mappingState.autoDetected = Array.isArray(resp?.auto_detected)
          ? resp.auto_detected
          : [];
        const h = _hydrateMapping(resp);
        mappingState.mapping = h.editable;
        mappingState.savedMapping = h.saved;
        mappingState.cachedAt = resp?.cached_at || null;
        store.toast('Schéma Pipedrive re-détecté', 'success');
      } catch (e) {
        mappingState.error = e?.message || 'Échec de la détection';
      } finally {
        mappingState.refreshing = false;
      }
    }

    async function saveMapping() {
      const slug = store.currentTeam?.slug;
      if (!slug) return;
      mappingState.saving = true;
      mappingState.error = '';
      // Strip empty values so "— Non mappé —" sends nothing (the server
      // also strips, but being explicit keeps the payload small + clear).
      const payload = {};
      for (const k of Object.keys(mappingState.mapping || {})) {
        const v = (mappingState.mapping[k] || '').trim();
        if (v) payload[k] = v;
      }
      try {
        const resp = await api.pipedriveUpdateMapping(slug, payload);
        const h = _hydrateMapping({
          ...resp,
          // Preserve the whitelist ordering we already know — the PATCH
          // response echoes it but we'd fall back gracefully regardless.
          available_our_fields: resp?.available_our_fields
            || mappingState.availableOurFields
        });
        mappingState.mapping = h.editable;
        mappingState.savedMapping = h.saved;
        // After a manual save the server zeroes `auto_detected` — the
        // badges disappear, which is the right signal.
        mappingState.autoDetected = Array.isArray(resp?.auto_detected)
          ? resp.auto_detected
          : [];
        store.toast('Mapping sauvegardé', 'success');
      } catch (e) {
        mappingState.error = e?.message || 'Échec de la sauvegarde';
      } finally {
        mappingState.saving = false;
      }
    }

    // Writable fields first in the <select> — filters out Pipedrive
    // system fields (added_by, update_time, …) that can't be written.
    const writableFields = computed(() =>
      (mappingState.fields || []).filter(f => f.editable !== false)
    );

    // True if the user has touched the mapping since the last save.
    const mappingDirty = computed(() => {
      const a = mappingState.mapping || {};
      const b = mappingState.savedMapping || {};
      const ak = Object.keys(a).filter(k => (a[k] || '').trim());
      const bk = Object.keys(b).filter(k => (b[k] || '').trim());
      if (ak.length !== bk.length) return true;
      for (const k of ak) if ((a[k] || '') !== (b[k] || '')) return true;
      return false;
    });

    async function loadStatus() {
      const slug = store.currentTeam?.slug;
      if (!slug) {
        pipedrive.configured = false; pipedrive.user = null; pipedrive.error = '';
        pipedrive.companyDomain = ''; pipedrive.connectedAt = null; pipedrive.source = null;
        return;
      }
      pipedrive.loading = true;
      try {
        const s = await api.pipedriveStatus(slug);
        pipedrive.configured = !!s?.configured;
        pipedrive.user = s?.user || null;
        pipedrive.error = s?.error || '';
        pipedrive.companyDomain = s?.company_domain || s?.user?.company_domain || '';
        pipedrive.connectedAt = s?.connected_at || null;
        pipedrive.source = s?.source || null;
      } catch (e) {
        pipedrive.configured = false;
        pipedrive.user = null;
        pipedrive.error = e?.message || 'Statut indisponible';
      } finally {
        pipedrive.loading = false;
      }
    }

    async function connectPipedrive() {
      const slug = store.currentTeam?.slug;
      const key = (pipedrive.apiKeyInput || '').trim();
      if (!slug) return;
      if (!key) { pipedrive.connectError = 'Colle ta clé API Pipedrive'; return; }
      pipedrive.connecting = true; pipedrive.connectError = '';
      try {
        await api.connectPipedrive(slug, { api_key: key });
        pipedrive.apiKeyInput = '';
        await loadStatus();
        // Once connected, automatically fetch + auto-map the Pipedrive field
        // schema and reveal the mapping section so the admin sees the full
        // wiring in one shot (no "click around to finish configuring").
        if (pipedrive.configured) {
          mappingState.open = true;
          try { await refreshMapping(); } catch (e) { /* non-fatal */ }
          store.toast('Pipedrive connecté — champs détectés automatiquement', 'success');
        } else {
          store.toast('Pipedrive connecté', 'success');
        }
      } catch (e) {
        pipedrive.connectError = e?.message || 'Échec connexion Pipedrive';
      } finally {
        pipedrive.connecting = false;
      }
    }

    async function disconnectPipedrive() {
      const slug = store.currentTeam?.slug;
      if (!slug) return;
      if (pipedrive.source === 'env') {
        store.toast('La clé vient de la variable d\u2019environnement — impossible de la retirer ici.', 'info');
        return;
      }
      if (!confirm('Déconnecter Pipedrive de cette équipe ?')) return;
      pipedrive.disconnecting = true;
      try {
        await api.disconnectPipedrive(slug);
        store.toast('Pipedrive déconnecté', 'success');
        await loadStatus();
      } catch (e) {
        store.toast(e?.message || 'Échec déconnexion', 'error');
      } finally {
        pipedrive.disconnecting = false;
      }
    }

    const helpUrl = computed(() => {
      const d = (pipedrive.companyDomain || '').trim();
      if (d) return `https://${d}.pipedrive.com/settings/api`;
      return 'https://pipedrive.readme.io/docs/how-to-find-the-api-token';
    });

    const connectedDate = computed(() => {
      const iso = pipedrive.connectedAt;
      if (!iso) return '';
      try {
        return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
      } catch (e) { return ''; }
    });

    onMounted(async () => {
      await loadStatus();
      if (pipedrive.configured) await loadMapping();
    });
    watch(() => store.currentTeam?.slug, async () => {
      await loadStatus();
      if (pipedrive.configured) await loadMapping();
    });
    // When the user (re-)connects, `configured` flips true — load mapping
    // lazily so the admin lands on a populated table after connect.
    watch(() => pipedrive.configured, async (v) => {
      if (v) await loadMapping();
    });

    function labelFor(ourKey) {
      return OUR_FIELD_LABELS[ourKey] || ourKey;
    }

    // Collapsible toggle — lazy-load the mapping on first open so we don't
    // hit Pipedrive for users who never open the panel.
    function toggleMapping() {
      mappingState.open = !mappingState.open;
      if (mappingState.open && !mappingState.fields.length) loadMapping();
    }

    return {
      store, icons, pipedrive, helpUrl, connectedDate,
      connectPipedrive, disconnectPipedrive, loadStatus,
      // Mapping UI surface:
      mappingState, writableFields, mappingDirty,
      loadMapping, refreshMapping, saveMapping, labelFor, toggleMapping
    };
  },
  template: `
    <div style="max-width:768px">
      <!-- Breadcrumb -->
      <div class="text-[12px] text-ink-500 mb-3">
        <a href="#/settings/profile" class="hover:text-ink-900">Paramètres</a>
        <span class="mx-1 text-ink-300">/</span>
        <a href="#/settings/integrations" class="hover:text-ink-900">Intégrations</a>
        <span class="mx-1 text-ink-300">/</span>
        <span class="text-ink-900">Pipedrive</span>
      </div>

      <!-- Header -->
      <div class="flex items-start gap-3 mb-5">
        <div class="shrink-0 integration-header-logo" v-html="icons.pipedriveColored"></div>
        <div class="flex-1">
          <div class="flex items-center gap-2 flex-wrap">
            <div class="text-[17px] font-semibold">Pipedrive</div>
            <span v-if="pipedrive.configured" class="integration-status-row">
              <span class="status-dot status-green"></span>
              <span class="text-[11.5px] text-ink-500">Connecté</span>
            </span>
            <span v-else class="integration-status-row">
              <span class="status-dot status-grey"></span>
              <span class="text-[11.5px] text-ink-500">Non configuré</span>
            </span>
          </div>
          <p class="text-[12.5px] text-ink-500 mt-0.5">Synchro de comptes et contacts</p>
        </div>
        <button class="btn btn-ghost !px-2 !py-1 !text-[11px] shrink-0"
                :disabled="pipedrive.loading"
                @click="loadStatus"
                title="Rafraîchir le statut">
          <span v-html="icons.arrowPath"></span>
        </button>
      </div>

      <!-- Connected state -->
      <section v-if="pipedrive.configured" class="settings-card" style="background:#ECFDF5; border-color:#10B981;">
        <div class="flex items-start gap-3">
          <span class="shrink-0" style="color:#10B981" v-html="icons.check"></span>
          <div class="flex-1 min-w-0">
            <h2 class="settings-card-title !text-emerald-900 !mb-3">Compte connecté</h2>
            <div class="grid grid-cols-2 gap-x-4 gap-y-2 text-[12.5px]">
              <div class="text-emerald-900/70">Domaine</div>
              <div class="font-mono text-emerald-900">
                {{ pipedrive.companyDomain || pipedrive.user?.company_domain || '—' }}<span v-if="pipedrive.companyDomain || pipedrive.user?.company_domain">.pipedrive.com</span>
              </div>
              <div class="text-emerald-900/70">Utilisateur</div>
              <div class="text-emerald-900">{{ pipedrive.user?.name || '—' }}</div>
              <div class="text-emerald-900/70">Connecté le</div>
              <div class="text-emerald-900">{{ connectedDate || '—' }}</div>
              <div class="text-emerald-900/70">Source</div>
              <div class="text-emerald-900">
                <span v-if="pipedrive.source === 'env'">Variable d\u2019environnement</span>
                <span v-else>Clé API team</span>
              </div>
            </div>
            <div class="mt-4 flex items-center gap-2">
              <button v-if="store.isAdmin()"
                      class="btn btn-secondary !text-[12px]"
                      :disabled="pipedrive.disconnecting || pipedrive.source === 'env'"
                      :title="pipedrive.source === 'env' ? 'Configuré via variable d\u2019environnement' : 'Déconnecter Pipedrive'"
                      @click="disconnectPipedrive">
                {{ pipedrive.disconnecting ? 'Déconnexion…' : 'Déconnecter' }}
              </button>
              <span v-if="pipedrive.source === 'env'" class="text-[11px] text-emerald-900/70 italic">
                Configuré via variable d\u2019environnement
              </span>
            </div>
          </div>
        </div>
      </section>

      <!-- Mapping des champs custom Pipedrive (collapsible) -->
      <section v-if="pipedrive.configured" class="settings-card mt-4">
        <button type="button"
                class="w-full flex items-center justify-between text-left"
                @click="toggleMapping">
          <div>
            <h2 class="settings-card-title !mb-0">Mapping des champs</h2>
            <p class="text-[12px] text-ink-500 mt-0.5">
              Branche tes champs internes sur tes champs Pipedrive (custom ou standard).
              Les valeurs non mappées continuent d'aller dans les notes.
            </p>
          </div>
          <span class="text-ink-500 text-[12px] shrink-0 ml-3">
            {{ mappingState.open ? '▾' : '▸' }}
          </span>
        </button>

        <div v-if="mappingState.open" class="mt-4">
          <div v-if="mappingState.loading" class="text-[12px] text-ink-500">
            Chargement du schéma Pipedrive…
          </div>
          <div v-else-if="mappingState.error"
               class="text-[11.5px] px-2 py-1 rounded mb-3"
               style="background:#FEF2F2; color:#B91C1C; border:1px solid #FECACA">
            {{ mappingState.error }}
          </div>
          <template v-else>
            <!-- Header row w/ counters + actions -->
            <div class="flex items-center justify-between mb-3 gap-2 flex-wrap">
              <div class="text-[11.5px] text-ink-500">
                {{ mappingState.fields.length }} champs Pipedrive disponibles —
                <span v-if="mappingState.autoDetected.length">
                  {{ mappingState.autoDetected.length }} auto-détecté(s)
                </span>
                <span v-else>mapping manuel</span>
              </div>
              <div class="flex items-center gap-2">
                <button v-if="store.isAdmin()"
                        type="button"
                        class="btn btn-ghost !text-[11.5px]"
                        :disabled="mappingState.refreshing"
                        @click="refreshMapping"
                        title="Ré-interroge Pipedrive et remplit les champs non mappés">
                  {{ mappingState.refreshing ? 'Détection…' : 'Re-détecter automatiquement' }}
                </button>
                <button v-if="store.isAdmin()"
                        type="button"
                        class="btn btn-primary !text-[11.5px]"
                        :disabled="mappingState.saving || !mappingDirty"
                        @click="saveMapping">
                  {{ mappingState.saving ? 'Sauvegarde…' : 'Sauvegarder le mapping' }}
                </button>
              </div>
            </div>

            <div v-if="!store.isAdmin()" class="text-[11.5px] text-ink-500 italic mb-3">
              Lecture seule — un admin de l'équipe peut modifier le mapping.
            </div>

            <!-- 2-col table: our field → Pipedrive select -->
            <div class="border border-ink-100 rounded divide-y divide-ink-100">
              <div v-for="ourKey in mappingState.availableOurFields"
                   :key="ourKey"
                   class="grid grid-cols-2 gap-3 items-center px-3 py-2">
                <div class="text-[12.5px]">
                  <span class="font-medium">{{ labelFor(ourKey) }}</span>
                  <span v-if="mappingState.autoDetected.includes(ourKey)"
                        class="ml-2 text-[10px] px-1.5 py-0.5 rounded"
                        style="background:#ECFDF5; color:#065F46; border:1px solid #A7F3D0"
                        title="Mappé automatiquement via la détection par nom">
                    Auto-détecté
                  </span>
                  <div class="text-[10.5px] text-ink-500 font-mono">{{ ourKey }}</div>
                </div>
                <select class="input !text-[12px]"
                        :disabled="!store.isAdmin()"
                        v-model="mappingState.mapping[ourKey]">
                  <option value="">— Non mappé —</option>
                  <option v-for="f in writableFields"
                          :key="f.key"
                          :value="f.key">
                    {{ f.name }}<span v-if="f.field_type"> ({{ f.field_type }})</span>
                  </option>
                </select>
              </div>
            </div>

            <p class="text-[10.5px] text-ink-400 mt-2">
              Astuce : les champs Pipedrive en lecture seule (système) sont exclus de la liste.
              Les champs non mappés restent dans les notes Pipedrive.
            </p>
          </template>
        </div>
      </section>

      <!-- Disconnected state -->
      <section v-else class="settings-card">
        <h2 class="settings-card-title">Connecter Pipedrive</h2>
        <div v-if="!store.isAdmin()" class="text-[12px] text-ink-500">
          Demande à un admin de connecter Pipedrive pour cette équipe.
        </div>
        <template v-else>
          <!-- 3-step guide, always visible. -->
          <ol class="pipedrive-setup-steps">
            <li>
              <span class="pipedrive-step-num">1</span>
              <div>
                <div class="pipedrive-step-title">Ouvre les paramètres API Pipedrive</div>
                <a :href="helpUrl" target="_blank" rel="noopener"
                   class="pipedrive-step-link">
                  Ouvrir Pipedrive → Personal preferences → API
                  <span v-html="icons.external"></span>
                </a>
              </div>
            </li>
            <li>
              <span class="pipedrive-step-num">2</span>
              <div>
                <div class="pipedrive-step-title">Copie ta clé API personnelle</div>
                <div class="pipedrive-step-hint">
                  Chaîne alphanumérique de 40 caractères. Une clé par utilisateur —
                  elle reste chez toi, on ne la partage jamais côté client.
                </div>
              </div>
            </li>
            <li>
              <span class="pipedrive-step-num">3</span>
              <div>
                <div class="pipedrive-step-title">Colle-la ici</div>
                <form @submit.prevent="connectPipedrive" class="space-y-2 mt-1.5">
                  <input class="input font-mono"
                         type="password"
                         autocomplete="off"
                         v-model="pipedrive.apiKeyInput"
                         placeholder="••••••••••••••••••••••••••••••••••••••••" />
                  <div v-if="pipedrive.connectError"
                       class="text-[11.5px] px-2 py-1 rounded"
                       style="background:#FEF2F2; color:#B91C1C; border:1px solid #FECACA">
                    {{ pipedrive.connectError }}
                  </div>
                  <div class="flex items-center justify-end">
                    <button type="submit" class="btn btn-primary"
                            :disabled="pipedrive.connecting || !pipedrive.apiKeyInput.trim()">
                      {{ pipedrive.connecting ? 'Test en cours…' : 'Tester et connecter' }}
                    </button>
                  </div>
                </form>
              </div>
            </li>
          </ol>
          <p class="text-[11px] text-ink-400 mt-3">
            Au clic, on teste la clé, on récupère ton nom d'utilisateur,
            puis on auto-mappe tes champs custom Pipedrive. Tu n'as rien d'autre à faire.
          </p>
        </template>
      </section>
    </div>
  `
};
