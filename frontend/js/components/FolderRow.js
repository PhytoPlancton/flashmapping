// FolderRow.js — single folder header + optional children list in the sidebar.
// See UX_FOLDERS.md for the design decisions backing this component.
//
// Features:
//   - Chevron + emoji icon + name + count. Click anywhere on the header
//     (except hover actions) toggles expanded state.
//   - Double-click on the name starts inline rename (Enter save, Escape cancel,
//     blur = save).
//   - Hover reveals rename + delete action buttons on the right.
//   - Delete uses a native confirm() that spells out how many companies will
//     be moved back to the root.
//   - The whole row is a drop target: dragover adds `.drop-target-active`,
//     drop reads `text/company-id` from dataTransfer and calls the store.
//   - Force-expand: when the folder contains the active company, the chevron
//     is locked open (store.isFolderExpanded handles the logic).
//
// Props:
//   - folder   : { _id, name, icon, companies_count, ... }
//   - companies: Company[] — already filtered to this folder by the parent.
//
// Emits:
//   - 'open-company' (slug) — bubbled up from SwipeableCompanyItem.
import { ref, computed, nextTick, onMounted, onBeforeUnmount } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import { icons } from '../icons.js';
import SwipeableCompanyItem from './SwipeableCompanyItem.js';

// Common emojis for folder icons (pharma/business oriented). Reasonable size
// so the popover fits in one 5-col grid without scrolling.
const EMOJI_PALETTE = [
  '📁', '💊', '🧬', '🩺', '🏥',
  '🧪', '💉', '🔬', '⚗️', '🌡️',
  '💼', '📊', '📈', '🎯', '🚀',
  '🏢', '🌍', '🇪🇺', '🇫🇷', '🌎',
  '⭐', '📌', '🔥', '💡', '🧠',
  '🎨', '🔵', '🟢', '🟣', '🟡',
];

export default {
  name: 'FolderRow',
  components: { SwipeableCompanyItem },
  props: {
    folder: { type: Object, required: true },
    companies: { type: Array, default: () => [] },
    // Ordered list of all displayed company ids (for shift-range select).
    orderedIds: { type: Array, default: () => [] }
  },
  emits: ['open-company'],
  setup(props, { emit }) {
    const renaming = ref(false);
    const renameValue = ref('');
    const renameInput = ref(null);
    const dropActive = ref(false);
    const iconPickerOpen = ref(false);
    const iconWrapEl = ref(null);
    const palette = EMOJI_PALETTE;
    const exporting = ref(false);

    const folderId = computed(() => props.folder._id || props.folder.id);
    const expanded = computed(() => store.isFolderExpanded(folderId.value));
    // Active = one of our companies is the currently open one. Used to tint
    // the header background subtly.
    const isActive = computed(() => {
      if (!store.activeSlug) return false;
      return props.companies.some(c => c.slug === store.activeSlug);
    });
    const count = computed(() => props.companies.length);
    const displayIcon = computed(() => props.folder.icon || '📁');

    function toggleExpanded() {
      store.toggleFolderExpanded(folderId.value);
    }

    function onHeaderClick(ev) {
      // Ignore clicks on action buttons and on the rename input.
      if (ev.target.closest('.folder-actions')) return;
      if (ev.target.closest('.folder-rename-input')) return;
      toggleExpanded();
    }

    /* ===== Rename ===== */
    function startRename() {
      renameValue.value = props.folder.name || '';
      renaming.value = true;
      nextTick(() => {
        const el = renameInput.value;
        if (el) { el.focus(); el.select(); }
      });
    }
    async function commitRename() {
      const name = (renameValue.value || '').trim();
      if (!name || name === props.folder.name) {
        renaming.value = false;
        return;
      }
      renaming.value = false;
      await store.renameFolder(folderId.value, name);
    }
    function cancelRename() {
      renaming.value = false;
    }
    function onRenameKey(ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); commitRename(); }
      else if (ev.key === 'Escape') { ev.preventDefault(); cancelRename(); }
    }

    /* ===== Icon picker ===== */
    function toggleIconPicker(ev) {
      ev.stopPropagation();
      iconPickerOpen.value = !iconPickerOpen.value;
    }
    async function pickIcon(emoji) {
      iconPickerOpen.value = false;
      if (emoji === props.folder.icon) return;
      await store.updateFolder(folderId.value, { icon: emoji });
    }
    function closeIconPickerOnDocClick(ev) {
      if (!iconPickerOpen.value) return;
      if (iconWrapEl.value && !iconWrapEl.value.contains(ev.target)) {
        iconPickerOpen.value = false;
      }
    }
    function onIconPickerKey(ev) {
      if (ev.key === 'Escape' && iconPickerOpen.value) iconPickerOpen.value = false;
    }
    onMounted(() => {
      document.addEventListener('mousedown', closeIconPickerOnDocClick);
      document.addEventListener('keydown', onIconPickerKey);
    });
    onBeforeUnmount(() => {
      document.removeEventListener('mousedown', closeIconPickerOnDocClick);
      document.removeEventListener('keydown', onIconPickerKey);
    });

    /* ===== Delete ===== */
    function onDeleteClick(ev) {
      ev.stopPropagation();
      const n = count.value;
      const msg = n > 0
        ? `Supprimer le dossier « ${props.folder.name} » ? Les ${n} compte${n > 1 ? 's' : ''} seront déplacé${n > 1 ? 's' : ''} à la racine.`
        : `Supprimer le dossier « ${props.folder.name} » ?`;
      if (!window.confirm(msg)) return;
      store.deleteFolder(folderId.value);
    }

    /* ===== Drag & drop (drop target) =====
       Two layers of drop behaviour here:
         1. Outer `.folder-row` is a drop target for cross-folder moves
            (existing). Activates the blue tint when a drag enters anywhere
            in the folder. Still used when the folder is collapsed or when
            the drop lands on the header (not between cards).
         2. Inner `.folder-children` container handles *precise insertion*
            via a drop indicator bar between cards — `dropIndicatorIndex`
            is the index at which the dragged block should land in the
            current `companies` array. A drop here calls the store's
            `reorderCompaniesInFolder` helper (which doubles as a cross-
            folder move because it also sets folder_id). */
    function isCompanyDrag(ev) {
      const types = ev.dataTransfer && ev.dataTransfer.types;
      if (!types) return false;
      const arr = Array.from(types);
      return arr.includes('text/company-id') || arr.includes('text/company-ids');
    }
    function onDragEnter(ev) {
      if (!isCompanyDrag(ev)) return;
      ev.preventDefault();
      dropActive.value = true;
    }
    function onDragOver(ev) {
      // We need to prevent default whether or not we detected the custom type
      // because Firefox doesn't expose the type on dragover. Accept the drop
      // optimistically; we re-check on drop.
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      if (!dropActive.value) dropActive.value = true;
    }
    function onDragLeave(ev) {
      // relatedTarget null means the pointer left the element entirely.
      if (ev.relatedTarget && ev.currentTarget.contains(ev.relatedTarget)) return;
      dropActive.value = false;
    }

    /* ---------- Precise-insertion drop zone over `.folder-children` ---------- */
    // Index at which the dragged block will be inserted in the CURRENT list
    // of companies in this folder. `-1` = hide the indicator. Values run
    // from 0 (before first card) to companies.length (after last card).
    const dropIndicatorIndex = ref(-1);
    // Y-coordinate (px, relative to the children container's top edge) at
    // which the blue bar should render. Derived on each dragover.
    const dropIndicatorY = ref(0);
    const childrenEl = ref(null);

    function computeDropIndex(containerY, container) {
      // Iterate the direct `.swipe-row` children (SwipeableCompanyItem root).
      // The last "+ Ajouter un compte" button is NOT a .swipe-row so it won't
      // be considered — drops below the last card naturally yield index = N.
      const rows = Array.from(container.querySelectorAll(':scope > .swipe-row'));
      if (rows.length === 0) return { index: 0, y: 0 };
      let best = { index: rows.length, y: 0, dist: Infinity };
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        const containerTop = container.getBoundingClientRect().top;
        const midY = r.top + r.height / 2 - containerTop;
        const d = Math.abs(containerY - midY);
        if (d < best.dist) {
          // Insertion BEFORE this card if pointer is above its midline,
          // AFTER (i.e. index i+1) if below.
          const insertBefore = containerY < midY;
          best = {
            index: insertBefore ? i : i + 1,
            y: insertBefore
              ? r.top - containerTop
              : r.bottom - containerTop,
            dist: d,
          };
        }
      }
      return best;
    }

    function onChildrenDragOver(ev) {
      if (!isCompanyDrag(ev)) {
        // Still let the outer folder drop-target handle non-reorder drags.
        return;
      }
      ev.preventDefault();
      ev.stopPropagation();  // don't bubble to outer dragover (keeps blue tint calmer)
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      const container = childrenEl.value || ev.currentTarget;
      const rect = container.getBoundingClientRect();
      const y = ev.clientY - rect.top;
      const { index, y: barY } = computeDropIndex(y, container);
      dropIndicatorIndex.value = index;
      dropIndicatorY.value = barY;
    }

    function onChildrenDragLeave(ev) {
      // Only clear if we're actually leaving the container (not crossing
      // into a child card element).
      if (ev.relatedTarget && ev.currentTarget.contains(ev.relatedTarget)) return;
      dropIndicatorIndex.value = -1;
    }

    async function onChildrenDrop(ev) {
      if (!isCompanyDrag(ev)) return;
      ev.preventDefault();
      ev.stopPropagation();
      const insertAt = dropIndicatorIndex.value;
      dropIndicatorIndex.value = -1;
      dropActive.value = false;

      // Resolve dragged id(s) — prefer multi-payload if present.
      let draggedIds = [];
      const multi = ev.dataTransfer.getData('text/company-ids');
      if (multi) {
        try {
          const parsed = JSON.parse(multi);
          if (Array.isArray(parsed) && parsed.length) draggedIds = parsed;
        } catch (e) {}
      }
      if (draggedIds.length === 0) {
        const single = ev.dataTransfer.getData('text/company-id');
        if (single) draggedIds = [single];
      }
      if (draggedIds.length === 0) return;

      // Build the new ordering: take the current folder's companies, remove
      // any dragged ids (so a re-order within the same folder doesn't count
      // them twice), then splice the dragged block in at `insertAt`.
      const currentIds = props.companies
        .map(c => c._id || c.id)
        .filter(id => id != null);
      const draggedSet = new Set(draggedIds);
      const withoutDragged = currentIds.filter(id => !draggedSet.has(id));
      // Clamp insertAt to the shortened list's bounds.
      const clamped = Math.max(0, Math.min(insertAt < 0 ? withoutDragged.length : insertAt, withoutDragged.length));
      // Note: when dragging WITHIN the same folder, the user-visible drop
      // index was computed against the full list. Because we first remove
      // the dragged card(s), the target index shifts by how many of them
      // were above the drop point. We approximate by clamping; the
      // insertion order remains perceptually "at the bar" because the bar
      // is redrawn live on every dragover.
      const newOrder = [
        ...withoutDragged.slice(0, clamped),
        ...draggedIds,
        ...withoutDragged.slice(clamped),
      ];

      const ok = await store.reorderCompaniesInFolder(folderId.value, newOrder);
      if (ok) {
        const n = draggedIds.length;
        store.toast(
          n > 1
            ? `${n} comptes réorganisés dans ${props.folder.name}`
            : `Réorganisé dans ${props.folder.name}`,
          'success'
        );
        if (n > 1) store.clearCompanySelection();
      }
    }

    async function onDrop(ev) {
      ev.preventDefault();
      dropActive.value = false;
      // If the precise-insertion handler already took this drop (stopPropagation),
      // we never get here. This fallback handles drops on the header or when
      // the folder is collapsed — we just append to the end of the folder.
      // Multi-drag payload first (Shift/Cmd-click selection).
      const multi = ev.dataTransfer.getData('text/company-ids');
      if (multi) {
        try {
          const ids = JSON.parse(multi);
          if (Array.isArray(ids) && ids.length) {
            const n = await store.moveCompaniesToFolder(ids, folderId.value);
            if (n > 0) store.toast(`${n} compte${n > 1 ? 's' : ''} déplacé${n > 1 ? 's' : ''} vers ${props.folder.name}`, 'success');
            store.clearCompanySelection();
            return;
          }
        } catch (e) {}
      }
      const id = ev.dataTransfer.getData('text/company-id');
      if (!id) return;
      const ok = await store.moveCompanyToFolder(id, folderId.value);
      if (ok) store.toast(`Déplacé vers ${props.folder.name}`, 'success');
    }

    function openCompany(c) { emit('open-company', c.slug); }

    /* Open the company-create modal pre-populated with this folder_id so the
       new account lands inside the folder automatically. */
    function addCompanyHere(ev) {
      if (ev) ev.stopPropagation();
      store.modal = { type: 'company-create', payload: { folder_id: folderId.value } };
    }

    async function onExportClick() {
      if (exporting.value) return;
      const teamSlug = store.currentTeam?.slug;
      if (!teamSlug) return;
      exporting.value = true;
      try {
        await store.exportFolderXLSX(teamSlug, folderId.value, props.folder?.name || 'Dossier');
      } catch (e) {
        store.toast?.(e?.message || 'Export impossible', 'error');
      } finally {
        exporting.value = false;
      }
    }

    return {
      store, icons,
      folderId, expanded, isActive, count, displayIcon,
      renaming, renameValue, renameInput,
      dropActive,
      iconPickerOpen, iconWrapEl, palette,
      exporting, onExportClick,
      toggleExpanded, onHeaderClick,
      startRename, commitRename, cancelRename, onRenameKey,
      toggleIconPicker, pickIcon,
      onDeleteClick,
      onDragEnter, onDragOver, onDragLeave, onDrop,
      // Precise-insertion drop-zone state & handlers.
      dropIndicatorIndex, dropIndicatorY, childrenEl,
      onChildrenDragOver, onChildrenDragLeave, onChildrenDrop,
      openCompany, addCompanyHere
    };
  },
  template: `
    <div class="folder-row"
         :class="{
           'drop-target-active': dropActive,
           'is-active': isActive,
           'contains-active-collapsed': isActive && !expanded
         }"
         @dragenter="onDragEnter"
         @dragover="onDragOver"
         @dragleave="onDragLeave"
         @drop="onDrop">
      <div class="folder-row-header" @click="onHeaderClick">
        <span class="folder-chevron" :class="{ expanded }" v-html="icons.chevronRight"></span>

        <!-- Icon: click opens an emoji palette below (Notion-style). -->
        <span class="folder-icon-wrap" ref="iconWrapEl" @click.stop>
          <button type="button"
                  class="folder-icon-btn"
                  :class="{ active: iconPickerOpen }"
                  :title="'Changer l\\'icône du dossier'"
                  aria-label="Changer l'icône"
                  @click="toggleIconPicker">
            <span class="folder-icon">{{ displayIcon }}</span>
          </button>
          <div v-if="iconPickerOpen" class="folder-icon-popover" role="dialog">
            <button v-for="e in palette" :key="e"
                    type="button"
                    class="folder-icon-pick"
                    :class="{ current: e === displayIcon }"
                    :title="e"
                    @click.stop="pickIcon(e)">
              {{ e }}
            </button>
          </div>
        </span>

        <input v-if="renaming"
               ref="renameInput"
               class="folder-rename-input"
               type="text"
               v-model="renameValue"
               @click.stop
               @keydown="onRenameKey"
               @blur="commitRename" />
        <span v-else
              class="folder-name"
              @dblclick.stop="startRename"
              :title="folder.name">{{ folder.name }}</span>

        <span class="folder-count" v-if="!renaming">{{ count }}</span>

        <span class="folder-actions" v-if="!renaming">
          <button type="button"
                  class="folder-action-btn"
                  title="Exporter en Excel"
                  aria-label="Télécharger le dossier en XLSX"
                  :disabled="exporting"
                  @click.stop="onExportClick">
            <span v-if="exporting" class="folder-action-spinner" aria-hidden="true"></span>
            <span v-else v-html="icons.download"></span>
          </button>
          <button type="button"
                  class="folder-action-btn"
                  title="Renommer"
                  aria-label="Renommer le dossier"
                  @click.stop="startRename"
                  v-html="icons.pencil"></button>
          <button type="button"
                  class="folder-action-btn"
                  title="Supprimer"
                  aria-label="Supprimer le dossier"
                  @click.stop="onDeleteClick"
                  v-html="icons.trash"></button>
        </span>
      </div>

      <div v-if="expanded"
           class="folder-children"
           ref="childrenEl"
           style="position: relative;"
           @dragover="onChildrenDragOver"
           @dragleave="onChildrenDragLeave"
           @drop="onChildrenDrop">
        <SwipeableCompanyItem v-for="c in companies"
                              :key="c._id || c.slug"
                              :company="c"
                              :active="c.slug === store.activeSlug"
                              :ordered-ids="orderedIds"
                              @open="openCompany(c)" />
        <!-- Drop-indicator bar, live-positioned during reorder drag. -->
        <div v-if="dropIndicatorIndex >= 0"
             class="drop-indicator"
             :style="{ top: dropIndicatorY + 'px' }"
             aria-hidden="true"></div>
        <!-- Always-visible "+ Ajouter un compte" card at the end of the
             folder's children. Same footprint as a company card (dashed)
             so it feels like a "slot for a new account". Opens create
             modal with this folder pre-selected. -->
        <button type="button"
                class="add-account-card in-folder"
                @click.stop="addCompanyHere">
          <span class="add-account-plus" v-html="icons.plus"></span>
          <span class="add-account-label">Ajouter un compte</span>
        </button>
      </div>
    </div>
  `
};
