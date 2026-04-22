// OrgTreeFreeform.js — hand-rolled SVG canvas with pan/zoom, draggable cards,
// and bezier connections. Replacement for OrgTree when viewMode === 'freeform'.
//
// Coexisting gestures — strict separation by event.target:
//   - pointerdown on canvas background        → pan
//   - pointerdown on .freeform-card-wrapper   → drag card (stopPropagation)
//   - pointerdown on .freeform-handle         → draw connection (stopPropagation)
//   - click on <path class="freeform-connector"> → select connection
//
// Positions are stored on contact.freeform_position = { x, y } in canvas coords.
// Connections live in store.connections as { _id, source_contact_id,
// target_contact_id, type, label }.

import {
  computed, onBeforeUnmount, onMounted, reactive, ref, watch
} from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';

import { store } from '../store.js';
import ContactCard from './ContactCard.js';
import { icons } from '../icons.js';

// Visual constants (match ContactCard width = 230px, min-height ≈ 94px).
const CARD_W = 230;
const CARD_H = 100;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 4;
const LEVEL_Y = { 1: 40, 2: 180, 3: 320, 4: 460, 5: 600, 6: 740 };
const H_GAP = 24;

function contactId(c) { return c?._id || c?.id; }

export default {
  name: 'OrgTreeFreeform',
  components: { ContactCard },
  props: {
    company: { type: Object, required: true }
  },
  setup(props) {
    /* ----- viewport (pan/zoom) ----- */
    const canvasEl = ref(null);
    const pan = reactive({ x: 0, y: 0 });
    const zoom = ref(1);

    /* ----- contacts with local position overlay -----
     * We keep a local map so drag updates are instantaneous without waiting for
     * the API round-trip. When the store.activeCompany.contacts list refreshes
     * (e.g. after create/delete), we reconcile by contact id.
     */
    const localPositions = reactive({}); // id -> { x, y }

    const contacts = computed(() => {
      const list = (props.company?.contacts || []);
      return list.map(c => {
        const id = contactId(c);
        const local = localPositions[id];
        const fp = local || c.freeform_position || null;
        return {
          ...c,
          _fx: fp ? Number(fp.x) : null,
          _fy: fp ? Number(fp.y) : null
        };
      });
    });

    const contactsById = computed(() => {
      const m = {};
      for (const c of contacts.value) m[contactId(c)] = c;
      return m;
    });

    /* ----- auto-layout from levels (first pass) ----- */
    function computeLevelLayout() {
      const byLevel = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      for (const c of (props.company?.contacts || [])) {
        const lvl = Number(c.level) || 6;
        if (!byLevel[lvl]) byLevel[lvl] = [];
        byLevel[lvl].push(c);
      }
      for (const k of Object.keys(byLevel)) {
        byLevel[k].sort((a, b) =>
          (a.position_in_level ?? 0) - (b.position_in_level ?? 0)
        );
      }
      const out = {}; // id -> {x, y}
      for (const k of Object.keys(byLevel)) {
        const arr = byLevel[k];
        if (!arr.length) continue;
        const n = arr.length;
        const totalW = n * CARD_W + (n - 1) * H_GAP;
        const startX = -totalW / 2;
        const y = LEVEL_Y[k] ?? (LEVEL_Y[6] + 140);
        arr.forEach((c, i) => {
          const id = contactId(c);
          out[id] = {
            x: startX + i * (CARD_W + H_GAP),
            y
          };
        });
      }
      return out;
    }

    async function ensureInitialLayout() {
      const list = props.company?.contacts || [];
      if (!list.length) return;
      // If every contact already has a freeform_position, trust it.
      const missing = list.filter(c => {
        const fp = c.freeform_position;
        return !fp || typeof fp.x !== 'number' || typeof fp.y !== 'number';
      });
      if (missing.length === 0) return;

      // Compute + apply a seeded layout for ALL contacts (so they visually
      // align even if some already had positions — we only PATCH the missing
      // ones to the backend).
      const seeded = computeLevelLayout();
      for (const c of list) {
        const id = contactId(c);
        const pos = seeded[id];
        if (!pos) continue;
        const hasServer = c.freeform_position
          && typeof c.freeform_position.x === 'number'
          && typeof c.freeform_position.y === 'number';
        if (!hasServer) {
          localPositions[id] = { x: pos.x, y: pos.y };
        }
      }

      // Fire-and-forget persistence for the missing ones.
      try {
        await Promise.all(missing.map(c => {
          const id = contactId(c);
          const pos = seeded[id];
          if (!pos) return null;
          return store.updateContactPosition(id, pos.x, pos.y);
        }).filter(Boolean));
      } catch (e) {
        // Non-fatal — user can still drag.
      }
      fitToContent();
    }

    /* ----- anchor geometry (card centers + edge mid-points) ----- */
    function cardCenter(id) {
      const c = contactsById.value[id];
      if (!c || c._fx === null) return null;
      return { x: c._fx + CARD_W / 2, y: c._fy + CARD_H / 2 };
    }
    function edgeAnchor(id, side) {
      const c = contactsById.value[id];
      if (!c || c._fx === null) return null;
      const cx = c._fx;
      const cy = c._fy;
      switch (side) {
        case 'top':    return { x: cx + CARD_W / 2, y: cy };
        case 'bottom': return { x: cx + CARD_W / 2, y: cy + CARD_H };
        case 'left':   return { x: cx,              y: cy + CARD_H / 2 };
        case 'right':  return { x: cx + CARD_W,     y: cy + CARD_H / 2 };
        default:       return cardCenter(id);
      }
    }

    function bezierFromPoints(p1, p2) {
      if (!p1 || !p2) return '';
      const dx = (p2.x - p1.x) / 2;
      return `M ${p1.x} ${p1.y} C ${p1.x + dx} ${p1.y}, ${p2.x - dx} ${p2.y}, ${p2.x} ${p2.y}`;
    }
    function bezierPath(conn) {
      const s = cardCenter(conn.source_contact_id);
      const t = cardCenter(conn.target_contact_id);
      return bezierFromPoints(s, t);
    }

    /* ----- Pan ----- */
    const panning = ref(false);
    const panState = { startX: 0, startY: 0, origX: 0, origY: 0 };

    function onCanvasPointerDown(ev) {
      // Pan only if the press didn't originate on an interactive element.
      // Cards and handles stopPropagation(), so they never reach here anyway,
      // but we keep this defensive.
      if (ev.target.closest('.freeform-card-wrapper')) return;
      if (ev.target.closest('.freeform-handle')) return;
      if (ev.target.closest('.freeform-connector')) return;
      if (ev.target.closest('.freeform-toolbar')) return;
      if (ev.button !== undefined && ev.button !== 0) return;
      panning.value = true;
      panState.startX = ev.clientX;
      panState.startY = ev.clientY;
      panState.origX = pan.x;
      panState.origY = pan.y;
      // Deselect connection when clicking empty space.
      selectedConnectionId.value = null;
      window.addEventListener('pointermove', onPanMove);
      window.addEventListener('pointerup', onPanUp, { once: true });
    }
    function onPanMove(ev) {
      if (!panning.value) return;
      pan.x = panState.origX + (ev.clientX - panState.startX);
      pan.y = panState.origY + (ev.clientY - panState.startY);
    }
    function onPanUp() {
      panning.value = false;
      window.removeEventListener('pointermove', onPanMove);
    }

    /* ----- Zoom ----- */
    function applyZoomAt(factor, cx, cy) {
      const prev = zoom.value;
      const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, prev * factor));
      if (next === prev) return;
      // Zoom centered on (cx, cy) in viewport (screen) coordinates.
      // Canvas coord under cursor before: (cx - pan.x) / prev
      // We want it to stay under cursor: (cx - newPan.x) / next = same
      const bounds = canvasEl.value?.getBoundingClientRect();
      const ox = cx - (bounds?.left || 0);
      const oy = cy - (bounds?.top || 0);
      const canvasX = (ox - pan.x) / prev;
      const canvasY = (oy - pan.y) / prev;
      pan.x = ox - canvasX * next;
      pan.y = oy - canvasY * next;
      zoom.value = next;
    }
    function onWheel(ev) {
      // Apple Freeform / Figma / Miro semantics:
      //   - Ctrl/Cmd + wheel  → zoom (cursor-centered)
      //     macOS also synthesizes wheel events with ctrlKey:true during
      //     trackpad pinch, which naturally lands here.
      //   - Bare 2-finger trackpad scroll → pan (deltaX/Y → pan.x/y)
      // preventDefault is required in both branches to stop the underlying
      // page scroll + browser-native pinch-zoom.
      if (ev.ctrlKey || ev.metaKey) {
        ev.preventDefault();
        // Smooth zoom scaling from wheel delta: works for both discrete
        // mouse-wheel ticks (|deltaY| ~100) and continuous trackpad pinch
        // (|deltaY| ~1-4). exp keeps zoom symmetric (zoom in then out
        // returns to the same level).
        const factor = Math.exp(-ev.deltaY * 0.002);
        applyZoomAt(factor, ev.clientX, ev.clientY);
        return;
      }
      ev.preventDefault();
      // Natural trackpad mapping: two fingers moving LEFT (positive deltaX)
      // should move the content LEFT on screen, which means pan.x decreases.
      pan.x -= ev.deltaX;
      pan.y -= ev.deltaY;
    }
    function zoomIn() {
      const r = canvasEl.value?.getBoundingClientRect();
      applyZoomAt(1.25, (r?.left || 0) + (r?.width || 0) / 2, (r?.top || 0) + (r?.height || 0) / 2);
    }
    function zoomOut() {
      const r = canvasEl.value?.getBoundingClientRect();
      applyZoomAt(1 / 1.25, (r?.left || 0) + (r?.width || 0) / 2, (r?.top || 0) + (r?.height || 0) / 2);
    }

    function fitToContent() {
      const cs = contacts.value.filter(c => c._fx !== null);
      if (!cs.length || !canvasEl.value) return;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const c of cs) {
        minX = Math.min(minX, c._fx);
        minY = Math.min(minY, c._fy);
        maxX = Math.max(maxX, c._fx + CARD_W);
        maxY = Math.max(maxY, c._fy + CARD_H);
      }
      const pad = 80;
      const contentW = (maxX - minX) + pad * 2;
      const contentH = (maxY - minY) + pad * 2;
      const bounds = canvasEl.value.getBoundingClientRect();
      const sx = bounds.width / contentW;
      const sy = bounds.height / contentH;
      const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(sx, sy, 1)));
      zoom.value = z;
      // Centre the content in the viewport.
      const cx = (minX + maxX) / 2;
      const cy = (minY + maxY) / 2;
      pan.x = bounds.width / 2 - cx * z;
      pan.y = bounds.height / 2 - cy * z;
    }

    /* ----- Card drag ----- */
    const dragging = ref(null); // { id, startX, startY, origX, origY }

    function onCardPointerDown(c, ev) {
      // Ignore drag if the pointerdown originated on a handle or on an
      // actionable element inside the card (buttons, links in .card-actions).
      if (ev.target.closest('.freeform-handle')) return;
      if (ev.target.closest('.card-actions')) return;
      if (ev.target.closest('a')) return;
      if (ev.button !== undefined && ev.button !== 0) return;
      // Preserve click-to-open-modal: if user doesn't actually move, ContactCard's
      // @click handler still fires and opens the edit modal.
      // Neutralise the native HTML5 draggable=true on ContactCard — it would
      // otherwise swallow pointermove/up events during the drag.
      const cardEl = ev.currentTarget.querySelector('.contact-card');
      if (cardEl) cardEl.setAttribute('draggable', 'false');
      const id = contactId(c);
      const pos = localPositions[id]
        || c.freeform_position
        || { x: 0, y: 0 };
      dragging.value = {
        id,
        startX: ev.clientX,
        startY: ev.clientY,
        origX: Number(pos.x) || 0,
        origY: Number(pos.y) || 0,
        moved: false
      };
      ev.stopPropagation();
      window.addEventListener('pointermove', onCardPointerMove);
      window.addEventListener('pointerup', onCardPointerUp, { once: true });
    }
    function onCardPointerMove(ev) {
      const d = dragging.value;
      if (!d) return;
      const dx = (ev.clientX - d.startX) / zoom.value;
      const dy = (ev.clientY - d.startY) / zoom.value;
      if (Math.abs(dx) + Math.abs(dy) > 2) d.moved = true;
      localPositions[d.id] = {
        x: d.origX + dx,
        y: d.origY + dy
      };
    }
    async function onCardPointerUp() {
      const d = dragging.value;
      window.removeEventListener('pointermove', onCardPointerMove);
      dragging.value = null;
      if (!d) return;
      if (d.moved) {
        // Swallow the synthetic click that follows pointerup after a drag,
        // so ContactCard's @click (open modal) doesn't fire.
        const swallow = (e) => { e.stopPropagation(); e.preventDefault(); };
        window.addEventListener('click', swallow, { capture: true, once: true });
        // Safety: clear the capture listener after a tick in case no click fires.
        setTimeout(() => {
          window.removeEventListener('click', swallow, { capture: true });
        }, 0);
        const pos = localPositions[d.id];
        if (pos) {
          await store.updateContactPosition(d.id, pos.x, pos.y);
        }
      }
    }

    /* ----- Connection drawing (drag-from-handle) ----- */
    const drawing = ref(null); // { sourceId, side, mouseX, mouseY }

    function onHandlePointerDown(c, side, ev) {
      ev.stopPropagation();
      ev.preventDefault();
      const id = contactId(c);
      const mouse = screenToCanvas(ev.clientX, ev.clientY);
      drawing.value = {
        sourceId: id,
        side,
        mouseX: mouse.x,
        mouseY: mouse.y
      };
      window.addEventListener('pointermove', onHandlePointerMove);
      window.addEventListener('pointerup', onHandlePointerUp, { once: true });
    }
    function onHandlePointerMove(ev) {
      if (!drawing.value) return;
      const mouse = screenToCanvas(ev.clientX, ev.clientY);
      drawing.value.mouseX = mouse.x;
      drawing.value.mouseY = mouse.y;
    }
    async function onHandlePointerUp(ev) {
      window.removeEventListener('pointermove', onHandlePointerMove);
      const d = drawing.value;
      drawing.value = null;
      if (!d) return;
      // Determine target by hit-testing under cursor.
      const targetEl = document.elementFromPoint(ev.clientX, ev.clientY);
      if (!targetEl) return;
      const wrapper = targetEl.closest('.freeform-card-wrapper');
      if (!wrapper) return;
      const targetId = wrapper.getAttribute('data-contact-id');
      if (!targetId || targetId === d.sourceId) return;
      await store.createConnection({
        source: d.sourceId,
        target: targetId,
        type: 'default'
      });
    }

    /* ----- Drawing preview path ----- */
    const drawingPath = computed(() => {
      const d = drawing.value;
      if (!d) return '';
      const src = edgeAnchor(d.sourceId, d.side);
      if (!src) return '';
      return bezierFromPoints(src, { x: d.mouseX, y: d.mouseY });
    });

    /* ----- Screen <-> canvas coordinate conversion ----- */
    function screenToCanvas(screenX, screenY) {
      const b = canvasEl.value?.getBoundingClientRect();
      const ox = screenX - (b?.left || 0);
      const oy = screenY - (b?.top || 0);
      return { x: (ox - pan.x) / zoom.value, y: (oy - pan.y) / zoom.value };
    }

    /* ----- Connection selection + delete ----- */
    const selectedConnectionId = ref(null);
    function selectConnection(conn, ev) {
      ev?.stopPropagation?.();
      selectedConnectionId.value = conn._id || conn.id;
    }

    function onKeyDown(ev) {
      if (ev.key !== 'Delete' && ev.key !== 'Backspace') return;
      const id = selectedConnectionId.value;
      if (!id) return;
      // Don't steal keypresses from inputs / modals.
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable)) return;
      ev.preventDefault();
      store.deleteConnection(id);
      selectedConnectionId.value = null;
    }

    /* ----- Toolbar: reset positions ----- */
    async function resetPositions() {
      const ok = window.confirm('Réinitialiser les positions à partir des niveaux ? Les placements manuels seront écrasés.');
      if (!ok) return;
      const seeded = computeLevelLayout();
      const list = props.company?.contacts || [];
      for (const c of list) {
        const id = contactId(c);
        const pos = seeded[id];
        if (!pos) continue;
        localPositions[id] = { x: pos.x, y: pos.y };
      }
      await Promise.all(list.map(c => {
        const id = contactId(c);
        const pos = seeded[id];
        if (!pos) return null;
        return store.updateContactPosition(id, pos.x, pos.y);
      }).filter(Boolean));
      fitToContent();
    }

    /* ----- Add contact CTA (empty state) ----- */
    function openAddContact() { store.modal = { type: 'contact-create' }; }

    /* ----- Lifecycle ----- */
    onMounted(async () => {
      await store.loadConnections(props.company?.slug);
      await ensureInitialLayout();
      // If nothing needed seeding, still fit to content so first view is centered.
      if (contacts.value.some(c => c._fx !== null)) fitToContent();
      window.addEventListener('keydown', onKeyDown);
    });

    onBeforeUnmount(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pointermove', onPanMove);
      window.removeEventListener('pointermove', onCardPointerMove);
      window.removeEventListener('pointermove', onHandlePointerMove);
    });

    // Reload connections when the active company changes.
    watch(() => props.company?.slug, async (slug, prev) => {
      if (!slug || slug === prev) return;
      // Clear per-company local overrides.
      for (const k of Object.keys(localPositions)) delete localPositions[k];
      await store.loadConnections(slug);
      await ensureInitialLayout();
    });

    /* ----- Template helpers ----- */
    function cardStyle(c) {
      if (c._fx === null) return { display: 'none' };
      return {
        transform: `translate(${c._fx}px, ${c._fy}px)`
      };
    }
    function connClass(conn) {
      const id = conn._id || conn.id;
      return {
        selected: selectedConnectionId.value === id
      };
    }

    return {
      canvasEl, pan, zoom, panning,
      contacts, connections: computed(() => store.connections),
      bezierPath, drawingPath,
      selectedConnectionId, selectConnection,
      onCanvasPointerDown, onWheel,
      zoomIn, zoomOut, fitToContent, resetPositions,
      onCardPointerDown, onHandlePointerDown,
      cardStyle, connClass, openAddContact,
      contactId, icons,
      dragging, drawing
    };
  },
  template: `
    <div class="freeform-canvas"
         ref="canvasEl"
         :class="{ panning }"
         @pointerdown="onCanvasPointerDown"
         @wheel="onWheel">

      <!-- Empty state (no contacts at all) -->
      <div v-if="!contacts.length" class="freeform-empty">
        <div class="freeform-empty-icon">
          <span v-html="icons.scatter"></span>
        </div>
        <h3>Ajoute des contacts pour commencer à les mapper</h3>
        <p>La vue Freeform révèle les relations réelles entre personnes.</p>
        <button class="btn btn-primary" @click="openAddContact">
          <span v-html="icons.plus"></span>
          Ajouter un contact
        </button>
      </div>

      <div v-else
           class="freeform-viewport"
           :style="{ transform: 'translate(' + pan.x + 'px, ' + pan.y + 'px) scale(' + zoom + ')' }">

        <!-- SVG layer for connections (sits under cards) -->
        <svg class="freeform-svg" xmlns="http://www.w3.org/2000/svg" overflow="visible">
          <defs>
            <marker id="freeform-arrow" viewBox="0 0 10 10"
                    refX="9" refY="5" markerWidth="7" markerHeight="7"
                    orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#9CA3AF" />
            </marker>
            <marker id="freeform-arrow-selected" viewBox="0 0 10 10"
                    refX="9" refY="5" markerWidth="7" markerHeight="7"
                    orient="auto-start-reverse">
              <path d="M 0 0 L 10 5 L 0 10 z" fill="#2563EB" />
            </marker>
          </defs>

          <path v-for="conn in connections"
                :key="conn._id || conn.id"
                class="freeform-connector"
                :class="connClass(conn)"
                :d="bezierPath(conn)"
                :marker-end="(selectedConnectionId === (conn._id || conn.id)) ? 'url(#freeform-arrow-selected)' : 'url(#freeform-arrow)'"
                @pointerdown.stop
                @click="selectConnection(conn, $event)" />

          <path v-if="drawing"
                class="freeform-connector drawing"
                :d="drawingPath"
                marker-end="url(#freeform-arrow-selected)" />
        </svg>

        <!-- Cards layer -->
        <div class="freeform-cards">
          <div v-for="c in contacts"
               :key="contactId(c)"
               class="freeform-card-wrapper"
               :class="{ dragging: dragging && dragging.id === contactId(c) }"
               :data-contact-id="contactId(c)"
               :style="cardStyle(c)"
               @dragstart.prevent
               @pointerdown="onCardPointerDown(c, $event)">
            <ContactCard :contact="c" />
            <!-- Connection handles (hover-visible via CSS) -->
            <span class="freeform-handle top"
                  @pointerdown="onHandlePointerDown(c, 'top', $event)"></span>
            <span class="freeform-handle right"
                  @pointerdown="onHandlePointerDown(c, 'right', $event)"></span>
            <span class="freeform-handle bottom"
                  @pointerdown="onHandlePointerDown(c, 'bottom', $event)"></span>
            <span class="freeform-handle left"
                  @pointerdown="onHandlePointerDown(c, 'left', $event)"></span>
          </div>
        </div>
      </div>

      <!-- Toolbar -->
      <div v-if="contacts.length" class="freeform-toolbar" @pointerdown.stop>
        <button type="button" title="Zoom arrière (−)" @click="zoomOut">−</button>
        <span class="zoom-level">{{ Math.round(zoom * 100) }}%</span>
        <button type="button" title="Zoom avant (+)" @click="zoomIn">+</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="Ajuster à l'écran" @click="fitToContent">Centrer</button>
        <span class="toolbar-sep"></span>
        <button type="button" title="Réinitialiser les positions depuis les niveaux" @click="resetPositions">Réinitialiser</button>
      </div>
    </div>
  `
};
