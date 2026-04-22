import { ref } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import * as api from '../api.js';
import { setToken, setStoredUser } from '../auth.js';
import { store } from '../store.js';

export default {
  name: 'Register',
  setup() {
    const email = ref('');
    const password = ref('');
    const name = ref('');
    const submitting = ref(false);
    const error = ref('');

    async function submit() {
      error.value = '';
      if (!email.value || !password.value || !name.value) {
        error.value = 'Tous les champs sont requis';
        return;
      }
      if (password.value.length < 6) {
        error.value = 'Mot de passe ≥ 6 caractères';
        return;
      }
      submitting.value = true;
      try {
        const res = await api.register(email.value.trim().toLowerCase(), password.value, name.value.trim());
        setToken(res.access_token);
        setStoredUser(res.user);
        store.user = res.user;
        store.bootstrapNeeded = false;
        await store.initTeams();
        if (store.teams.length === 0) {
          location.hash = '#/onboarding';
        } else {
          const t = store.pickInitialTeam();
          await store.switchTeam(t.slug);
        }
      } catch (e) {
        error.value = e.message || 'Erreur lors de la création';
      } finally {
        submitting.value = false;
      }
    }

    function goLogin() { location.hash = '#/login'; }

    return { email, password, name, submitting, error, submit, goLogin, store };
  },
  template: `
    <div class="min-h-screen flex items-center justify-center bg-[#FAFAFA] px-4">
      <div class="w-full max-w-sm">
        <div class="mb-8 text-center">
          <div class="inline-flex items-center gap-2 mb-3">
            <div class="w-9 h-9 rounded-lg bg-ink-900 text-white flex items-center justify-center font-semibold">M</div>
          </div>
          <h1 class="text-xl font-semibold tracking-tight">Créer le premier compte</h1>
          <p class="text-ink-500 text-xs mt-1">Ce compte sera admin par défaut</p>
        </div>

        <div class="bg-white border border-ink-200 rounded-xl p-6 shadow-card">
          <form @submit.prevent="submit" class="space-y-4">
            <div>
              <label class="label">Nom complet</label>
              <input class="input" v-model="name" placeholder="Nicolas Monniot" />
            </div>
            <div>
              <label class="label">Email</label>
              <input class="input" type="email" v-model="email" placeholder="you@muchbetter.ai" />
            </div>
            <div>
              <label class="label">Mot de passe</label>
              <input class="input" type="password" v-model="password" placeholder="Minimum 6 caractères" />
            </div>
            <div v-if="error" class="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {{ error }}
            </div>
            <button type="submit" class="btn btn-primary w-full justify-center" :disabled="submitting">
              {{ submitting ? 'Création…' : 'Créer le compte' }}
            </button>
          </form>

          <div class="mt-4 pt-4 border-t border-ink-100 text-center">
            <button class="btn btn-ghost w-full justify-center text-xs" @click="goLogin">
              ← Retour à la connexion
            </button>
          </div>
        </div>
      </div>
    </div>
  `
};
