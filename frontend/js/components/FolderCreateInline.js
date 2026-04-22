// FolderCreateInline.js — Notion-style inline folder creator for the sidebar.
//
// State machine:
//   idle     → shows "+ Dossier" button
//   editing  → shows a focused <input>. Enter creates the folder and clears
//              the input so the user can create another in a row. Escape,
//              blur, or outside-click cancels.
//
// Backend default icon (📁) is applied server-side; we don't pass one from V1.
// The store.createFolder helper handles toasts / error state.
import { ref, onMounted, onBeforeUnmount, nextTick } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import { icons } from '../icons.js';

export default {
  name: 'FolderCreateInline',
  setup() {
    const editing = ref(false);
    const value = ref('');
    const inputEl = ref(null);
    const rootEl = ref(null);
    const saving = ref(false);

    function startEdit() {
      editing.value = true;
      value.value = '';
      nextTick(() => { inputEl.value && inputEl.value.focus(); });
    }
    function cancel() {
      editing.value = false;
      value.value = '';
    }
    async function save() {
      const name = (value.value || '').trim();
      if (!name) { cancel(); return; }
      saving.value = true;
      const created = await store.createFolder({ name });
      saving.value = false;
      if (!created) {
        // Error toast already surfaced by the store; keep the input open.
        nextTick(() => { inputEl.value && inputEl.value.focus(); });
        return;
      }
      // Close the folder input and open the company-create modal with the
      // new folder_id pre-selected — the user almost always wants to start
      // filling the folder right after creating it.
      editing.value = false;
      value.value = '';
      const fid = created._id || created.id;
      if (fid) {
        store.modal = { type: 'company-create', payload: { folder_id: fid } };
      }
    }
    function onKey(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); save(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancel(); }
    }
    function onDocMouseDown(ev) {
      if (!editing.value) return;
      if (rootEl.value && !rootEl.value.contains(ev.target)) cancel();
    }

    onMounted(() => document.addEventListener('mousedown', onDocMouseDown));
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocMouseDown));

    return { icons, editing, value, inputEl, rootEl, saving, startEdit, save, cancel, onKey };
  },
  template: `
    <div class="folder-create-inline" ref="rootEl" @click="!editing && startEdit()">
      <template v-if="!editing">
        <span class="folder-create-inline-plus" v-html="icons.plus"></span>
        <span class="folder-create-inline-label">Dossier</span>
      </template>
      <template v-else>
        <span class="folder-icon" aria-hidden="true">📁</span>
        <input ref="inputEl"
               class="folder-create-inline-input"
               type="text"
               placeholder="Nom du dossier"
               v-model="value"
               :disabled="saving"
               @click.stop
               @keydown="onKey" />
      </template>
    </div>
  `
};
