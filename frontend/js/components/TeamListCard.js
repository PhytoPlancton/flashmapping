// TeamListCard.js — Card single team dans la liste Settings > Équipes.
// Props: team { _id, name, slug, role, is_personal, members_count, companies_count }
//        active (bool) — true si c'est la team courante
import { computed } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, initialsOf, ROLE_LABELS } from '../store.js';

// Hash-based color palette for team avatars (deterministic per name).
const AVATAR_BG_PALETTE = [
  '#111827', '#1D4ED8', '#7C3AED', '#059669',
  '#DC2626', '#EA580C', '#0D9488', '#4F46E5',
  '#DB2777', '#B8860B', '#475569'
];

function hashName(str) {
  let h = 0;
  for (let i = 0; i < (str || '').length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

export default {
  name: 'TeamListCard',
  props: {
    team: { type: Object, required: true },
    active: { type: Boolean, default: false }
  },
  emits: ['switch', 'manage'],
  setup(props, { emit }) {
    const initials = computed(() => initialsOf(props.team?.name || '?'));
    const bg = computed(() => {
      const palette = AVATAR_BG_PALETTE;
      return palette[hashName(props.team?.name || '') % palette.length];
    });
    const membersCount = computed(() => props.team?.members_count ?? null);
    const companiesCount = computed(() => props.team?.companies_count ?? null);

    function onSwitch() { emit('switch', props.team); }
    function onManage() {
      if (props.team?.slug) location.hash = `#/settings/teams/${encodeURIComponent(props.team.slug)}`;
      emit('manage', props.team);
    }

    return { store, ROLE_LABELS, initials, bg, membersCount, companiesCount, onSwitch, onManage };
  },
  template: `
    <div class="team-list-card">
      <div class="team-list-card-avatar" :style="{ background: bg }">{{ initials }}</div>
      <div class="flex-1 min-w-0">
        <div class="flex items-center gap-2 flex-wrap">
          <div class="text-[14px] font-semibold truncate">{{ team.name }}</div>
          <span v-if="team.is_personal" class="team-badge team-badge-personal">Personnel</span>
          <span v-if="active" class="team-badge team-badge-active">ACTIVE</span>
        </div>
        <div class="text-[11px] text-ink-400 font-mono mt-0.5 truncate">{{ team.slug }}</div>
        <div class="flex items-center gap-2 mt-2 flex-wrap">
          <span class="role-chip" :class="'role-' + team.role">{{ ROLE_LABELS[team.role] || team.role }}</span>
          <span v-if="membersCount !== null" class="text-[11.5px] text-ink-500">
            {{ membersCount }} membre{{ membersCount > 1 ? 's' : '' }}
          </span>
          <span v-if="membersCount !== null && companiesCount !== null" class="text-ink-300">·</span>
          <span v-if="companiesCount !== null" class="text-[11.5px] text-ink-500">
            {{ companiesCount }} compte{{ companiesCount > 1 ? 's' : '' }}
          </span>
        </div>
      </div>
      <div class="flex items-center gap-2 shrink-0">
        <button v-if="!active" class="btn btn-secondary !text-[12px]" @click="onSwitch">Basculer</button>
        <button class="btn btn-secondary !text-[12px]" @click="onManage">Gérer →</button>
      </div>
    </div>
  `
};
