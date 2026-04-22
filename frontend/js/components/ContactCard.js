import { ref, computed } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, contactPassesFilters } from '../store.js';
import { icons } from '../icons.js';

function formatRelative(iso) {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Math.max(0, Date.now() - then);
  const min = Math.round(diff / 60000);
  if (min < 1) return 'à l\u2019instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  if (d < 30) return `il y a ${d} j`;
  const mo = Math.round(d / 30);
  return `il y a ${mo} mois`;
}

export default {
  name: 'ContactCard',
  props: {
    contact: { type: Object, required: true }
  },
  setup(props) {
    const confirming = ref(false);
    // Per-card sync state. Pipedrive "synced" status is derived from the
    // contact doc (pipedrive_person_id + pipedrive_synced_at), so it
    // survives re-renders and reloads without extra wiring.
    const pipedriveSyncing = ref(false);
    const pipedriveError = ref('');

    function catStyles(cat) {
      return {
        background: `var(--c-${cat}-bg)`,
        color: `var(--c-${cat})`
      };
    }
    function categoryLabel(cat) {
      return (cat || 'other').replace(/_/g, ' ');
    }
    function filteredOut() {
      return !contactPassesFilters(props.contact, store);
    }
    function openEdit() {
      if (confirming.value) return;
      store.modal = { type: 'contact-edit', payload: props.contact };
    }
    async function confirmDelete(e) {
      e?.stopPropagation?.();
      if (!confirming.value) {
        confirming.value = true;
        setTimeout(() => { confirming.value = false; }, 2500);
        return;
      }
      await store.deleteContact(props.contact._id);
      confirming.value = false;
    }
    function onEditClick(e) {
      e?.stopPropagation?.();
      openEdit();
    }
    function onLinkedInClick(e) {
      e?.stopPropagation?.();
    }

    /* ===== Pipedrive per-contact push ===== */

    const isSynced = computed(
      () => !!props.contact?.pipedrive_person_id
    );
    const syncedRel = computed(
      () => formatRelative(props.contact?.pipedrive_synced_at)
    );
    const pipedriveTooltip = computed(() => {
      if (pipedriveSyncing.value) return 'Synchronisation…';
      if (pipedriveError.value) return pipedriveError.value;
      if (isSynced.value) {
        return syncedRel.value
          ? `Synchronisé ${syncedRel.value} — cliquer pour re-sync`
          : 'Synchronisé avec Pipedrive — cliquer pour re-sync';
      }
      return 'Pousser vers Pipedrive';
    });

    async function onPipedriveClick(e) {
      e?.stopPropagation?.();
      if (pipedriveSyncing.value) return;
      pipedriveError.value = '';
      pipedriveSyncing.value = true;
      try {
        await store.syncContactToPipedrive(props.contact._id);
      } catch (err) {
        pipedriveError.value = err?.message || 'Échec';
      } finally {
        pipedriveSyncing.value = false;
      }
    }

    // Drag
    function onDragStart(ev) {
      ev.dataTransfer.effectAllowed = 'move';
      ev.dataTransfer.setData('text/plain', props.contact._id);
      ev.currentTarget.classList.add('dragging');
      // expose to store for DOM-less targets
      window.__draggedContact = {
        id: props.contact._id,
        level: props.contact.level,
        position: props.contact.position_in_level
      };
    }
    function onDragEnd(ev) {
      ev.currentTarget.classList.remove('dragging');
      window.__draggedContact = null;
    }

    // Map priority_score (0-100) → number of filled stars (0-5).
    // Buckets: 0 → 0★, 1-19 → 1★, 20-34 → 2★, 35-49 → 3★, 50-69 → 4★, 70+ → 5★.
    function starsFilled(score) {
      if (!Number.isFinite(score) || score <= 0) return 0;
      if (score < 20) return 1;
      if (score < 35) return 2;
      if (score < 50) return 3;
      if (score < 70) return 4;
      return 5;
    }

    /* Qualification → tiny coloured dot at the top-right of the card.
       Uses CSS variables declared globally; fallback to hard-coded hexes
       so a stylesheet omission never hides the indicator. */
    const QUAL_COLORS = {
      hot:      '#ef4444',  // red-500
      warm:     '#f59e0b',  // amber-500
      cold:     '#3b82f6',  // blue-500
      customer: '#10b981',  // emerald-500
      lost:     '#9ca3af'   // gray-400
    };
    const qualificationColor = computed(() => {
      const q = props.contact?.qualification;
      return q ? (QUAL_COLORS[q] || null) : null;
    });
    const qualificationLabel = computed(() => {
      const q = props.contact?.qualification;
      if (!q) return '';
      return q.charAt(0).toUpperCase() + q.slice(1);
    });

    /* Labels tooltip — rendered through the card's `title` attribute so the
       browser handles the tooltip UX natively. We also expose a computed
       boolean so the template can skip the attribute when empty. */
    const labelsList = computed(() => {
      const arr = props.contact?.labels;
      return Array.isArray(arr) ? arr.filter(Boolean) : [];
    });
    const cardTooltip = computed(() => {
      const parts = [];
      if (qualificationLabel.value) parts.push(qualificationLabel.value);
      if (labelsList.value.length) parts.push('Labels: ' + labelsList.value.join(', '));
      return parts.length ? parts.join(' • ') : '';
    });

    return {
      store, confirming, catStyles, categoryLabel, filteredOut,
      openEdit, onEditClick, confirmDelete, onLinkedInClick,
      onDragStart, onDragEnd, icons, starsFilled,
      pipedriveSyncing, pipedriveError, isSynced,
      pipedriveTooltip, onPipedriveClick,
      qualificationColor, qualificationLabel, labelsList, cardTooltip
    };
  },
  template: `
    <div class="contact-card"
         :class="{ techtomed: contact.is_techtomed, 'filtered-out': filteredOut() }"
         draggable="true"
         @dragstart="onDragStart"
         @dragend="onDragEnd"
         @click="openEdit"
         :title="cardTooltip || null"
         :data-contact-id="contact._id"
         :data-level="contact.level">

      <div v-if="contact.is_techtomed" class="tt-ribbon">★ TechToMed</div>

      <span v-if="qualificationColor"
            class="qualification-dot"
            :style="{ background: qualificationColor }"
            :title="qualificationLabel"
            aria-hidden="true"></span>

      <div class="flex items-start justify-between gap-2">
        <div class="card-name" :title="contact.name">{{ contact.name }}</div>
        <div class="card-actions">
          <a v-if="contact.linkedin_url" :href="contact.linkedin_url"
             target="_blank" rel="noopener"
             @click="onLinkedInClick"
             class="card-action-btn" title="LinkedIn">
            <span v-html="icons.linkedin"></span>
          </a>
          <button type="button"
                  class="card-action-btn pipedrive-btn"
                  :class="{
                    'is-synced': isSynced && !pipedriveError,
                    'is-error': !!pipedriveError,
                    'is-idle': !isSynced && !pipedriveError
                  }"
                  :disabled="pipedriveSyncing"
                  :title="pipedriveTooltip"
                  :aria-label="pipedriveTooltip"
                  @click="onPipedriveClick">
            <span v-if="pipedriveSyncing"
                  class="inline-block w-4 h-4 border-2 border-ink-300 border-t-ink-800 rounded-full animate-spin"
                  aria-hidden="true"></span>
            <span v-else v-html="icons.pipedrive"></span>
          </button>
          <button class="card-action-btn" title="Éditer" @click="onEditClick">
            <span v-html="icons.pencil"></span>
          </button>
          <button class="card-action-btn danger"
                  :title="confirming ? 'Confirmer la suppression' : 'Supprimer'"
                  @click="confirmDelete">
            <span v-if="!confirming" v-html="icons.trash"></span>
            <span v-else class="text-[10px] font-semibold text-red-600">OK?</span>
          </button>
        </div>
      </div>

      <div class="card-title" :title="contact.title">{{ contact.title || '—' }}</div>

      <div class="flex items-center justify-between gap-2 mt-auto">
        <span class="cat-pill" :style="catStyles(contact.category || 'other')">
          <span class="cat-dot" :style="{ background: 'var(--c-' + (contact.category || 'other') + ')' }"></span>
          {{ categoryLabel(contact.category) }}
        </span>
        <span v-if="Number.isFinite(contact.priority_score)"
              class="priority-stars"
              :title="'Score ICP muchbetter.ai: ' + contact.priority_score + '/100'"
              aria-label="Score ICP">
          <svg v-for="i in 5" :key="i"
               viewBox="0 0 20 20"
               class="priority-star"
               :class="{ filled: i <= starsFilled(contact.priority_score) }"
               width="10" height="10"
               aria-hidden="true">
            <path d="M10 1.5l2.59 5.25 5.79.84-4.19 4.09.99 5.77L10 14.73l-5.18 2.72.99-5.77L1.62 7.59l5.79-.84L10 1.5z"/>
          </svg>
        </span>
      </div>

      <div v-if="contact.location" class="text-[10.5px] text-ink-400 truncate">
        {{ contact.location }}
      </div>
    </div>
  `
};
