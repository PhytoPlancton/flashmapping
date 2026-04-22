import { computed, ref } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, LEVEL_LABELS } from '../store.js';
import ContactCard from './ContactCard.js';

export default {
  name: 'OrgTree',
  components: { ContactCard },
  props: {
    company: { type: Object, required: true }
  },
  setup(props) {
    const hoverLevel = ref(null);

    const contactsByLevel = computed(() => {
      const map = { 1: [], 2: [], 3: [], 4: [], 5: [], 6: [] };
      for (const c of (props.company.contacts || [])) {
        const lvl = Number(c.level) || 6;
        if (!map[lvl]) map[lvl] = [];
        map[lvl].push(c);
      }
      for (const k of Object.keys(map)) {
        map[k].sort((a, b) => (a.position_in_level ?? 0) - (b.position_in_level ?? 0));
      }
      return map;
    });

    const level6Count = computed(() => contactsByLevel.value[6]?.length || 0);

    function levelLabel(lvl) { return LEVEL_LABELS[lvl] || `Niveau ${lvl}`; }

    function openAddAtLevel(lvl) {
      // Pre-compute next position in level so the new contact appears at the right
      const arr = contactsByLevel.value[lvl] || [];
      const nextPos = arr.length
        ? Math.max(...arr.map(c => c.position_in_level ?? 0)) + 1
        : 0;
      store.modal = {
        type: 'contact-create',
        payload: { level: lvl, position_in_level: nextPos }
      };
    }

    /* ---- Drag & drop ---- */
    function onDragOver(ev, lvl) {
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'move';
      hoverLevel.value = lvl;
    }
    function onDragLeave(ev, lvl) {
      if (hoverLevel.value === lvl) hoverLevel.value = null;
    }

    function computeDropPosition(ev, lvl) {
      // Find the closest sibling card horizontally inside the cards-row
      const row = ev.currentTarget.querySelector('.cards-row');
      if (!row) return 0;
      const cards = [...row.querySelectorAll('[data-contact-id]')];
      const draggedId = window.__draggedContact?.id;
      let insertIndex = cards.length;
      for (let i = 0; i < cards.length; i++) {
        const el = cards[i];
        if (el.getAttribute('data-contact-id') === draggedId) continue;
        const rect = el.getBoundingClientRect();
        const mid = rect.left + rect.width / 2;
        if (ev.clientX < mid) { insertIndex = i; break; }
      }
      return insertIndex;
    }

    async function onDrop(ev, lvl) {
      ev.preventDefault();
      hoverLevel.value = null;
      const dragged = window.__draggedContact;
      if (!dragged) return;

      const insertIndex = computeDropPosition(ev, lvl);

      // Optimistic local mutation
      const contacts = [...(props.company.contacts || [])];
      const c = contacts.find(x => x._id === dragged.id);
      if (!c) return;

      // Remove from its current level
      const sameLevel = contacts.filter(x => x.level === c.level && x._id !== c.id);
      const newLevelArr = lvl === c.level
        ? sameLevel.filter(x => x._id !== c.id)
        : contacts.filter(x => x.level === lvl && x._id !== c.id);

      // Reshuffle positions in UI (store refresh happens after API)
      c.level = lvl;
      c.position_in_level = insertIndex;

      await store.moveContact(dragged.id, lvl, insertIndex);
    }

    return {
      store, contactsByLevel, level6Count, hoverLevel,
      levelLabel, openAddAtLevel,
      onDragOver, onDragLeave, onDrop
    };
  },
  template: `
    <div class="px-7 py-6 tree-host">
      <div v-for="lvl in [1,2,3,4,5]" :key="lvl"
           class="level-row"
           :class="{ 'drop-active': hoverLevel === lvl }"
           @dragover="onDragOver($event, lvl)"
           @dragleave="onDragLeave($event, lvl)"
           @drop="onDrop($event, lvl)">
        <div class="level-label">
          {{ levelLabel(lvl) }}
          <span class="count">· {{ contactsByLevel[lvl]?.length || 0 }}</span>
        </div>
        <div class="cards-row">
          <ContactCard v-for="c in contactsByLevel[lvl]" :key="c._id" :contact="c" />
          <button class="add-level-slot"
                  :class="{ 'empty-only': !contactsByLevel[lvl] || contactsByLevel[lvl].length === 0 }"
                  @click="openAddAtLevel(lvl)">
            <span class="plus" aria-hidden="true">+</span>
            <span class="label-txt">Ajouter à ce niveau</span>
          </button>
        </div>
      </div>

      <div class="pt-3">
        <button class="btn btn-secondary" @click="store.showLevel6 = !store.showLevel6">
          {{ store.showLevel6 ? 'Masquer' : 'Afficher' }} niveau 6 — IC / Other
          <span class="text-ink-400 tabular-nums ml-1">({{ level6Count }})</span>
        </button>
      </div>

      <div v-if="store.showLevel6"
           class="level-row mt-3"
           :class="{ 'drop-active': hoverLevel === 6 }"
           @dragover="onDragOver($event, 6)"
           @dragleave="onDragLeave($event, 6)"
           @drop="onDrop($event, 6)">
        <div class="level-label">
          {{ levelLabel(6) }}
          <span class="count">· {{ level6Count }}</span>
        </div>
        <div class="cards-row">
          <ContactCard v-for="c in contactsByLevel[6]" :key="c._id" :contact="c" />
          <button class="add-level-slot"
                  :class="{ 'empty-only': level6Count === 0 }"
                  @click="openAddAtLevel(6)">
            <span class="plus" aria-hidden="true">+</span>
            <span class="label-txt">Ajouter à ce niveau</span>
          </button>
        </div>
      </div>
    </div>
  `
};
