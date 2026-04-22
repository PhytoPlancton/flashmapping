// ICPPanel.js — right-side drawer for team-scoped ICP roles + synonyms.
//
// Opens when store.icpDrawerOpen becomes true (triggered by the pencil icon
// on the ICP toggle in AccountToolbar). Auto-saves on blur / after a debounce,
// Notion-style: no explicit Save button. Changes trigger a backend recompute
// of `contact.icp_match_ids` via the keyword matcher.
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import { icons } from '../icons.js';

const EMOJI_PALETTE = [
  '👤','💼','📚','🧪','💊','🩺','⚕️','🧑‍⚕️','🧑‍💼','🧑‍🏫',
  '🏭','🧬','💡','📊','📈','🎯','🗂️','🧠','🛠️','💰',
  '⚖️','🛡️','🔬','🌍','🚀','✨','🔑','🏛️','📦','🏢'
];

function makeIcpId() {
  // 8-char random id — enough for a handful of ICPs per team.
  return Math.random().toString(36).slice(2, 10);
}

export default {
  name: 'ICPPanel',
  setup() {
    const open = computed(() => store.icpDrawerOpen);
    // Local editable state: mirror of store.teamICPs, edits flushed on debounce.
    const drafts = ref([]);
    const llmOn = ref(false);
    const saving = ref(false);
    const llmRunning = ref(false);
    const llmResult = ref(null); // {updated, matched_new} | null
    let saveTimer = null;

    // Which ICP's emoji picker is currently open (by id), or null.
    const emojiPickerFor = ref(null);
    const emojiAnchor = ref(null);

    function syncFromStore() {
      drafts.value = (store.teamICPs || []).map(icp => ({
        id: icp.id || makeIcpId(),
        name: icp.name || '',
        emoji: icp.emoji || '👤',
        synonyms: [...(icp.synonyms || [])],
        _chipInput: '',
      }));
      llmOn.value = !!store.icpLlmEnabled;
    }

    watch(open, (o) => { if (o) syncFromStore(); });
    onMounted(syncFromStore);

    function scheduleSave() {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(flushSave, 600);
    }

    async function flushSave() {
      saving.value = true;
      try {
        const payload = drafts.value
          .filter(d => (d.name || '').trim())
          .map(d => ({
            id: d.id,
            name: d.name.trim(),
            emoji: d.emoji || '👤',
            synonyms: d.synonyms,
          }));
        await store.saveTeamICPs(payload, { llmEnabled: llmOn.value });
      } catch (e) {
        console.error('[ICPPanel] save failed', e);
        alert('Impossible de sauvegarder les ICPs: ' + (e?.message || e));
      } finally {
        saving.value = false;
      }
    }

    function addICP() {
      drafts.value.push({
        id: makeIcpId(),
        name: 'Nouvel ICP',
        emoji: '👤',
        synonyms: [],
        _chipInput: '',
      });
      // Don't save yet — wait for name edit
      scheduleSave();
    }

    function removeICP(id) {
      drafts.value = drafts.value.filter(d => d.id !== id);
      scheduleSave();
    }

    function addSynonym(draft) {
      const v = (draft._chipInput || '').trim();
      if (!v) return;
      // Split on commas so you can paste a list.
      const parts = v.split(',').map(s => s.trim()).filter(Boolean);
      for (const p of parts) {
        if (!draft.synonyms.includes(p)) draft.synonyms.push(p);
      }
      draft._chipInput = '';
      scheduleSave();
    }

    function removeSynonym(draft, idx) {
      draft.synonyms.splice(idx, 1);
      scheduleSave();
    }

    function onChipKeydown(draft, ev) {
      if (ev.key === 'Enter' || ev.key === ',') {
        ev.preventDefault();
        addSynonym(draft);
      } else if (ev.key === 'Backspace' && !draft._chipInput && draft.synonyms.length) {
        // Backspace on empty input → remove last chip
        draft.synonyms.pop();
        scheduleSave();
      }
    }

    function openEmojiPicker(draft, ev) {
      emojiPickerFor.value = draft.id;
      emojiAnchor.value = ev.currentTarget;
    }
    function closeEmojiPicker() {
      emojiPickerFor.value = null;
    }
    function pickEmoji(draft, emo) {
      draft.emoji = emo;
      emojiPickerFor.value = null;
      scheduleSave();
    }

    function onNameInput() { scheduleSave(); }
    function onNameBlur() {
      if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
      flushSave();
    }

    function toggleLLM() {
      llmOn.value = !llmOn.value;
      scheduleSave();
    }

    async function runLLMNow() {
      llmRunning.value = true;
      llmResult.value = null;
      try {
        const r = await store.recomputeICPsWithLLM();
        llmResult.value = r;
      } catch (e) {
        alert('Erreur IA: ' + (e?.message || e));
      } finally {
        llmRunning.value = false;
      }
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
      open, drafts, llmOn, saving, llmRunning, llmResult,
      emojiPickerFor, EMOJI_PALETTE, icons,
      addICP, removeICP,
      addSynonym, removeSynonym, onChipKeydown,
      openEmojiPicker, closeEmojiPicker, pickEmoji,
      onNameInput, onNameBlur,
      toggleLLM, runLLMNow,
      close, onOverlayClick, onDrawerClick,
      llmAvailable: computed(() => store.icpLlmAvailable),
    };
  },
  template: `
    <transition name="icp-drawer">
      <div v-if="open" class="icp-drawer-overlay" @click="onOverlayClick">
        <aside class="icp-drawer" @click="onDrawerClick" role="dialog" aria-label="ICPs de l'équipe">
          <header class="icp-drawer-header">
            <div>
              <h2>ICPs de l'équipe</h2>
              <p>Les contacts dont le titre matche un synonyme sont étoilés ⭐ et comptent dans le badge ICP du compte.</p>
            </div>
            <button class="icp-drawer-close" @click="close" aria-label="Fermer">×</button>
          </header>

          <div class="icp-drawer-body">
            <div v-for="(d, idx) in drafts" :key="d.id" class="icp-card">
              <div class="icp-card-head">
                <button type="button" class="icp-emoji-btn" @click="openEmojiPicker(d, $event)" aria-label="Changer l&apos;emoji">
                  {{ d.emoji }}
                </button>
                <input type="text"
                       class="icp-name-input"
                       v-model="d.name"
                       placeholder="Nom de l'ICP"
                       @input="onNameInput"
                       @blur="onNameBlur" />
                <button type="button" class="icp-card-del" @click="removeICP(d.id)" title="Supprimer" aria-label="Supprimer">
                  <span v-html="icons.trash"></span>
                </button>
              </div>
              <div class="icp-chipfield">
                <span v-for="(s, i) in d.synonyms" :key="s + '-' + i" class="icp-chip">
                  {{ s }}
                  <button type="button" class="icp-chip-x" @click="removeSynonym(d, i)" aria-label="Supprimer">×</button>
                </span>
                <input type="text"
                       class="icp-chip-input"
                       v-model="d._chipInput"
                       :placeholder="d.synonyms.length ? '+ synonyme…' : 'Ajoute un synonyme (Entrée)'"
                       @keydown="onChipKeydown(d, $event)"
                       @blur="addSynonym(d)" />
              </div>
              <!-- Emoji picker popup -->
              <div v-if="emojiPickerFor === d.id" class="icp-emoji-pop">
                <button v-for="e in EMOJI_PALETTE" :key="e" class="icp-emoji-choice" @click="pickEmoji(d, e)">{{ e }}</button>
              </div>
            </div>

            <button class="icp-add-btn" @click="addICP">
              + Nouvel ICP
            </button>
          </div>

          <footer class="icp-drawer-footer">
            <div class="icp-llm-soon">
              <div class="icp-llm-soon-head">
                <span class="icp-llm-soon-title">Recherche intelligente (IA)</span>
                <span class="icp-llm-soon-badge">BIENTÔT</span>
              </div>
              <div class="icp-llm-soon-sub">
                L’IA complètera les titres que les synonymes ne matchent pas.
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
