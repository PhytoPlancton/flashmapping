import { ref, reactive, onMounted } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import * as api from '../api.js';
import { icons } from '../icons.js';

export default {
  name: 'InviteModal',
  emits: ['close', 'created'],
  setup(props, { emit }) {
    const form = reactive({
      role: 'member',
      expires_in_days: 30,
      max_uses: 1
    });
    const submitting = ref(false);
    const error = ref('');
    const createdCode = ref('');

    function close() { emit('close'); }
    function onBackdrop(ev) { if (ev.target === ev.currentTarget) close(); }

    async function submit() {
      error.value = '';
      // Team slug priority: modal payload (set by TeamDetailTab) > currentTeam.
      const slug = (store.modal?.payload?.teamSlug) || store.currentTeam?.slug;
      if (!slug) { error.value = 'Aucune équipe'; return; }
      submitting.value = true;
      try {
        const inv = await api.createInvite(slug, {
          role: form.role,
          expires_in_days: Number(form.expires_in_days) || 30,
          max_uses: Number(form.max_uses) || 1
        });
        createdCode.value = inv.code;
        emit('created', inv);
      } catch (e) {
        error.value = e.message || 'Échec';
      } finally {
        submitting.value = false;
      }
    }

    async function copyCode() {
      try {
        await navigator.clipboard.writeText(createdCode.value);
        store.toast('Code copié', 'success');
      } catch (e) {
        store.toast('Impossible de copier', 'error');
      }
    }

    onMounted(() => {
      const esc = (ev) => { if (ev.key === 'Escape') close(); };
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    });

    return { form, submitting, error, submit, close, onBackdrop, icons, createdCode, copyCode };
  },
  template: `
    <div class="modal-backdrop" @mousedown="onBackdrop">
      <div class="modal-panel" style="max-width: 440px;">
        <div class="flex items-center justify-between px-6 py-4 border-b border-ink-100">
          <h3 class="text-[15px] font-semibold">Créer une invitation</h3>
          <button class="card-action-btn" @click="close">
            <span v-html="icons.close"></span>
          </button>
        </div>

        <div v-if="!createdCode" class="p-6 space-y-4">
          <form @submit.prevent="submit" class="space-y-4">
            <div>
              <label class="label">Rôle</label>
              <select class="select" v-model="form.role">
                <option value="member">Membre</option>
                <option value="admin">Admin</option>
              </select>
            </div>
            <div class="grid grid-cols-2 gap-4">
              <div>
                <label class="label">Expire dans (jours)</label>
                <input class="input" type="number" min="1" max="365" v-model.number="form.expires_in_days" />
              </div>
              <div>
                <label class="label">Utilisations max</label>
                <input class="input" type="number" min="1" v-model.number="form.max_uses" />
              </div>
            </div>
            <div v-if="error" class="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {{ error }}
            </div>
            <div class="flex items-center justify-end gap-2 pt-2">
              <button type="button" class="btn btn-ghost" @click="close">Annuler</button>
              <button type="submit" class="btn btn-primary" :disabled="submitting">
                {{ submitting ? 'Génération…' : 'Générer le code' }}
              </button>
            </div>
          </form>
        </div>

        <div v-else class="p-6 space-y-4">
          <p class="text-[13px] text-ink-600">
            Invitation créée. Partage ce code avec la personne à inviter.
          </p>
          <div class="flex items-center gap-2">
            <code class="flex-1 text-center text-[17px] bg-ink-50 border border-ink-200 rounded-md py-3 font-mono tracking-[0.15em]">
              {{ createdCode }}
            </code>
            <button class="btn btn-secondary" @click="copyCode">Copier</button>
          </div>
          <div class="flex items-center justify-end gap-2 pt-2">
            <button type="button" class="btn btn-primary" @click="close">Fermer</button>
          </div>
        </div>
      </div>
    </div>
  `
};
