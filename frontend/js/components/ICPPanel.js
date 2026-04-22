// ICPPanel.js — right-side drawer for team-scoped ICP roles + synonyms.
//
// Two stacked sections:
//   1. Permanent ICPs (team.settings.icps) — apply across ALL accounts
//   2. Account-specific ICPs (company.icps) — apply only to the active company
//
// Both sections use the same card layout (emoji + name + chip list). The
// chip list collapses to the first 5 chips with a "+N de plus" toggle to
// avoid clutter when ICPs have many synonyms.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import { icons } from '../icons.js';

const EMOJI_PALETTE = [
  '👤','💼','📚','🧪','💊','🩺','⚕️','🧑‍⚕️','🧑‍💼','🧑‍🏫',
  '🏭','🧬','💡','📊','📈','🎯','🗂️','🧠','🛠️','💰',
  '⚖️','🛡️','🔬','🌍','🚀','✨','🔑','🏛️','📦','🏢'
];

const CHIPS_COLLAPSED_COUNT = 5;
const CHIP_EXPANDED_STORAGE_KEY = 'icp_chips_expanded_v1';

function makeIcpId() {
  return Math.random().toString(36).slice(2, 10);
}

function readExpanded() {
  try {
    const raw = localStorage.getItem(CHIP_EXPANDED_STORAGE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch (e) { return new Set(); }
}
function writeExpanded(set) {
  try { localStorage.setItem(CHIP_EXPANDED_STORAGE_KEY, JSON.stringify([...set])); } catch (e) {}
}

export default {
  name: 'ICPPanel',
  setup() {
    const open = computed(() => store.icpDrawerOpen);
    // Editable drafts: two lists (permanent = team; account = company).
    const teamDrafts = ref([]);
    const compDrafts = ref([]);
    const saving = ref(false);
    let saveTimerTeam = null;
    let saveTimerComp = null;

    const emojiPickerFor = ref(null);
    const expandedChips = ref(readExpanded());

    const activeCompanyName = computed(() => store.activeCompany?.name || '');

    function syncFromStore() {
      teamDrafts.value = (store.teamICPs || []).map(icp => ({
        id: icp.id || makeIcpId(),
        name: icp.name || '',
        emoji: icp.emoji || '👤',
        synonyms: [...(icp.synonyms || [])],
        _chipInput: '',
        _scope: 'team',
      }));
      compDrafts.value = (store.activeCompany?.icps || []).map(icp => ({
        id: icp.id || makeIcpId(),
        name: icp.name || '',
        emoji: icp.emoji || '👤',
        synonyms: [...(icp.synonyms || [])],
        _chipInput: '',
        _scope: 'company',
      }));
    }

    watch(open, (o) => { if (o) syncFromStore(); });
    // Also re-sync when the active company changes while the drawer is open.
    watch(() => store.activeCompany?.slug, () => {
      if (open.value) syncFromStore();
    });
    onMounted(syncFromStore);

    function scheduleSave(scope) {
      if (scope === 'team') {
        if (saveTimerTeam) clearTimeout(saveTimerTeam);
        saveTimerTeam = setTimeout(() => flushSave('team'), 600);
      } else {
        if (saveTimerComp) clearTimeout(saveTimerComp);
        saveTimerComp = setTimeout(() => flushSave('company'), 600);
      }
    }

    async function flushSave(scope) {
      saving.value = true;
      try {
        if (scope === 'team') {
          const payload = teamDrafts.value
            .filter(d => (d.name || '').trim())
            .map(d => ({ id: d.id, name: d.name.trim(), emoji: d.emoji || '👤', synonyms: d.synonyms }));
          await store.saveTeamICPs(payload);
        } else {
          const payload = compDrafts.value
            .filter(d => (d.name || '').trim())
            .map(d => ({ id: d.id, name: d.name.trim(), emoji: d.emoji || '👤', synonyms: d.synonyms }));
          await store.saveCompanyICPs(payload);
        }
      } catch (e) {
        console.error('[ICPPanel] save failed', e);
        alert('Impossible de sauvegarder: ' + (e?.message || e));
      } finally {
        saving.value = false;
      }
    }

    function _draftsForScope(scope) {
      return scope === 'team' ? teamDrafts.value : compDrafts.value;
    }

    function addICP(scope) {
      const arr = _draftsForScope(scope);
      arr.push({
        id: makeIcpId(),
        name: scope === 'team' ? 'Nouvel ICP' : `Nouvel ICP (${activeCompanyName.value || 'compte'})`,
        emoji: '👤',
        synonyms: [],
        _chipInput: '',
        _scope: scope,
      });
      scheduleSave(scope);
    }

    function removeICP(scope, id) {
      if (scope === 'team') {
        teamDrafts.value = teamDrafts.value.filter(d => d.id !== id);
      } else {
        compDrafts.value = compDrafts.value.filter(d => d.id !== id);
      }
      scheduleSave(scope);
    }

    function addSynonym(draft) {
      const v = (draft._chipInput || '').trim();
      if (!v) return;
      const parts = v.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!draft.synonyms.includes(p)) draft.synonyms.push(p);
      }
      draft._chipInput = '';
      // Auto-expand so the user sees the chip land.
      if (!expandedChips.value.has(draft.id)) {
        expandedChips.value.add(draft.id);
        writeExpanded(expandedChips.value);
      }
      scheduleSave(draft._scope);
    }

    function removeSynonym(draft, idx) {
      draft.synonyms.splice(idx, 1);
      scheduleSave(draft._scope);
    }

    function onChipKeydown(draft, ev) {
      if (ev.key === 'Enter' || ev.key === ',') {
        ev.preventDefault();
        addSynonym(draft);
      } else if (ev.key === 'Backspace' && !draft._chipInput && draft.synonyms.length) {
        draft.synonyms.pop();
        scheduleSave(draft._scope);
      }
    }

    function openEmojiPicker(draft) { emojiPickerFor.value = draft.id; }
    function pickEmoji(draft, emo) {
      draft.emoji = emo;
      emojiPickerFor.value = null;
      scheduleSave(draft._scope);
    }

    function onNameInput(draft) { scheduleSave(draft._scope); }
    function onNameBlur(draft) {
      if (draft._scope === 'team' && saveTimerTeam) { clearTimeout(saveTimerTeam); saveTimerTeam = null; }
      if (draft._scope === 'company' && saveTimerComp) { clearTimeout(saveTimerComp); saveTimerComp = null; }
      flushSave(draft._scope);
    }

    function isExpanded(id) { return expandedChips.value.has(id); }
    function toggleExpanded(id) {
      if (expandedChips.value.has(id)) expandedChips.value.delete(id);
      else expandedChips.value.add(id);
      expandedChips.value = new Set(expandedChips.value);
      writeExpanded(expandedChips.value);
    }

    function visibleChips(draft) {
      if (isExpanded(draft.id)) return draft.synonyms;
      return draft.synonyms.slice(0, CHIPS_COLLAPSED_COUNT);
    }

    function close() { store.closeICPDrawer(); }
    function onOverlayClick() { close(); }
    function onDrawerClick(ev) { ev.stopPropagation(); }

    function onEsc(ev) {
      if (ev.key === 'Escape' && open.value) {
        if (emojiPickerFor.value) { emojiPickerFor.value = null; return; }
        close();
      }
    }
    onMounted(() => document.addEventListener('keydown', onEsc));
    onBeforeUnmount(() => document.removeEventListener('keydown', onEsc));

    return {
      open, teamDrafts, compDrafts, saving,
      activeCompanyName,
      emojiPickerFor, EMOJI_PALETTE, icons,
      CHIPS_COLLAPSED_COUNT,
      addICP, removeICP,
      addSynonym, removeSynonym, onChipKeydown,
      openEmojiPicker, pickEmoji,
      onNameInput, onNameBlur,
      isExpanded, toggleExpanded, visibleChips,
      close, onOverlayClick, onDrawerClick,
    };
  },
  template: `
    <transition name="icp-drawer">
      <div v-if="open" class="icp-drawer-overlay" @click="onOverlayClick">
        <aside class="icp-drawer" @click="onDrawerClick" role="dialog" aria-label="ICPs de l'équipe">
          <header class="icp-drawer-header">
            <div>
              <h2>ICPs</h2>
              <p>Les contacts dont le titre matche un synonyme sont étoilés ⭐ et comptent dans le badge ICP du compte.</p>
            </div>
            <button class="icp-drawer-close" @click="close" aria-label="Fermer">×</button>
          </header>

          <div class="icp-drawer-body">
            <!-- SECTION 1: PERMANENT (team-scoped) -->
            <section class="icp-section">
              <div class="icp-section-head">
                <div>
                  <div class="icp-section-title">ICPs permanents</div>
                  <div class="icp-section-sub">Partagés avec l'équipe, appliqués à tous les comptes.</div>
                </div>
              </div>

              <div v-for="d in teamDrafts" :key="d.id" class="icp-card">
                <div class="icp-card-head">
                  <button type="button" class="icp-emoji-btn" @click="openEmojiPicker(d)" aria-label="Changer l&apos;emoji">{{ d.emoji }}</button>
                  <input type="text" class="icp-name-input" v-model="d.name"
                         placeholder="Nom de l'ICP"
                         @input="onNameInput(d)" @blur="onNameBlur(d)" />
                  <button type="button" class="icp-card-del" @click="removeICP('team', d.id)" title="Supprimer" aria-label="Supprimer">
                    <span v-html="icons.trash"></span>
                  </button>
                </div>
                <div class="icp-chipfield">
                  <span v-for="(s, i) in visibleChips(d)" :key="s + '-' + i" class="icp-chip">
                    {{ s }}
                    <button type="button" class="icp-chip-x" @click="removeSynonym(d, i)" aria-label="Supprimer">×</button>
                  </span>
                  <button v-if="d.synonyms.length > CHIPS_COLLAPSED_COUNT"
                          type="button"
                          class="icp-chip-more"
                          @click="toggleExpanded(d.id)">
                    {{ isExpanded(d.id) ? 'Réduire' : '+' + (d.synonyms.length - CHIPS_COLLAPSED_COUNT) + ' de plus' }}
                  </button>
                  <input type="text" class="icp-chip-input" v-model="d._chipInput"
                         :placeholder="d.synonyms.length ? '+ synonyme…' : 'Ajoute un synonyme (Entrée)'"
                         @keydown="onChipKeydown(d, $event)"
                         @blur="addSynonym(d)" />
                </div>
                <div v-if="emojiPickerFor === d.id" class="icp-emoji-pop">
                  <button v-for="e in EMOJI_PALETTE" :key="e" class="icp-emoji-choice" @click="pickEmoji(d, e)">{{ e }}</button>
                </div>
              </div>

              <button class="icp-add-btn" @click="addICP('team')">
                + Nouvel ICP permanent
              </button>
            </section>

            <!-- SECTION 2: ACCOUNT-SPECIFIC -->
            <section v-if="activeCompanyName" class="icp-section icp-section-company">
              <div class="icp-section-head">
                <div>
                  <div class="icp-section-title">ICPs pour {{ activeCompanyName }}</div>
                  <div class="icp-section-sub">Spécifiques à ce compte, visibles uniquement ici.</div>
                </div>
              </div>

              <div v-for="d in compDrafts" :key="d.id" class="icp-card icp-card-company">
                <div class="icp-card-head">
                  <button type="button" class="icp-emoji-btn" @click="openEmojiPicker(d)" aria-label="Changer l&apos;emoji">{{ d.emoji }}</button>
                  <input type="text" class="icp-name-input" v-model="d.name"
                         placeholder="Nom de l'ICP"
                         @input="onNameInput(d)" @blur="onNameBlur(d)" />
                  <button type="button" class="icp-card-del" @click="removeICP('company', d.id)" title="Supprimer" aria-label="Supprimer">
                    <span v-html="icons.trash"></span>
                  </button>
                </div>
                <div class="icp-chipfield">
                  <span v-for="(s, i) in visibleChips(d)" :key="s + '-' + i" class="icp-chip">
                    {{ s }}
                    <button type="button" class="icp-chip-x" @click="removeSynonym(d, i)" aria-label="Supprimer">×</button>
                  </span>
                  <button v-if="d.synonyms.length > CHIPS_COLLAPSED_COUNT"
                          type="button"
                          class="icp-chip-more"
                          @click="toggleExpanded(d.id)">
                    {{ isExpanded(d.id) ? 'Réduire' : '+' + (d.synonyms.length - CHIPS_COLLAPSED_COUNT) + ' de plus' }}
                  </button>
                  <input type="text" class="icp-chip-input" v-model="d._chipInput"
                         :placeholder="d.synonyms.length ? '+ synonyme…' : 'Ajoute un synonyme (Entrée)'"
                         @keydown="onChipKeydown(d, $event)"
                         @blur="addSynonym(d)" />
                </div>
                <div v-if="emojiPickerFor === d.id" class="icp-emoji-pop">
                  <button v-for="e in EMOJI_PALETTE" :key="e" class="icp-emoji-choice" @click="pickEmoji(d, e)">{{ e }}</button>
                </div>
              </div>

              <button class="icp-add-btn" @click="addICP('company')">
                + ICP spécifique à ce compte
              </button>
            </section>
          </div>

          <footer class="icp-drawer-footer">
            <div class="icp-llm-soon">
              <div class="icp-llm-soon-head">
                <span class="icp-llm-soon-title">Recherche intelligente (IA)</span>
                <span class="icp-llm-soon-badge">BIENTÔT</span>
              </div>
              <div class="icp-llm-soon-sub">
                L'IA complètera les titres que les synonymes ne matchent pas.
              </div>
            </div>
            <div class="icp-save-status">
              <span v-if="saving">Enregistrement…</span>
              <span v-else class="text-ink-400">Sauvegarde automatique</span>
            </div>
          </footer>
        </aside>
      </div>
    </transition>
  `
};
