// ProfileTab.js — Contenu du tab "Profil".
// Extrait du composant Settings.js existant : identité (nom/email),
// mot de passe, session (logout). Style Notion : sections avec titres,
// max-width 640px, espace généreux.
import { ref, reactive, watch } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import * as api from '../api.js';
import { setStoredUser } from '../auth.js';

export default {
  name: 'ProfileTab',
  setup() {
    const profile = reactive({
      name: store.user?.name || '',
      email: store.user?.email || ''
    });
    const savingProfile = ref(false);

    watch(() => store.user, (u) => {
      profile.name = u?.name || '';
      profile.email = u?.email || '';
    });

    async function saveProfile() {
      savingProfile.value = true;
      try {
        const body = {};
        if (profile.name && profile.name !== store.user?.name) body.name = profile.name.trim();
        if (profile.email && profile.email !== store.user?.email) body.email = profile.email.trim().toLowerCase();
        if (Object.keys(body).length === 0) {
          store.toast('Aucun changement', 'info');
          return;
        }
        if (body.email && !confirm('Confirmer le changement d\u2019email ? Tu devras te reconnecter avec cette adresse.')) {
          return;
        }
        const u = await api.updateProfile(body);
        store.user = u;
        setStoredUser(u);
        store.toast('Profil mis à jour', 'success');
      } catch (e) {
        store.toast(e.message || 'Échec mise à jour', 'error');
      } finally {
        savingProfile.value = false;
      }
    }

    const pw = reactive({ current: '', next: '', confirm: '' });
    const savingPw = ref(false);
    async function changePw() {
      if (!pw.current || !pw.next) {
        store.toast('Remplis les deux champs de mot de passe', 'error');
        return;
      }
      if (pw.next.length < 6) {
        store.toast('Le nouveau mot de passe doit faire 6 caractères minimum', 'error');
        return;
      }
      if (pw.next !== pw.confirm) {
        store.toast('Les deux mots de passe ne correspondent pas', 'error');
        return;
      }
      savingPw.value = true;
      try {
        await api.changePassword({ current_password: pw.current, new_password: pw.next });
        pw.current = ''; pw.next = ''; pw.confirm = '';
        store.toast('Mot de passe changé', 'success');
      } catch (e) {
        store.toast(e.message || 'Échec changement mot de passe', 'error');
      } finally {
        savingPw.value = false;
      }
    }

    return { store, profile, savingProfile, saveProfile, pw, savingPw, changePw };
  },
  template: `
    <div class="space-y-6" style="max-width:640px">
      <section class="settings-card">
        <h2 class="settings-card-title">Identité</h2>
        <form @submit.prevent="saveProfile" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label class="label">Nom</label>
            <input class="input" v-model="profile.name" />
          </div>
          <div>
            <label class="label">Email</label>
            <input class="input" type="email" v-model="profile.email" />
          </div>
          <div class="sm:col-span-2 flex justify-end">
            <button type="submit" class="btn btn-primary" :disabled="savingProfile">
              {{ savingProfile ? 'Enregistrement…' : 'Enregistrer' }}
            </button>
          </div>
        </form>
      </section>

      <section class="settings-card">
        <h2 class="settings-card-title">Mot de passe</h2>
        <form @submit.prevent="changePw" class="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div class="sm:col-span-2">
            <label class="label">Mot de passe actuel</label>
            <input class="input" type="password" v-model="pw.current" autocomplete="current-password" />
          </div>
          <div>
            <label class="label">Nouveau mot de passe</label>
            <input class="input" type="password" v-model="pw.next" autocomplete="new-password" />
          </div>
          <div>
            <label class="label">Confirmer</label>
            <input class="input" type="password" v-model="pw.confirm" autocomplete="new-password" />
          </div>
          <div class="sm:col-span-2 flex justify-end">
            <button type="submit" class="btn btn-primary" :disabled="savingPw">
              {{ savingPw ? 'Mise à jour…' : 'Changer le mot de passe' }}
            </button>
          </div>
        </form>
      </section>

      <section class="settings-card">
        <h2 class="settings-card-title">Session</h2>
        <p class="text-[12.5px] text-ink-500 mb-3">Ferme ta session sur cet appareil.</p>
        <button class="btn btn-danger" @click="store.logout()">Se déconnecter</button>
      </section>
    </div>
  `
};
