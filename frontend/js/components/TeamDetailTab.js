// TeamDetailTab.js — Détail d'une team (wireframe §3.2).
// Breadcrumb + header + Informations + Membres + Invitations + Zone dangereuse.
// Extrait + refactor du contenu de l'onglet "Équipe" du Settings.js original.
import { ref, reactive, computed, onMounted, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, initialsOf, ROLE_LABELS } from '../store.js';
import * as api from '../api.js';
import { icons } from '../icons.js';

export default {
  name: 'TeamDetailTab',
  props: {
    slug: { type: String, required: true }
  },
  setup(props) {
    const team = ref(null);
    const loading = ref(false);
    const teamName = ref('');
    const editingName = ref(false);
    const savingName = ref(false);

    const members = ref([]);
    const invites = ref([]);
    const loadingTeam = ref(false);

    const deleteConfirmText = ref('');
    const deleting = ref(false);

    const isCurrentTeam = computed(() => store.currentTeam?.slug === props.slug);
    const role = computed(() => team.value?.role || null);
    const isOwner = computed(() => role.value === 'owner');
    const isAdmin = computed(() => role.value === 'owner' || role.value === 'admin');
    const isPersonal = computed(() => !!team.value?.is_personal);

    async function loadTeam() {
      loading.value = true;
      try {
        // Prefer store.teams (faster), fall back to API.
        const fromStore = (store.teams || []).find(t => t.slug === props.slug);
        if (fromStore) {
          team.value = { ...fromStore };
        } else {
          team.value = await api.getTeam(props.slug);
        }
        teamName.value = team.value?.name || '';
      } catch (e) {
        store.toast(e.message || 'Équipe introuvable', 'error');
        team.value = null;
      } finally {
        loading.value = false;
      }
    }

    async function loadMembersAndInvites() {
      if (!props.slug) return;
      loadingTeam.value = true;
      try {
        members.value = await api.listMembers(props.slug).catch(() => []);
        if (isAdmin.value) {
          invites.value = await api.listInvites(props.slug).catch(() => []);
        } else {
          invites.value = [];
        }
      } finally {
        loadingTeam.value = false;
      }
    }

    watch(() => props.slug, async () => {
      await loadTeam();
      await loadMembersAndInvites();
    });

    onMounted(async () => {
      await loadTeam();
      await loadMembersAndInvites();
    });

    const currentUserId = computed(() => store.user?._id || store.user?.id);
    const sortedMembers = computed(() => {
      const order = { owner: 0, admin: 1, member: 2 };
      return [...(members.value || [])].sort((a, b) => (order[a.role] ?? 9) - (order[b.role] ?? 9));
    });

    async function switchToThisTeam() {
      if (isCurrentTeam.value) return;
      await store.switchTeam(props.slug, { navigate: false });
      store.toast(`Équipe active : ${team.value?.name || props.slug}`, 'info');
    }

    async function saveTeamName() {
      const name = teamName.value.trim();
      if (!name) { store.toast('Nom requis', 'error'); return; }
      savingName.value = true;
      try {
        const t = await api.patchTeam(props.slug, { name });
        const idx = store.teams.findIndex(x => x.slug === props.slug);
        if (idx >= 0) store.teams[idx] = { ...store.teams[idx], ...t };
        if (store.currentTeam?.slug === props.slug) {
          store.setCurrentTeam({ ...store.currentTeam, ...t });
        }
        team.value = { ...team.value, ...t };
        editingName.value = false;
        store.toast('Équipe renommée', 'success');
      } catch (e) {
        store.toast(e.message || 'Échec mise à jour', 'error');
      } finally {
        savingName.value = false;
      }
    }

    async function changeMemberRole(m, r) {
      try {
        await api.patchMember(props.slug, m.user_id || m._id, { role: r });
        store.toast('Rôle mis à jour', 'success');
        await loadMembersAndInvites();
      } catch (e) { store.toast(e.message || 'Échec', 'error'); }
    }

    async function removeMember(m) {
      if (!confirm(`Retirer ${m.name || m.email} de l\u2019équipe ?`)) return;
      try {
        await api.removeMember(props.slug, m.user_id || m._id);
        store.toast('Membre retiré', 'success');
        await loadMembersAndInvites();
      } catch (e) { store.toast(e.message || 'Échec', 'error'); }
    }

    function openCreateInvite() {
      store.modal = { type: 'invite-create', payload: { teamSlug: props.slug } };
    }

    // Re-fetch invites when the invite modal closes.
    watch(() => store.modal?.type, (cur, prev) => {
      if (prev === 'invite-create' && cur !== 'invite-create') {
        loadMembersAndInvites();
      }
    });

    async function copyInvite(code) {
      try {
        await navigator.clipboard.writeText(code);
        store.toast('Code copié', 'success');
      } catch (e) { store.toast('Impossible de copier', 'error'); }
    }

    async function revokeInvite(inv) {
      if (!confirm('Révoquer cette invitation ? Le code ne fonctionnera plus.')) return;
      try {
        await api.revokeInvite(props.slug, inv._id || inv.id);
        store.toast('Invitation révoquée', 'success');
        await loadMembersAndInvites();
      } catch (e) { store.toast(e.message || 'Échec', 'error'); }
    }

    async function leaveTeam() {
      if (isPersonal.value) return; // locked
      if (!confirm(`Quitter l\u2019équipe "${team.value?.name}" ?`)) return;
      try {
        await api.removeMember(props.slug, store.user?._id || store.user?.id);
        store.toast('Tu as quitté l\u2019équipe', 'success');
        await store.initTeams();
        // Go back to the teams list.
        location.hash = '#/settings/teams';
      } catch (e) { store.toast(e.message || 'Échec', 'error'); }
    }

    async function deleteTeam() {
      if (isPersonal.value) return; // locked
      const name = team.value?.name;
      if (deleteConfirmText.value.trim() !== name) {
        store.toast('Tape le nom exact pour confirmer', 'error');
        return;
      }
      deleting.value = true;
      try {
        await api.deleteTeam(props.slug);
        store.toast('Équipe supprimée', 'success');
        deleteConfirmText.value = '';
        await store.initTeams();
        if (store.teams.length === 0) {
          store.currentTeam = null; store.userRole = null;
          location.hash = '#/onboarding';
        } else {
          location.hash = '#/settings/teams';
        }
      } catch (e) { store.toast(e.message || 'Échec suppression', 'error'); }
      finally { deleting.value = false; }
    }

    const initials = computed(() => initialsOf(team.value?.name || '?'));

    return {
      icons, store, ROLE_LABELS, initialsOf,
      team, loading, loadingTeam, isCurrentTeam, isPersonal, isOwner, isAdmin, role,
      teamName, editingName, savingName, saveTeamName,
      members, invites, sortedMembers, currentUserId,
      changeMemberRole, removeMember,
      openCreateInvite, copyInvite, revokeInvite,
      leaveTeam, deleteTeam, deleteConfirmText, deleting,
      switchToThisTeam, initials
    };
  },
  template: `
    <div style="max-width:768px">
      <!-- Breadcrumb -->
      <div class="text-[12px] text-ink-500 mb-3">
        <a href="#/settings/profile" class="hover:text-ink-900">Paramètres</a>
        <span class="mx-1 text-ink-300">/</span>
        <a href="#/settings/teams" class="hover:text-ink-900">Équipes</a>
        <span class="mx-1 text-ink-300">/</span>
        <span class="text-ink-900">{{ team?.name || slug }}</span>
      </div>

      <div v-if="loading" class="text-[12.5px] text-ink-400">Chargement…</div>

      <div v-else-if="team" class="space-y-6">
        <!-- Header -->
        <div class="flex items-center gap-3 flex-wrap">
          <div class="team-list-card-avatar" style="width:44px; height:44px; font-size:14px;">{{ initials }}</div>
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-2 flex-wrap">
              <div class="text-[17px] font-semibold">{{ team.name }}</div>
              <span v-if="isPersonal" class="team-badge team-badge-personal">Personnel</span>
              <span v-if="isCurrentTeam" class="team-badge team-badge-active">ACTIVE</span>
              <span class="role-chip" :class="'role-' + role">{{ ROLE_LABELS[role] || role }}</span>
            </div>
            <div class="text-[11px] text-ink-400 font-mono mt-0.5">{{ team.slug }}</div>
          </div>
          <button v-if="!isCurrentTeam" class="btn btn-secondary !text-[12px]" @click="switchToThisTeam">
            Basculer sur cette équipe
          </button>
        </div>

        <!-- Informations -->
        <section class="settings-card">
          <h2 class="settings-card-title">Informations</h2>
          <div class="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label class="label">Nom de l\u2019équipe</label>
              <div v-if="!editingName" class="flex items-center gap-2">
                <span class="text-[13.5px]">{{ team.name }}</span>
                <button v-if="isAdmin && !isPersonal" class="card-action-btn"
                        @click="editingName = true; teamName = team.name">
                  <span v-html="icons.pencil"></span>
                </button>
              </div>
              <form v-else @submit.prevent="saveTeamName" class="flex items-center gap-2">
                <input class="input flex-1" v-model="teamName" />
                <button type="submit" class="btn btn-primary" :disabled="savingName">OK</button>
                <button type="button" class="btn btn-ghost" @click="editingName = false">Annuler</button>
              </form>
            </div>
            <div>
              <label class="label">Slug</label>
              <div class="text-[13px] text-ink-500 font-mono">{{ team.slug }}</div>
            </div>
          </div>
        </section>

        <!-- Membres -->
        <section class="settings-card">
          <div class="flex items-center justify-between mb-3">
            <h2 class="settings-card-title !mb-0">Membres</h2>
            <span class="text-[11px] text-ink-400 tabular-nums">{{ sortedMembers.length }}</span>
          </div>
          <div v-if="loadingTeam" class="text-[12px] text-ink-400">Chargement…</div>
          <div v-else-if="!sortedMembers.length" class="py-4 text-[12px] text-ink-400">
            Aucun membre — invite quelqu\u2019un pour démarrer.
          </div>
          <div v-else class="divide-y divide-ink-100">
            <div v-for="m in sortedMembers" :key="m.user_id || m._id" class="member-row">
              <div class="team-avatar sm shrink-0">{{ initialsOf(m.name || m.email) }}</div>
              <div class="flex-1 min-w-0">
                <div class="text-[13px] font-medium truncate">
                  {{ m.name || m.email }}
                  <span v-if="(m.user_id || m._id) === currentUserId" class="text-[10.5px] text-ink-400 font-normal ml-1">(toi)</span>
                </div>
                <div class="text-[11px] text-ink-400 truncate">{{ m.email }}</div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <template v-if="isAdmin && m.role !== 'owner' && (m.user_id || m._id) !== currentUserId">
                  <select class="select !py-1 !text-[11.5px] !w-[100px]"
                          :value="m.role"
                          @change="changeMemberRole(m, $event.target.value)">
                    <option value="admin">Admin</option>
                    <option value="member">Membre</option>
                  </select>
                  <button class="btn btn-danger !px-2 !py-1 !text-[11px]" @click="removeMember(m)">Retirer</button>
                </template>
                <span v-else class="role-chip" :class="'role-' + m.role">
                  {{ ROLE_LABELS[m.role] || m.role }}
                </span>
              </div>
            </div>
          </div>
        </section>

        <!-- Invitations -->
        <section v-if="isAdmin && !isPersonal" class="settings-card">
          <div class="flex items-center justify-between mb-3">
            <h2 class="settings-card-title !mb-0">Invitations actives</h2>
            <button class="btn btn-secondary" @click="openCreateInvite">
              <span v-html="icons.plus"></span>
              Créer une invitation
            </button>
          </div>
          <div v-if="loadingTeam" class="text-[12px] text-ink-400">Chargement…</div>
          <div v-else class="divide-y divide-ink-100">
            <div v-for="inv in invites" :key="inv._id || inv.id" class="invite-row">
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-2">
                  <code class="text-[13px] bg-ink-50 border border-ink-200 px-2 py-0.5 rounded font-mono tracking-wider">{{ inv.code }}</code>
                  <span class="role-chip" :class="'role-' + inv.role">{{ ROLE_LABELS[inv.role] || inv.role }}</span>
                </div>
                <div class="text-[11px] text-ink-400 mt-1">
                  <span v-if="inv.expires_at">Expire le {{ new Date(inv.expires_at).toLocaleDateString('fr-FR') }}</span>
                  <span v-if="inv.max_uses"> · {{ inv.uses || 0 }} / {{ inv.max_uses }} utilisations</span>
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                <button class="btn btn-secondary !px-2 !py-1 !text-[11px]" @click="copyInvite(inv.code)">Copier</button>
                <button class="btn btn-danger !px-2 !py-1 !text-[11px]" @click="revokeInvite(inv)">Révoquer</button>
              </div>
            </div>
            <div v-if="!invites.length" class="py-4 text-[12px] text-ink-400">Aucune invitation active.</div>
          </div>
        </section>

        <!-- Zone dangereuse -->
        <section class="settings-card border-red-100 bg-red-50/30">
          <h2 class="settings-card-title text-red-700">Zone dangereuse</h2>

          <div v-if="isPersonal" class="flex items-start gap-2 text-[12.5px] text-ink-600">
            <span class="text-ink-400 shrink-0">ℹ️</span>
            <div>Cet espace personnel ne peut pas être supprimé ni quitté.</div>
          </div>

          <div v-else-if="!isOwner" class="flex items-center justify-between">
            <div>
              <div class="text-[13px] font-medium">Quitter l\u2019équipe</div>
              <p class="text-[12px] text-ink-500">Tu perdras l\u2019accès à toutes les données de cette équipe.</p>
            </div>
            <button class="btn btn-danger" @click="leaveTeam">Quitter l\u2019équipe</button>
          </div>

          <div v-else class="space-y-3">
            <div class="text-[13px] font-medium text-red-700">Supprimer l\u2019équipe</div>
            <p class="text-[12px] text-ink-600">
              Cette action est <strong>irréversible</strong>. Tous les comptes et contacts seront définitivement supprimés.
              Pour confirmer, tape le nom exact : <code class="bg-white border border-ink-200 px-1 py-0.5 rounded font-mono">{{ team.name }}</code>
            </p>
            <div class="flex items-center gap-2">
              <input class="input flex-1" v-model="deleteConfirmText" :placeholder="team.name" />
              <button class="btn btn-danger" @click="deleteTeam"
                      :disabled="deleting || deleteConfirmText.trim() !== team.name">
                {{ deleting ? 'Suppression…' : 'Supprimer' }}
              </button>
            </div>
          </div>
        </section>
      </div>

      <div v-else class="text-[13px] text-ink-500">
        Équipe introuvable.
        <a href="#/settings/teams" class="text-ink-900 underline ml-1">Retour à la liste</a>
      </div>
    </div>
  `
};
