import { ref, reactive, onMounted } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store } from '../store.js';
import { icons } from '../icons.js';

const PRIORITIES = ['', 'P1+', 'P1', 'P2', 'P3'];

function slugify(s) {
  return (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

export default {
  name: 'CompanyModal',
  props: {
    mode: { type: String, required: true },  // 'create' | 'edit'
    initial: { type: Object, default: () => ({}) }
  },
  emits: ['close'],
  setup(props, { emit }) {
    const form = reactive({
      name: props.initial.name || '',
      slug: props.initial.slug || '',
      domain: props.initial.domain || '',
      linkedin_url: props.initial.linkedin_url || '',
      priority: props.initial.priority || '',
      pic: props.initial.pic || '',
      crm_id: props.initial.crm_id || '',
      crm_status: props.initial.crm_status || '',
      work_status: props.initial.work_status || '',
      next_step: props.initial.next_step || '',
      industry: props.initial.industry || 'Pharmaceuticals',
      headcount: props.initial.headcount || null,
      hq: props.initial.hq || '',
      country: props.initial.country || '',
      therapeutic_areas: (props.initial.therapeutic_areas || []).join(', '),
      comments_crm: props.initial.comments_crm || '',
      // Optional folder pre-selection (passed via store.modal.payload.folder_id
      // when opened from an empty folder's "+ Ajouter un compte" or from
      // FolderCreateInline auto-flow).
      folder_id: props.initial.folder_id || null
    });

    const submitting = ref(false);
    const error = ref('');

    function close() { emit('close'); }
    function onBackdrop(ev) { if (ev.target === ev.currentTarget) close(); }

    function autoSlug() {
      if (props.mode === 'create' && !form.slug) form.slug = slugify(form.name);
    }

    async function submit() {
      error.value = '';
      if (!form.name.trim()) { error.value = 'Nom requis'; return; }
      if (!form.slug.trim()) form.slug = slugify(form.name);
      submitting.value = true;

      const payload = {
        ...form,
        headcount: form.headcount ? Number(form.headcount) : null,
        therapeutic_areas: form.therapeutic_areas
          ? form.therapeutic_areas.split(',').map(s => s.trim()).filter(Boolean)
          : []
      };
      // Strip folder_id if null so we don't send it on create unnecessarily;
      // backend accepts its presence but cleaner payload if empty.
      if (!payload.folder_id) delete payload.folder_id;

      let ok = null;
      if (props.mode === 'create') {
        ok = await store.createCompany(payload);
      } else {
        ok = await store.updateCompany(props.initial._id, payload);
      }

      submitting.value = false;
      if (ok) close();
    }

    onMounted(() => {
      const esc = (ev) => { if (ev.key === 'Escape') close(); };
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    });

    return { form, submitting, error, submit, close, onBackdrop, autoSlug, PRIORITIES, icons };
  },
  template: `
    <div class="modal-backdrop" @mousedown="onBackdrop">
      <div class="modal-panel">
        <div class="flex items-center justify-between px-6 py-4 border-b border-ink-100">
          <h3 class="text-[15px] font-semibold">
            {{ mode === 'create' ? 'Nouveau compte' : 'Éditer le compte' }}
          </h3>
          <button class="card-action-btn" @click="close">
            <span v-html="icons.close"></span>
          </button>
        </div>

        <form @submit.prevent="submit" class="p-6 space-y-4">
          <div class="grid grid-cols-2 gap-4">
            <div class="col-span-2">
              <label class="label">Nom *</label>
              <input class="input" v-model="form.name" @blur="autoSlug" placeholder="Sanofi France" />
            </div>
            <div>
              <label class="label">Slug</label>
              <input class="input" v-model="form.slug" :disabled="mode === 'edit'" placeholder="sanofi_france" />
            </div>
            <div>
              <label class="label">Priorité</label>
              <select class="select" v-model="form.priority">
                <option v-for="p in PRIORITIES" :key="p" :value="p">{{ p || '—' }}</option>
              </select>
            </div>
            <div>
              <label class="label">Domaine</label>
              <input class="input" v-model="form.domain" placeholder="sanofi.com" />
            </div>
            <div>
              <label class="label">LinkedIn</label>
              <input class="input" v-model="form.linkedin_url" />
            </div>
            <div>
              <label class="label">PIC (owner)</label>
              <input class="input" v-model="form.pic" placeholder="Charles / Max / Nicolas" />
            </div>
            <div>
              <label class="label">CRM ID</label>
              <input class="input" v-model="form.crm_id" />
            </div>
            <div>
              <label class="label">Statut CRM</label>
              <input class="input" v-model="form.crm_status" />
            </div>
            <div>
              <label class="label">Statut travail</label>
              <input class="input" v-model="form.work_status" />
            </div>
            <div class="col-span-2">
              <label class="label">Next step</label>
              <input class="input" v-model="form.next_step" />
            </div>
            <div>
              <label class="label">HQ</label>
              <input class="input" v-model="form.hq" />
            </div>
            <div>
              <label class="label">Pays (ISO 2)</label>
              <input class="input" v-model="form.country" placeholder="FR" maxlength="2" />
            </div>
            <div>
              <label class="label">Industrie</label>
              <input class="input" v-model="form.industry" />
            </div>
            <div>
              <label class="label">Effectif</label>
              <input class="input" type="number" v-model.number="form.headcount" />
            </div>
            <div class="col-span-2">
              <label class="label">Aires thérapeutiques (virgules)</label>
              <input class="input" v-model="form.therapeutic_areas" />
            </div>
            <div class="col-span-2">
              <label class="label">Commentaires CRM</label>
              <textarea class="textarea" v-model="form.comments_crm"></textarea>
            </div>
          </div>

          <div v-if="error" class="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {{ error }}
          </div>

          <div class="flex items-center justify-end gap-2 pt-2">
            <button type="button" class="btn btn-ghost" @click="close">Annuler</button>
            <button type="submit" class="btn btn-primary" :disabled="submitting">
              {{ submitting ? 'Enregistrement…' : (mode === 'create' ? 'Créer' : 'Enregistrer') }}
            </button>
          </div>
        </form>
      </div>
    </div>
  `
};
