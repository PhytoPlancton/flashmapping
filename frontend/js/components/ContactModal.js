import { ref, reactive, watch, onMounted } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import { store, CATEGORIES, LEVEL_LABELS } from '../store.js';
import * as api from '../api.js';
import { icons } from '../icons.js';

/* ------------------------------------------------------------------ */
/* Helpers for datetime-local ⇄ ISO string round-tripping.
   <input type="datetime-local"> works with local-time strings WITHOUT a
   timezone suffix (YYYY-MM-DDTHH:MM). The backend stores ISO-8601 UTC.
   These helpers translate between the two without losing precision. */
function isoToLocalInput(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localInputToIso(v) {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}
function isoDateToInput(v) {
  if (!v) return '';
  // Accept "YYYY-MM-DD" or a full ISO datetime; keep only the date portion.
  return String(v).slice(0, 10);
}

export default {
  name: 'ContactModal',
  props: {
    mode: { type: String, required: true },  // 'create' | 'edit'
    initial: { type: Object, default: () => ({}) }
  },
  emits: ['close'],
  setup(props, { emit }) {
    const form = reactive({
      // Section 1 — Informations
      name: props.initial.name || '',
      title: props.initial.title || '',
      email: props.initial.email || '',
      phone: props.initial.phone || '',
      mobile_phone: props.initial.mobile_phone || '',
      secondary_email: props.initial.secondary_email || '',
      linkedin_url: props.initial.linkedin_url || '',
      website: props.initial.website || '',
      location: props.initial.location || '',
      level: props.initial.level || 3,
      category: props.initial.category || 'other',

      // Section 2 — Qualification
      qualification: props.initial.qualification || '',
      lead_source: props.initial.lead_source || '',
      owner_id: props.initial.owner_id || '',
      decision_vs_influencer: props.initial.decision_vs_influencer || '',
      flag_c_level: !!props.initial.flag_c_level,
      flag_bu_head: !!props.initial.flag_bu_head,
      flag_manager_of_managers: !!props.initial.flag_manager_of_managers,
      priority_score: Number.isFinite(props.initial.priority_score) ? props.initial.priority_score : null,

      // Section 3 — Adresse
      address: props.initial.address || '',
      city: props.initial.city || '',
      country: props.initial.country || '',

      // Section 4 — Activité
      last_contacted_at: isoToLocalInput(props.initial.last_contacted_at),
      next_action: props.initial.next_action || '',
      next_action_at: isoToLocalInput(props.initial.next_action_at),
      birthday: isoDateToInput(props.initial.birthday),
      labels: Array.isArray(props.initial.labels) ? [...props.initial.labels] : [],
      labelDraft: '',

      // Section 5 — Notes
      notes: props.initial.notes || '',
      therapeutic_areas: (props.initial.therapeutic_areas || []).join(', '),

      // Hidden / meta
      is_techtomed: !!props.initial.is_techtomed,
      seniority: props.initial.seniority || ''
    });

    /* ---------- Collapsible sections ----------
       State is kept in-component; no localStorage so the form always
       opens predictably. If a future bug breaks toggling, every section
       stays usable because we fall back to `true` (open) on any error. */
    const sections = reactive({
      info:          true,
      qualification: false,
      address:       false,
      activity:      false,
      notes:         true
    });
    function toggle(key) {
      try { sections[key] = !sections[key]; }
      catch (e) { /* safety: leave open */ sections[key] = true; }
    }

    /* ---------- Team members (Owner select) ---------- */
    const members = ref([]);
    const membersLoading = ref(false);
    onMounted(async () => {
      const slug = store.teamSlug();
      if (!slug) return;
      membersLoading.value = true;
      try {
        members.value = await store.listMembers(slug);
      } catch (e) {
        members.value = [];
      } finally {
        membersLoading.value = false;
      }
    });

    const submitting = ref(false);
    const classifying = ref(false);
    const error = ref('');

    // Debounced classification on title change
    let timer = null;
    watch(() => form.title, (v) => {
      if (!v || v.length < 3) return;
      clearTimeout(timer);
      timer = setTimeout(async () => {
        classifying.value = true;
        try {
          const r = await api.classifyTitle(v);
          if (r) {
            if (r.level) form.level = r.level;
            if (r.category) form.category = r.category;
            if (r.seniority) form.seniority = r.seniority;
            if (typeof r.flag_c_level === 'boolean') form.flag_c_level = r.flag_c_level;
            if (typeof r.flag_bu_head === 'boolean') form.flag_bu_head = r.flag_bu_head;
            if (typeof r.flag_manager_of_managers === 'boolean') form.flag_manager_of_managers = r.flag_manager_of_managers;
            if (Number.isFinite(r.priority_score)) form.priority_score = r.priority_score;
          }
        } catch (e) { /* silent */ }
        finally { classifying.value = false; }
      }, 500);
    });

    /* ---------- Labels chip input ----------
       Enter or "," commits the draft. Backspace on an empty input removes
       the last chip. Click a chip's ✕ to remove it. */
    function addLabel() {
      const v = (form.labelDraft || '').trim().replace(/,+$/, '');
      if (!v) { form.labelDraft = ''; return; }
      if (!form.labels.includes(v)) form.labels.push(v);
      form.labelDraft = '';
    }
    function onLabelKeydown(ev) {
      if (ev.key === 'Enter' || ev.key === ',') {
        ev.preventDefault();
        addLabel();
      } else if (ev.key === 'Backspace' && !form.labelDraft && form.labels.length > 0) {
        form.labels.splice(form.labels.length - 1, 1);
      }
    }
    function removeLabel(i) {
      form.labels.splice(i, 1);
    }

    function close() { emit('close'); }
    function onBackdrop(ev) { if (ev.target === ev.currentTarget) close(); }

    async function submit() {
      error.value = '';
      if (!form.name.trim()) { error.value = 'Nom requis'; return; }
      submitting.value = true;

      // Commit any in-progress label draft so the user doesn't lose it.
      if ((form.labelDraft || '').trim()) addLabel();

      const payload = {
        // Core
        name: form.name.trim(),
        title: form.title.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        linkedin_url: form.linkedin_url.trim(),
        location: form.location.trim(),
        level: Number(form.level),
        category: form.category,
        notes: form.notes,
        decision_vs_influencer: form.decision_vs_influencer,
        is_techtomed: !!form.is_techtomed,
        flag_c_level: !!form.flag_c_level,
        flag_bu_head: !!form.flag_bu_head,
        flag_manager_of_managers: !!form.flag_manager_of_managers,
        seniority: form.seniority,
        therapeutic_areas: form.therapeutic_areas
          ? form.therapeutic_areas.split(',').map(s => s.trim()).filter(Boolean)
          : [],

        // Pipedrive-inspired fields
        mobile_phone: form.mobile_phone.trim(),
        secondary_email: form.secondary_email.trim(),
        website: form.website.trim(),
        address: form.address.trim(),
        city: form.city.trim(),
        country: form.country.trim(),
        qualification: form.qualification || null,
        lead_source: (form.lead_source || '').trim(),
        owner_id: form.owner_id || null,
        labels: Array.isArray(form.labels) ? form.labels : [],
        next_action: (form.next_action || '').trim(),
        last_contacted_at: localInputToIso(form.last_contacted_at),
        next_action_at: localInputToIso(form.next_action_at),
        birthday: form.birthday || null
      };
      if (Number.isFinite(form.priority_score)) payload.priority_score = form.priority_score;
      // When adding at a specific level, hint the backend to place at the end
      if (props.mode === 'create' && Number.isFinite(props.initial?.position_in_level)) {
        payload.position_in_level = props.initial.position_in_level;
      }

      let ok = false;
      if (props.mode === 'create') {
        const slug = store.activeSlug;
        ok = await store.createContact(slug, payload);
      } else {
        ok = await store.updateContact(props.initial._id, payload);
      }

      submitting.value = false;
      if (ok) close();
    }

    onMounted(() => {
      const esc = (ev) => { if (ev.key === 'Escape') close(); };
      window.addEventListener('keydown', esc);
      return () => window.removeEventListener('keydown', esc);
    });

    /* ---------- Priority stars helper (readonly display) ---------- */
    function starsFilled(score) {
      if (!Number.isFinite(score) || score <= 0) return 0;
      if (score < 20) return 1;
      if (score < 35) return 2;
      if (score < 50) return 3;
      if (score < 70) return 4;
      return 5;
    }

    return {
      form, submitting, classifying, error, submit, close, onBackdrop,
      CATEGORIES, LEVEL_LABELS, icons,
      sections, toggle,
      members, membersLoading,
      addLabel, onLabelKeydown, removeLabel,
      starsFilled
    };
  },
  template: `
    <div class="modal-backdrop" @mousedown="onBackdrop">
      <div class="modal-panel">
        <div class="flex items-center justify-between px-6 py-4 border-b border-ink-100 sticky top-0 bg-white z-10">
          <div>
            <h3 class="text-[15px] font-semibold">
              {{ mode === 'create' ? 'Ajouter un contact' : 'Éditer le contact' }}
            </h3>
            <p class="text-[11px] text-ink-400 mt-0.5" v-if="classifying">Classification en cours…</p>
          </div>
          <button class="card-action-btn" @click="close">
            <span v-html="icons.close"></span>
          </button>
        </div>

        <form @submit.prevent="submit" class="px-6 py-4 space-y-3">

          <!-- Section 1: Informations -->
          <section class="contact-section" :class="{ open: sections.info }">
            <button type="button" class="contact-section-head" @click="toggle('info')">
              <span class="contact-section-chev" :class="{ open: sections.info }">▸</span>
              <span class="contact-section-title">Informations</span>
            </button>
            <div class="contact-section-body" v-show="sections.info">
              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2">
                  <label class="label">Nom *</label>
                  <input class="input" v-model="form.name" placeholder="Nom complet" />
                </div>
                <div class="col-span-2">
                  <label class="label">Titre</label>
                  <input class="input" v-model="form.title" placeholder="Head of Digital Innovation" />
                </div>
                <div>
                  <label class="label">Email</label>
                  <input class="input" type="email" v-model="form.email" />
                </div>
                <div>
                  <label class="label">Email secondaire</label>
                  <input class="input" type="email" v-model="form.secondary_email" placeholder="email perso…" />
                </div>
                <div>
                  <label class="label">Téléphone</label>
                  <input class="input" v-model="form.phone" />
                </div>
                <div>
                  <label class="label">Mobile</label>
                  <input class="input" v-model="form.mobile_phone" placeholder="+33…" />
                </div>
                <div class="col-span-2">
                  <label class="label">LinkedIn URL</label>
                  <input class="input" v-model="form.linkedin_url" placeholder="https://linkedin.com/in/…" />
                </div>
                <div class="col-span-2">
                  <label class="label">Website</label>
                  <input class="input" v-model="form.website" placeholder="https://…" />
                </div>
                <div>
                  <label class="label">Localisation (libre)</label>
                  <input class="input" v-model="form.location" />
                </div>
                <div>
                  <label class="label">Niveau</label>
                  <select class="select" v-model.number="form.level">
                    <option v-for="lvl in [1,2,3,4,5,6]" :key="lvl" :value="lvl">
                      {{ LEVEL_LABELS[lvl] }}
                    </option>
                  </select>
                </div>
                <div class="col-span-2">
                  <label class="label">Catégorie</label>
                  <select class="select" v-model="form.category">
                    <option v-for="c in CATEGORIES" :key="c.key" :value="c.key">{{ c.label }}</option>
                  </select>
                </div>
              </div>
            </div>
          </section>

          <!-- Section 2: Qualification -->
          <section class="contact-section" :class="{ open: sections.qualification }">
            <button type="button" class="contact-section-head" @click="toggle('qualification')">
              <span class="contact-section-chev" :class="{ open: sections.qualification }">▸</span>
              <span class="contact-section-title">Qualification</span>
            </button>
            <div class="contact-section-body" v-show="sections.qualification">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label">Qualification</label>
                  <select class="select" v-model="form.qualification">
                    <option value="">—</option>
                    <option value="cold">Cold</option>
                    <option value="warm">Warm</option>
                    <option value="hot">Hot</option>
                    <option value="customer">Customer</option>
                    <option value="lost">Lost</option>
                  </select>
                </div>
                <div>
                  <label class="label">Lead source</label>
                  <input class="input" v-model="form.lead_source" placeholder="linkedin, referral, event…" />
                </div>
                <div>
                  <label class="label">Owner</label>
                  <select class="select" v-model="form.owner_id" :disabled="membersLoading">
                    <option value="">— Non assigné —</option>
                    <option v-for="m in members" :key="m.user_id || m._id" :value="m.user_id || m._id">
                      {{ m.name || m.email || '(membre)' }}
                    </option>
                  </select>
                </div>
                <div>
                  <label class="label">Décideur / influenceur</label>
                  <select class="select" v-model="form.decision_vs_influencer">
                    <option value="">—</option>
                    <option value="decision">Décideur</option>
                    <option value="influencer">Influenceur</option>
                  </select>
                </div>
                <div class="col-span-2" v-if="Number.isFinite(form.priority_score) && form.priority_score > 0">
                  <label class="label">Priority score</label>
                  <div class="flex items-center gap-2 py-1">
                    <span class="priority-stars" :title="'Score ICP: ' + form.priority_score + '/100'">
                      <svg v-for="i in 5" :key="i"
                           viewBox="0 0 20 20"
                           class="priority-star"
                           :class="{ filled: i <= starsFilled(form.priority_score) }"
                           width="13" height="13"
                           aria-hidden="true">
                        <path d="M10 1.5l2.59 5.25 5.79.84-4.19 4.09.99 5.77L10 14.73l-5.18 2.72.99-5.77L1.62 7.59l5.79-.84L10 1.5z"/>
                      </svg>
                    </span>
                    <span class="text-[11px] text-ink-500">{{ form.priority_score }}/100</span>
                  </div>
                </div>
                <div class="col-span-2 flex flex-wrap items-center gap-4 text-[12px] text-ink-600 pt-1">
                  <label class="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" v-model="form.is_techtomed" />
                    <span>★ TechToMed</span>
                  </label>
                  <label class="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" v-model="form.flag_c_level" />
                    <span>C-Level</span>
                  </label>
                  <label class="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" v-model="form.flag_bu_head" />
                    <span>BU Head</span>
                  </label>
                  <label class="inline-flex items-center gap-1.5 cursor-pointer">
                    <input type="checkbox" v-model="form.flag_manager_of_managers" />
                    <span>Mgr of Mgrs</span>
                  </label>
                </div>
              </div>
            </div>
          </section>

          <!-- Section 3: Adresse -->
          <section class="contact-section" :class="{ open: sections.address }">
            <button type="button" class="contact-section-head" @click="toggle('address')">
              <span class="contact-section-chev" :class="{ open: sections.address }">▸</span>
              <span class="contact-section-title">Adresse</span>
            </button>
            <div class="contact-section-body" v-show="sections.address">
              <div class="grid grid-cols-2 gap-3">
                <div class="col-span-2">
                  <label class="label">Adresse</label>
                  <textarea class="textarea" v-model="form.address" rows="2" placeholder="12 rue… / Building…"></textarea>
                </div>
                <div>
                  <label class="label">Ville</label>
                  <input class="input" v-model="form.city" placeholder="Paris" />
                </div>
                <div>
                  <label class="label">Pays</label>
                  <input class="input" v-model="form.country" placeholder="FR ou France" />
                </div>
              </div>
            </div>
          </section>

          <!-- Section 4: Activité -->
          <section class="contact-section" :class="{ open: sections.activity }">
            <button type="button" class="contact-section-head" @click="toggle('activity')">
              <span class="contact-section-chev" :class="{ open: sections.activity }">▸</span>
              <span class="contact-section-title">Activité</span>
            </button>
            <div class="contact-section-body" v-show="sections.activity">
              <div class="grid grid-cols-2 gap-3">
                <div>
                  <label class="label">Dernier contact</label>
                  <input class="input" type="datetime-local" v-model="form.last_contacted_at" />
                </div>
                <div>
                  <label class="label">Anniversaire</label>
                  <input class="input" type="date" v-model="form.birthday" />
                </div>
                <div>
                  <label class="label">Prochaine action</label>
                  <input class="input" v-model="form.next_action" placeholder="Send email, Call…" />
                </div>
                <div>
                  <label class="label">Prévue le</label>
                  <input class="input" type="datetime-local" v-model="form.next_action_at" />
                </div>
                <div class="col-span-2">
                  <label class="label">Labels</label>
                  <div class="chips-input">
                    <span v-for="(lbl, i) in form.labels" :key="lbl + i" class="chip">
                      {{ lbl }}
                      <button type="button" class="chip-x" @click="removeLabel(i)" aria-label="Retirer">×</button>
                    </span>
                    <input class="chips-input-field"
                           v-model="form.labelDraft"
                           @keydown="onLabelKeydown"
                           @blur="addLabel"
                           :placeholder="form.labels.length ? '' : 'Tape Entrée pour ajouter un tag'"
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <!-- Section 5: Notes -->
          <section class="contact-section" :class="{ open: sections.notes }">
            <button type="button" class="contact-section-head" @click="toggle('notes')">
              <span class="contact-section-chev" :class="{ open: sections.notes }">▸</span>
              <span class="contact-section-title">Notes</span>
            </button>
            <div class="contact-section-body" v-show="sections.notes">
              <div class="grid grid-cols-1 gap-3">
                <div>
                  <label class="label">Aires thérapeutiques (virgules)</label>
                  <input class="input" v-model="form.therapeutic_areas" placeholder="Oncology, Rare disease" />
                </div>
                <div>
                  <label class="label">Notes</label>
                  <textarea class="textarea" v-model="form.notes" rows="4"></textarea>
                </div>
              </div>
            </div>
          </section>

          <div v-if="error" class="text-xs text-red-600 bg-red-50 border border-red-100 rounded-md px-3 py-2">
            {{ error }}
          </div>

          <div class="flex items-center justify-end gap-2 pt-2 sticky bottom-0 bg-white pb-1">
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
