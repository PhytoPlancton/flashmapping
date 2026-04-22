import { computed, onMounted, ref, onBeforeUnmount, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, PRIORITY_ORDER, priorityChipClass, initialsOf } from '../store.js';
import { icons } from '../icons.js';
import TeamSwitcher from './TeamSwitcher.js';
import SwipeableCompanyItem from './SwipeableCompanyItem.js';
import FolderRow from './FolderRow.js';
import FolderCreateInline from './FolderCreateInline.js';

export default {
  name: 'Sidebar',
  components: { TeamSwitcher, SwipeableCompanyItem, FolderRow, FolderCreateInline },
  setup() {
    onMounted(() => {
      if (store.currentTeam && store.companies.length === 0) {
        // Load folders and companies in parallel — both populate the sidebar.
        store.loadCompanies();
        store.loadFolders();
      }
    });

    // Re-load when team changes.
    watch(() => store.currentTeam?.slug, (slug) => {
      if (slug) {
        store.loadCompanies();
        store.loadFolders();
      }
    });

    // Sort comparator reused for both folder children and root list.
    //
    // Order of precedence:
    //   1. priority (P1+ → P1 → P2 → P3 → '') — business importance always
    //      wins; a P3 reordered by hand should NOT float above a P1.
    //   2. manual `position` (drag-reorder output; default 0 = untouched)
    //   3. techtomed_count DESC (legacy tie-breaker — more "known" contacts
    //      first within the same priority + position bucket)
    //   4. name ASC (stable final tie-break)
    //
    // Consequence for V1: the user can reorder freely WITHIN a priority
    // group. Mixing P1+ and P2 into a single manual order is not supported
    // — deemed acceptable vs. the risk of a hand-moved low-priority account
    // silently eclipsing an important one.
    function cmp(a, b) {
      const pa = PRIORITY_ORDER[a.priority || ''] ?? 0;
      const pb = PRIORITY_ORDER[b.priority || ''] ?? 0;
      if (pb !== pa) return pb - pa;
      const posA = a.position ?? 0;
      const posB = b.position ?? 0;
      if (posA !== posB) return posA - posB;
      const ta = a.techtomed_count ?? 0;
      const tb = b.techtomed_count ?? 0;
      if (tb !== ta) return tb - ta;
      return (a.name || '').localeCompare(b.name || '');
    }

    const sortedCompanies = computed(() => [...store.companies].sort(cmp));

    // Map<folder_id | null, Company[]> — used by the template to slice
    // companies for each folder row + the root section.
    const companiesByFolder = computed(() => {
      const map = new Map();
      for (const c of sortedCompanies.value) {
        const key = c.folder_id || null;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(c);
      }
      return map;
    });

    function companiesInFolder(id) {
      return companiesByFolder.value.get(id) || [];
    }
    const rootCompanies = computed(() => companiesByFolder.value.get(null) || []);

    // Drop target state for the "Sans dossier" section — same pattern as
    // FolderRow but folder_id = null.
    const rootDropActive = ref(false);
    // Precise-insertion state for root-level reordering. See FolderRow for
    // the same pattern; the only difference here is folder_id = null.
    const rootDropIndicatorIndex = ref(-1);
    const rootDropIndicatorY = ref(0);
    const rootDropEl = ref(null);

    function isCompanyDrag(ev) {
      const types = ev.dataTransfer && ev.dataTransfer.types;
      if (!types) return false;
      const arr = Array.from(types);
      return arr.includes('text/company-id') || arr.includes('text/company-ids');
    }

    function computeRootDropIndex(containerY, container) {
      const rows = Array.from(container.querySelectorAll(':scope > .swipe-row'));
      if (rows.length === 0) return { index: 0, y: 0 };
      let best = { index: rows.length, y: 0, dist: Infinity };
      const containerTop = container.getBoundingClientRect().top;
      for (let i = 0; i < rows.length; i++) {
        const r = rows[i].getBoundingClientRect();
        const midY = r.top + r.height / 2 - containerTop;
        const d = Math.abs(containerY - midY);
        if (d < best.dist) {
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

    function onRootDragOver(ev) {
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';
      rootDropActive.value = true;
      // Compute precise insertion index only if this looks like a company drag.
      if (!isCompanyDrag(ev)) return;
      const container = rootDropEl.value || ev.currentTarget;
      const y = ev.clientY - container.getBoundingClientRect().top;
      const { index, y: barY } = computeRootDropIndex(y, container);
      rootDropIndicatorIndex.value = index;
      rootDropIndicatorY.value = barY;
    }
    function onRootDragLeave(ev) {
      if (ev.relatedTarget && ev.currentTarget.contains(ev.relatedTarget)) return;
      rootDropActive.value = false;
      rootDropIndicatorIndex.value = -1;
    }
    async function onRootDrop(ev) {
      ev.preventDefault();
      const insertAt = rootDropIndicatorIndex.value;
      rootDropActive.value = false;
      rootDropIndicatorIndex.value = -1;

      // Resolve dragged ids.
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

      // If we have a precise insertion index, do a proper reorder-with-
      // folder-retarget call. Otherwise fall back to the "append to root"
      // path that existed before.
      if (insertAt >= 0) {
        const currentIds = rootCompanies.value
          .map(c => c._id || c.id)
          .filter(id => id != null);
        const draggedSet = new Set(draggedIds);
        const withoutDragged = currentIds.filter(id => !draggedSet.has(id));
        const clamped = Math.max(0, Math.min(insertAt, withoutDragged.length));
        const newOrder = [
          ...withoutDragged.slice(0, clamped),
          ...draggedIds,
          ...withoutDragged.slice(clamped),
        ];
        const ok = await store.reorderCompaniesInFolder(null, newOrder);
        if (ok) {
          const n = draggedIds.length;
          store.toast(
            n > 1 ? `${n} comptes réorganisés hors dossier` : 'Réorganisé hors dossier',
            'success'
          );
          if (n > 1) store.clearCompanySelection();
        }
        return;
      }

      // Legacy fallback — no indicator (e.g. empty root section hover).
      if (draggedIds.length > 1) {
        const n = await store.moveCompaniesToFolder(draggedIds, null);
        if (n > 0) store.toast(`${n} compte${n > 1 ? 's' : ''} déplacé${n > 1 ? 's' : ''} hors dossier`, 'success');
        store.clearCompanySelection();
        return;
      }
      const ok = await store.moveCompanyToFolder(draggedIds[0], null);
      if (ok) store.toast('Déplacé hors dossier', 'success');
    }

    // Clear selection on ESC, and on body-click outside a card.
    function onGlobalKeydown(ev) {
      if (ev.key === 'Escape' && store.hasSelection()) {
        store.clearCompanySelection();
      }
    }
    onMounted(() => document.addEventListener('keydown', onGlobalKeydown));
    onBeforeUnmount(() => document.removeEventListener('keydown', onGlobalKeydown));

    // Ordered list of company ids as displayed (folder contents first then
    // root). Computed on-demand via a getter function, not a cached computed,
    // so shift-click always reads the latest display order even if Vue hasn't
    // flushed a render yet.
    function getOrderedIds() {
      const ids = [];
      for (const f of store.folders) {
        const fid = f._id || f.id;
        for (const c of companiesInFolder(fid)) ids.push(c._id || c.id || c.slug);
      }
      for (const c of rootCompanies.value) ids.push(c._id || c.id || c.slug);
      return ids;
    }
    // Expose to store so any SwipeableCompanyItem click reads from the same
    // source of truth without needing props to be fresh.
    store._getOrderedCompanyIds = getOrderedIds;
    const orderedIds = computed(() => getOrderedIds());

    function open(slug) {
      const teamSlug = store.currentTeam?.slug;
      if (!teamSlug) return;
      location.hash = `#/${teamSlug}/companies/${slug}`;
    }
    function openCreate() { store.modal = { type: 'company-create' }; }
    function onAiCardClick() {
      store.showToast && store.showToast('Génération IA bientôt disponible — en cours de développement.');
    }

    /* ---- User menu dropdown ---- */
    const userMenuOpen = ref(false);
    const userMenuEl = ref(null);
    function toggleUserMenu() { userMenuOpen.value = !userMenuOpen.value; }
    function closeUserMenu() { userMenuOpen.value = false; }
    function onDocClick(ev) {
      if (!userMenuOpen.value) return;
      if (userMenuEl.value && !userMenuEl.value.contains(ev.target)) closeUserMenu();
    }
    onMounted(() => document.addEventListener('mousedown', onDocClick));
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));

    function goSettings() { closeUserMenu(); store.openSettingsModal(); }
    function logout() { closeUserMenu(); store.logout(); }

    return {
      store, sortedCompanies, rootCompanies, companiesInFolder, orderedIds,
      priorityChipClass, open, openCreate, onAiCardClick, logout, icons,
      userMenuOpen, userMenuEl, toggleUserMenu, closeUserMenu, goSettings,
      initialsOf,
      rootDropActive, onRootDragOver, onRootDragLeave, onRootDrop,
      rootDropEl, rootDropIndicatorIndex, rootDropIndicatorY
    };
  },
  template: `
    <aside class="w-[280px] shrink-0 bg-white border-r border-ink-200 flex flex-col h-screen">
      <div class="px-3 py-3 border-b border-ink-100">
        <TeamSwitcher />
      </div>

      <div class="px-3 pt-3 pb-1 flex items-center justify-between">
        <span class="text-[10.5px] uppercase tracking-wider text-ink-400 font-semibold">Comptes</span>
        <span class="text-[10.5px] text-ink-400 tabular-nums">{{ sortedCompanies.length }}</span>
      </div>

      <div class="flex-1 overflow-y-auto px-1 pb-2">
        <!-- AI mapping card (coming soon) — remains at the top, above folders -->
        <div class="ai-mapping-row"
             role="button"
             aria-disabled="true"
             aria-label="Fonctionnalité IA bientôt disponible"
             title="Bientôt disponible"
             @click="onAiCardClick">
          <div class="ai-sparkle" aria-hidden="true">
            <span class="ai-sparkle-icon" v-html="icons.sparkles"></span>
            <span class="ai-sparkle-lock" aria-hidden="true">
              <svg viewBox="0 0 12 12" width="10" height="10" fill="currentColor">
                <path d="M4 5V3.5a2 2 0 114 0V5h.5A1.5 1.5 0 0110 6.5v3A1.5 1.5 0 018.5 11h-5A1.5 1.5 0 012 9.5v-3A1.5 1.5 0 013.5 5H4zm1 0h2V3.5a1 1 0 10-2 0V5z"/>
              </svg>
            </span>
          </div>
          <div class="ai-mapping-text">
            <div class="ai-mapping-name">Générer un mapping IA</div>
            <div class="ai-mapping-sub"><span class="ai-dot"></span>En développement</div>
          </div>
          <div class="ai-mapping-badge">BIENTÔT</div>
          <span class="ai-mapping-aurora" aria-hidden="true"></span>
        </div>

        <div v-if="store.companiesLoading" class="text-xs text-ink-400 px-3 py-3">Chargement…</div>
        <div v-else-if="sortedCompanies.length === 0 && store.folders.length === 0"
             class="text-xs text-ink-400 px-3 py-3">
          Aucun compte.
        </div>

        <!-- Folders (rendered in store.folders order — already position-sorted by backend) -->
        <FolderRow v-for="f in store.folders"
                   :key="f._id || f.id"
                   :folder="f"
                   :companies="companiesInFolder(f._id || f.id)"
                   :ordered-ids="orderedIds"
                   @open-company="open" />

        <!-- "Sans dossier" section — only shown if there are root-level
             companies AND at least one folder exists (otherwise the flat
             list reads clearer without a section header). -->
        <template v-if="store.folders.length > 0 && rootCompanies.length > 0">
          <div class="sidebar-section-label">Sans dossier</div>
          <div class="sidebar-root-drop"
               ref="rootDropEl"
               style="position: relative;"
               :class="{ 'drop-target-active': rootDropActive }"
               @dragover="onRootDragOver"
               @dragleave="onRootDragLeave"
               @drop="onRootDrop">
            <SwipeableCompanyItem v-for="c in rootCompanies" :key="c._id || c.slug"
                                  :company="c"
                                  :active="c.slug === store.activeSlug"
                                  :ordered-ids="orderedIds"
                                  @open="open(c.slug)" />
            <div v-if="rootDropIndicatorIndex >= 0"
                 class="drop-indicator"
                 :style="{ top: rootDropIndicatorY + 'px' }"
                 aria-hidden="true"></div>
          </div>
        </template>

        <!-- No folders yet: flat list like before. We STILL wrap it in a
             drop zone so reorder works even when the user has no folders. -->
        <template v-else-if="store.folders.length === 0">
          <div class="sidebar-root-drop"
               ref="rootDropEl"
               style="position: relative;"
               :class="{ 'drop-target-active': rootDropActive }"
               @dragover="onRootDragOver"
               @dragleave="onRootDragLeave"
               @drop="onRootDrop">
            <SwipeableCompanyItem v-for="c in rootCompanies" :key="c._id || c.slug"
                                  :company="c"
                                  :active="c.slug === store.activeSlug"
                                  :ordered-ids="orderedIds"
                                  @open="open(c.slug)" />
            <div v-if="rootDropIndicatorIndex >= 0"
                 class="drop-indicator"
                 :style="{ top: rootDropIndicatorY + 'px' }"
                 aria-hidden="true"></div>
          </div>
        </template>

        <!-- Root-level creation inline: + Compte (no folder) + Dossier.
             Same lightweight style as "+ Dossier" to keep the sidebar calm
             — the big dashed "Ajouter un compte" card remains INSIDE folders
             where it acts as a visible slot. -->
        <button type="button" class="folder-create-inline" @click="openCreate">
          <span class="folder-create-inline-plus" v-html="icons.plus"></span>
          <span class="folder-create-inline-label">Compte</span>
        </button>
        <FolderCreateInline />
      </div>

      <div class="relative px-3 py-2 border-t border-ink-100" ref="userMenuEl">
        <button type="button" class="user-menu-btn" :class="{ active: userMenuOpen }" @click="toggleUserMenu">
          <div class="team-avatar sm">{{ initialsOf(store.user?.name || store.user?.email) }}</div>
          <div class="min-w-0 flex-1 text-left">
            <div class="text-[12px] font-medium truncate">{{ store.user?.name || '—' }}</div>
            <div class="text-[10.5px] text-ink-400 truncate">{{ store.user?.email }}</div>
          </div>
          <span class="text-ink-400" v-html="icons.chevronUp"></span>
        </button>

        <div v-if="userMenuOpen" class="user-menu-pop">
          <div class="px-3 pt-2 pb-2 border-b border-ink-100">
            <div class="text-[12.5px] font-semibold truncate">{{ store.user?.name || '—' }}</div>
            <div class="text-[10.5px] text-ink-400 truncate">{{ store.user?.email }}</div>
          </div>
          <button class="user-menu-item" @click="goSettings">
            <span class="w-5 h-5 flex items-center justify-center text-ink-500" v-html="icons.pencil"></span>
            <span>Paramètres</span>
          </button>
          <button class="user-menu-item" @click="logout">
            <span class="w-5 h-5 flex items-center justify-center text-ink-500" v-html="icons.logout"></span>
            <span>Se déconnecter</span>
          </button>
        </div>
      </div>
    </aside>
  `
};
