// SwipeableCompanyItem.js — Wrapper autour d'une row sidebar avec swipe-to-reveal
// (Mac trackpad + touch) + hover × (Windows/desktop no-touch). Emits @click pour
// l'ouverture du compte. La SEULE façon de déclencher le delete est de cliquer
// sur le bouton rouge révélé (.swipe-row-action). Les deux surfaces (swipe et ×)
// convergent sur ce même bouton — consistency Mac/Windows.
//
// Gestes:
//   - pointerdown/move/up : drag horizontal
//   - wheel (deltaX > 0)  : trackpad two-finger scroll horizontal
//   - > 60px au release   : reste révélé à translateX(-120px) (spring)
//   - < 60px au release   : retract
// Hover × (Option D — swap hover):
//   - chip P2 fade out, × fade in à la même position (stacked)
//   - click × = reveal (équivalent swipe > 60px), PAS delete
// Keyboard:
//   - Delete/Backspace sur row focus = reveal ; 2e Delete = commitDelete
//   - Escape = retract
import { ref, computed, onMounted, onBeforeUnmount } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, priorityChipClass } from '../store.js';
import { icons } from '../icons.js';

const REVEAL_STABLE = 60;
const REVEAL_SETTLE = 120; // translateX(-120px) = largeur visible du bouton rouge
const MAX_DRAG = 140;

export default {
  name: 'SwipeableCompanyItem',
  props: {
    company: { type: Object, required: true },
    active: { type: Boolean, default: false },
    // Ordered list of company ids currently displayed in the sidebar (same
    // order as rendered). Passed from Sidebar so shift-click ranges are
    // resolved without the store needing to know folder grouping.
    orderedIds: { type: Array, default: () => [] }
  },
  emits: ['open'],
  setup(props, { emit }) {
    const rowEl = ref(null);
    const dragX = ref(0);         // current translateX (negative = leftward reveal)
    const dragging = ref(false);
    const revealed = ref(false);  // stable revealed state after release
    const animating = ref(false); // currently running a CSS transition

    // HTML5 drag-and-drop state. `draggable` is toggled on only when the user
    // pointerdowns on the `.drag-handle` so the rest of the card keeps its
    // swipe-to-delete behaviour. `htmlDragging` drives the .dragging class
    // (opacity 0.5) while a native drag is in flight.
    const htmlDraggable = ref(false);
    const htmlDragging = ref(false);

    // Pointer tracking
    let startX = 0;
    let startY = 0;
    let baselineX = 0;
    let pointerId = null;
    let captured = false;
    let axis = null; // 'x' | 'y' | null

    const transform = computed(() => {
      const x = clamp(dragX.value, -MAX_DRAG, 0);
      return { transform: `translateX(${x}px)` };
    });

    const actionBgIntense = computed(() => Math.abs(dragX.value) >= 80);

    function clamp(v, mn, mx) { return Math.min(mx, Math.max(mn, v)); }

    function onPointerDown(ev) {
      if (ev.pointerType === 'mouse' && ev.button !== 0) return;
      // Don't start drag on the hover-cross button (it has its own click handler).
      if (ev.target.closest('.hover-cross')) return;
      // Don't start drag on the red action button either.
      if (ev.target.closest('.swipe-row-action')) return;
      // Don't start swipe when initiating an HTML5 drag via the drag handle.
      // (The handle also stops propagation, but this is defensive.)
      if (ev.target.closest('.drag-handle')) return;
      pointerId = ev.pointerId;
      startX = ev.clientX;
      startY = ev.clientY;
      baselineX = dragX.value;
      dragging.value = false;
      axis = null;
      animating.value = false;
    }

    function onPointerMove(ev) {
      if (pointerId === null || ev.pointerId !== pointerId) return;
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;

      // Axis lock : once we know the direction, stick with it.
      if (!axis) {
        if (Math.abs(dx) < 6 && Math.abs(dy) < 6) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
        if (axis !== 'x') {
          // Vertical scroll — abandon drag.
          pointerId = null;
          return;
        }
        dragging.value = true;
        if (!captured && rowEl.value?.setPointerCapture) {
          try { rowEl.value.setPointerCapture(ev.pointerId); captured = true; } catch (e) {}
        }
      }

      if (axis === 'x') {
        let next = baselineX + dx;
        next = clamp(next, -MAX_DRAG, 0);
        dragX.value = next;
        ev.preventDefault();
      }
    }

    function onPointerUp(ev) {
      if (pointerId === null || (ev && ev.pointerId !== pointerId)) return;
      if (captured && rowEl.value?.releasePointerCapture) {
        try { rowEl.value.releasePointerCapture(pointerId); } catch (e) {}
      }
      captured = false;
      pointerId = null;

      if (!dragging.value) {
        // Not a drag — just a tap. If the card is revealed, retract and
        // absorb the click (don't propagate open).
        if (revealed.value) retract();
        return;
      }

      dragging.value = false;
      const dist = Math.abs(dragX.value);

      // NO AUTO_DELETE: reveal-only flow.
      if (dist >= REVEAL_STABLE) {
        reveal();
      } else {
        retract();
      }
    }

    function onPointerCancel(ev) { onPointerUp(ev); }

    // Wheel handler for Mac trackpad two-finger horizontal scroll.
    let wheelSettleTimer = null;
    function onWheel(ev) {
      if (Math.abs(ev.deltaX) <= Math.abs(ev.deltaY)) return;
      if (ev.deltaX <= 0 && dragX.value === 0) return;
      ev.preventDefault();
      let next = dragX.value - ev.deltaX;
      next = clamp(next, -MAX_DRAG, 0);
      dragX.value = next;
      dragging.value = true;

      if (wheelSettleTimer) clearTimeout(wheelSettleTimer);
      wheelSettleTimer = setTimeout(() => {
        dragging.value = false;
        const dist = Math.abs(dragX.value);
        if (dist >= REVEAL_STABLE) {
          reveal();
        } else {
          retract();
        }
      }, 140);
    }

    function settleAt(x) {
      animating.value = true;
      dragX.value = x;
      setTimeout(() => { animating.value = false; }, 220);
    }

    // reveal() = settle à -120px. Même état que post-swipe ou post-click-×.
    function reveal() {
      settleAt(-REVEAL_SETTLE);
      revealed.value = true;
    }

    function retract() {
      animating.value = true;
      dragX.value = 0;
      revealed.value = false;
      setTimeout(() => { animating.value = false; }, 220);
    }

    // commitDelete() = LE SEUL vrai trigger de suppression. Haptic ici.
    async function commitDelete() {
      animating.value = true;
      // Slide fully off-screen for visual feedback, then perform delete.
      dragX.value = -380;
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (e) {}
      const id = props.company._id || props.company.id || props.company.slug;
      await store.deleteCompany(id);
      // Parent v-for will unmount us on optimistic removal — no local reset needed.
    }

    /* ===== Hover × (Windows/desktop no-touch) ===== */
    // Click × = reveal (équivalent swipe > 60px). Ne delete PAS.
    function onCrossClick(ev) {
      ev.stopPropagation();
      ev.preventDefault();
      if (revealed.value) {
        // Si déjà révélé, un 2e click sur × retract (toggle).
        retract();
        return;
      }
      reveal();
    }

    /* ===== Outside click / retract ===== */
    function onDocClick(ev) {
      if (!revealed.value) return;
      if (!rowEl.value || rowEl.value.contains(ev.target)) return;
      retract();
    }

    /* ===== Keyboard a11y ===== */
    function onRowKeydown(ev) {
      if (ev.key === 'Delete' || ev.key === 'Backspace') {
        ev.preventDefault();
        if (revealed.value) {
          commitDelete();
        } else {
          reveal();
        }
      } else if (ev.key === 'Escape') {
        if (revealed.value) {
          ev.preventDefault();
          retract();
        }
      } else if (ev.key === 'Enter' || ev.key === ' ') {
        // Enter/Space on focused row = open (unless revealed, in which case retract).
        if (revealed.value) {
          ev.preventDefault();
          retract();
          return;
        }
        ev.preventDefault();
        emit('open', props.company);
      }
    }

    onMounted(() => document.addEventListener('mousedown', onDocClick));
    onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));

    /* Prevent native text-range selection when the user starts a Shift/Cmd-
       click on a card. Fires BEFORE the click so the browser doesn't create
       a text range we'd have to tear down after. */
    function onRowMouseDown(ev) {
      if (ev.shiftKey || ev.metaKey || ev.ctrlKey) {
        ev.preventDefault();
        // Also nuke any existing selection (from a previous shift-drag etc.)
        try { window.getSelection()?.removeAllRanges(); } catch (e) {}
      }
    }

    function onRowClick(ev) {
      // Guard: a drag that finished revealed/animating should not navigate.
      if (revealed.value || animating.value || dragging.value) { return; }
      const id = props.company._id || props.company.id || props.company.slug;
      // Shift-click → range select between last-clicked anchor and this.
      if (ev && ev.shiftKey) {
        ev.preventDefault();
        try { window.getSelection()?.removeAllRanges(); } catch (e) {}
        // Prefer the live getter (store._getOrderedCompanyIds) over the prop:
        // the prop can be stale between a re-render and a click event.
        const live = (typeof store._getOrderedCompanyIds === 'function')
          ? store._getOrderedCompanyIds()
          : (props.orderedIds || []);
        store.selectCompanyRange(id, live);
        return;
      }
      // Cmd/Ctrl-click → toggle this card in selection (no navigation).
      if (ev && (ev.metaKey || ev.ctrlKey)) {
        ev.preventDefault();
        store.toggleCompanySelection(id);
        store.setLastClickedCompany(id);
        return;
      }
      // Regular click → clear multi-selection, remember as anchor, navigate.
      if (store.hasSelection()) store.clearCompanySelection();
      store.setLastClickedCompany(id);
      emit('open', props.company);
    }

    function onActionDeleteClick(ev) {
      ev.stopPropagation();
      commitDelete();
    }

    /* ===== HTML5 Drag & Drop (handle-initiated) =====
       The handle is the only surface that arms `draggable=true`. We also
       stop the pointerdown from bubbling to the swipe-row pointer logic so
       the row doesn't start a swipe while a drag is being initiated. */
    function onHandlePointerDown(ev) {
      ev.stopPropagation();
      htmlDraggable.value = true;
    }
    function onHandlePointerUp() {
      // If the native dragstart didn't fire (user just clicked the handle),
      // disarm draggable so future swipe gestures aren't interfered with.
      // The `dragend` handler covers the real-drag case.
      setTimeout(() => { if (!htmlDragging.value) htmlDraggable.value = false; }, 0);
    }
    function onDragStart(ev) {
      if (!htmlDraggable.value) { ev.preventDefault(); return; }
      htmlDragging.value = true;
      const id = props.company._id || props.company.id || props.company.slug;
      // If this card is part of a multi-selection (≥2 ids), drag ALL selected
      // ids together. Otherwise single-card drag. The card being dragged is
      // auto-added to the selection if it wasn't there.
      let ids = [id];
      if (store.hasSelection()) {
        if (!store.isCompanySelected(id)) {
          store.addCompanyToSelection(id);
        }
        ids = [...store.selectedCompanyIds];
      }
      try {
        ev.dataTransfer.effectAllowed = 'move';
        if (ids.length > 1) {
          ev.dataTransfer.setData('text/company-ids', JSON.stringify(ids));
          ev.dataTransfer.setData('text/plain', `companies:${ids.length}`);
        } else {
          ev.dataTransfer.setData('text/company-id', id);
          ev.dataTransfer.setData('text/plain', `company:${id}`);
        }
      } catch (e) {}
    }
    function onDragEnd() {
      htmlDragging.value = false;
      htmlDraggable.value = false;
    }

    return {
      store, icons, priorityChipClass,
      rowEl, transform, actionBgIntense, dragging, animating, revealed,
      htmlDraggable, htmlDragging,
      onPointerDown, onPointerMove, onPointerUp, onPointerCancel, onWheel,
      onRowClick, onRowMouseDown, onRowKeydown, onCrossClick, onActionDeleteClick,
      onHandlePointerDown, onHandlePointerUp, onDragStart, onDragEnd
    };
  },
  template: `
    <div class="swipe-row" ref="rowEl"
         :class="{
           'is-revealed': revealed,
           'dragging': htmlDragging,
           'selected': store.isCompanySelected(company._id || company.id || company.slug)
         }"
         :draggable="htmlDraggable"
         tabindex="0"
         role="button"
         :aria-label="'Ouvrir ' + company.name"
         @keydown="onRowKeydown"
         @wheel.passive.prevent="onWheel"
         @dragstart="onDragStart"
         @dragend="onDragEnd">
      <!-- Red action zone — SEUL vrai trigger du delete -->
      <button type="button"
              class="swipe-row-action"
              :class="{ intense: actionBgIntense }"
              :aria-label="'Supprimer le compte ' + company.name"
              tabindex="-1"
              @click.stop="onActionDeleteClick">
        <span v-html="icons.trash" style="color:#D1D5DB; width:16px; height:16px;"></span>
        <span class="swipe-row-action-label">Supprimer</span>
      </button>

      <!-- Foreground row (carries the translate) -->
      <div class="swipe-row-content"
           :class="{ dragging, animating, active }"
           :style="transform"
           @mousedown="onRowMouseDown"
           @pointerdown="onPointerDown"
           @pointermove="onPointerMove"
           @pointerup="onPointerUp"
           @pointercancel="onPointerCancel"
           @click="onRowClick">
        <div class="sidebar-row swipe-row-sidebar" :class="{ active }">
          <!-- Drag handle (left). Only arms draggable=true on pointerdown,
               so swipe-to-delete on the rest of the card stays intact. -->
          <span class="drag-handle"
                :aria-label="'Glisser ' + company.name"
                title="Glisser pour déplacer"
                @pointerdown="onHandlePointerDown"
                @pointerup="onHandlePointerUp"
                @click.stop
                v-html="icons.dragHandle"></span>

          <div class="min-w-0 flex-1">
            <div class="name truncate">{{ company.name }}</div>
            <div class="sub-muted truncate">
              {{ company.contact_count ?? 0 }} contacts<span v-if="company.techtomed_count"> · ★ {{ company.techtomed_count }}</span>
            </div>
          </div>

          <!-- Stacked slot (chip P2 + × partagent exactement la même position).
               L'un fade in, l'autre fade out au hover — un seul occupant visuel. -->
          <div class="row-right-slot ml-2 shrink-0">
            <span class="priority-chip" :class="priorityChipClass(company.priority)">{{ company.priority || '—' }}</span>

            <!-- Hover × (Windows/desktop no-touch) — équivalent clavier-souris du swipe -->
            <button class="hover-cross"
                    type="button"
                    :aria-label="'Supprimer le compte ' + company.name"
                    tabindex="-1"
                    @click="onCrossClick"
                    @pointerdown.stop>
              <span class="hover-cross-icon" v-html="icons.close"></span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `
};
