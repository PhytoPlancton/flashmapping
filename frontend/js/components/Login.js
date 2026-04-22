import { ref } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import * as api from '../api.js';
import { setToken, setStoredUser } from '../auth.js';
import { store } from '../store.js';

export default {
  name: 'Login',
  setup() {
    const email = ref('');
    const password = ref('');
    const submitting = ref(false);
    const error = ref('');

    async function submit() {
      error.value = '';
      if (!email.value || !password.value) {
        error.value = 'Email et mot de passe requis';
        return;
      }
      submitting.value = true;
      try {
        const res = await api.login(email.value.trim().toLowerCase(), password.value);
        setToken(res.access_token);
        setStoredUser(res.user);
        store.user = res.user;
        await store.initTeams();
        if (store.teams.length === 0) {
          location.hash = '#/onboarding';
        } else {
          const t = store.pickInitialTeam();
          await store.switchTeam(t.slug);
        }
      } catch (e) {
        error.value = e.message || 'Identifiants invalides';
      } finally {
        submitting.value = false;
      }
    }

    function goRegister() { location.hash = '#/register'; }

    return { email, password, submitting, error, submit, goRegister, store };
  },
  template: `
    <div class="min-h-screen flex items-center justify-center bg-[#FAFAFA] px-4">
      <div class="w-full max-w-sm">
        <div class="mb-8 text-center">
          <div class="inline-flex items-center gap-2 mb-3">
            <div class="w-9 h-9 rounded-lg bg-ink-900 text-white flex items-center justify-center font-semibold">M</div>
          </div>
          <h1 class="text-xl font-semibold tracking-tight">FlashMapping</h1>
          <p class="text-ink-500 text-xs mt-1">muchbetter.ai · Account mapping tool</p>
        </div>

        <div class="bg-white border border-ink-200 rounded-xl p-6 shadow-card">
          <form @submit.prevent="submit" class="space-y-4">
            <div>
              <label class="label">Email</label>
              <input class="input" type="email" autocomplete="username"
                     v-model="email" placeholder="you@muchbetter.ai" autofocus />
            </div>
            <div>
              <label class="label">Mot de passe</label>
              <input class="input" type="password" autocomplete="current-password"
                     v-model="password" placeholder="••••••••" />
            </div>
            <div v-if="error" class="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
              {{ error }}
            </div>
            <button type="submit" class="btn btn-primary w-full justify-center" :disabled="submitting">
              {{ submitting ? 'Connexion…' : 'Se connecter' }}
            </button>
          </form>

          <div v-if="store.bootstrapNeeded" class="mt-4 pt-4 border-t border-ink-100 text-center">
            <p class="text-xs text-ink-500 mb-2">Première utilisation ?</p>
            <button class="btn btn-secondary w-full justify-center" @click="goRegister">
              Créer le premier compte
            </button>
          </div>
        </div>

        <p class="text-xs text-ink-400 text-center mt-6">
          Local-first · JWT 24h · muchbetter.ai × TechToMed
        </p>
      </div>
    </div>
  `
};
