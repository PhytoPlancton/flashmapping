// ActionsMenu.js — Notion/Linear-style `⋯` dropdown for company overflow actions.
// Items: Exporter XLSX · Éditer la company · Archiver · Copier l'URL.
// Click outside or Escape closes. Right-aligned to its trigger.

import { ref, onMounted, onBeforeUnmount, nextTick } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import { icons } from '../icons.js';
import * as api from '../api.js';

export default {
  name: 'ActionsMenu',
  props: {
    company: { type: Object, required: true }
  },
  setup(props) {
    const open = ref(false);
    const wrapRef = ref(null);

    function toggle() { open.value = !open.value; }
    function close() { open.value = false; }

    function onDocClick(e) {
      if (!open.value) return;
      const el = wrapRef.value;
      if (el && !el.contains(e.target)) close();
    }
    function onKey(e) {
      if (e.key === 'Escape' && open.value) close();
    }

    onMounted(() => {
      document.addEventListener('mousedown', onDocClick);
      document.addEventListener('keydown', onKey);
    });
    onBeforeUnmount(() => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    });

    async function exportXlsx() {
      close();
      const teamSlug = store.currentTeam?.slug;
      if (!teamSlug) { store.toast('Aucune équipe sélectionnée', 'error'); return; }
      try { await api.exportXlsx(teamSlug); }
      catch (e) { store.toast('Export XLSX échoué', 'error'); }
    }

    function editCompany() {
      close();
      store.modal = { type: 'company-edit', payload: props.company };
    }

    async function archiveCompany() {
      close();
      const id = props.company?._id || props.company?.id || props.company?.slug;
      if (!id) return;
      await store.deleteCompany(id);
    }

    async function copyUrl() {
      close();
      try {
        const url = location.href;
        if (navigator.clipboard && navigator.clipboard.writeText) {
          await navigator.clipboard.writeText(url);
        } else {
          // Fallback for older browsers
          const ta = document.createElement('textarea');
          ta.value = url;
          ta.style.position = 'fixed';
          ta.style.opacity = '0';
          document.body.appendChild(ta);
          ta.select();
          document.execCommand('copy');
          document.body.removeChild(ta);
        }
        store.toast('Lien copié', 'success');
      } catch (e) {
        store.toast('Impossible de copier le lien', 'error');
      }
    }

    return {
      open, wrapRef, toggle, close,
      exportXlsx, editCompany, archiveCompany, copyUrl,
      icons
    };
  },
  template: `
    <div class="actions-menu-wrap" ref="wrapRef">
      <button type="button"
              class="actions-menu-trigger"
              :aria-expanded="open ? 'true' : 'false'"
              aria-haspopup="menu"
              aria-label="Plus d'actions"
              title="Plus d'actions"
              @click="toggle">
        <span v-html="icons.ellipsisHorizontal"></span>
      </button>
      <div v-if="open" class="actions-menu-panel" role="menu">
        <button type="button" class="actions-menu-item" role="menuitem" @click="exportXlsx">
          <span class="actions-menu-item-icon" v-html="icons.download"></span>
          <span>Exporter XLSX</span>
        </button>
        <button type="button" class="actions-menu-item" role="menuitem" @click="editCompany">
          <span class="actions-menu-item-icon" v-html="icons.pencil"></span>
          <span>Éditer la company</span>
        </button>
        <button type="button" class="actions-menu-item" role="menuitem" @click="copyUrl">
          <span class="actions-menu-item-icon" v-html="icons.link"></span>
          <span>Copier l'URL</span>
        </button>
        <hr class="actions-menu-sep" />
        <button type="button" class="actions-menu-item danger" role="menuitem" @click="archiveCompany">
          <span class="actions-menu-item-icon" v-html="icons.archiveBox"></span>
          <span>Archiver</span>
        </button>
      </div>
    </div>
  `
};
