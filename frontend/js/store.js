// store.js — simple reactive store (no Pinia)
import { reactive } from 'https://cdn.jsdelivr.net/npm/vue@3/dist/vue.esm-browser.prod.js';
import * as api from './api.js';
import { getStoredUser, setStoredUser, clearToken } from './auth.js';
import { extractCountry } from './utils.js';

const LAST_TEAM_KEY = 'mapping_last_team';
// Expanded folder ids persisted per team so collapse state survives reload.
// Shape on disk: { "<teamSlug>": ["<folderId>", ...] }
const FOLDER_EXPANDED_KEY = 'mapping_expanded_folders_v1';

function readExpandedFolders(teamSlug) {
  if (!teamSlug) return new Set();
  try {
    const raw = localStorage.getItem(FOLDER_EXPANDED_KEY);
    if (!raw) return new Set();
    const obj = JSON.parse(raw);
    const arr = obj && Array.isArray(obj[teamSlug]) ? obj[teamSlug] : [];
    return new Set(arr);
  } catch (e) {
    return new Set();
  }
}

function writeExpandedFolders(teamSlug, set) {
  if (!teamSlug) return;
  try {
    const raw = localStorage.getItem(FOLDER_EXPANDED_KEY);
    const obj = raw ? (JSON.parse(raw) || {}) : {};
    obj[teamSlug] = [...set];
    localStorage.setItem(FOLDER_EXPANDED_KEY, JSON.stringify(obj));
  } catch (e) {}
}

export const store = reactive({
  // auth
  user: getStoredUser(),
  bootstrapNeeded: false,
  authChecked: false,

  // teams
  teams: [],
  teamsLoading: false,
  currentTeam: null,        // { _id, name, slug, role, ... }
  userRole: null,           // "owner" | "admin" | "member"

  // data
  companies: [],
  companiesLoading: false,
  activeSlug: null,
  activeCompany: null,
  activeCompanyLoading: false,

  // folders (sidebar organisation — see UX_FOLDERS.md)
  folders: [],
  foldersLoading: false,
  // Set<folderId> — which folder headers are currently expanded. Persisted
  // per-team via localStorage (see writeExpandedFolders). The getter
  // `isFolderExpanded(id)` also returns true when the folder contains the
  // currently active company, to guarantee the active row is never hidden.
  expandedFolders: new Set(),

  // filters
  activeCategories: new Set(),    // empty = all
  activeCountries: new Set(),     // empty = all; values are ISO2 codes ('FR', 'US', …)
  techtomedOnly: false,
  icpOnly: false,
  showLevel6: false,

  // ICP (team-scoped roles: DRH, Dir Commercial, Resp Formation…)
  teamICPs: [],              // [{id, name, emoji, synonyms:[]}]
  icpLlmEnabled: false,
  icpLlmAvailable: false,    // true if backend has ANTHROPIC_API_KEY
  icpDrawerOpen: false,

  // Settings modal (overlay on top of the current page instead of a
  // full-page route). We still rely on the hash (#/settings/*) for internal
  // sub-routing of tabs, but app.js suppresses the "settings" screen switch
  // while `settingsModalOpen` is true — the underlying page stays mounted
  // and gets blurred behind the modal.
  settingsModalOpen: false,
  _preSettingsHash: null,

  // freeform view
  connections: [],
  connectionsLoading: false,

  // ui
  toasts: [],
  undoToast: null,          // { message, actionLabel, duration, onUndo }
  modal: null, // { type: 'contact-edit'|'contact-create'|'company-create'|'company-edit'|'invite-create'|'confirm', payload }

  // Soft-deleted company cache for undo pattern.
  // Keyed by company id. Stores { company, teamSlug, timeoutId }.
  softDeletedCompanies: {},

  // Multi-select for batch drag-to-folder (Shift/Cmd-click on sidebar cards).
  // Cleared on: regular click, Escape, company open, team switch.
  selectedCompanyIds: new Set(),
  lastClickedCompanyId: null,

  // ===== toasts =====
  toast(message, variant = 'info') {
    const id = Math.random().toString(36).slice(2);
    this.toasts.push({ id, message, variant });
    setTimeout(() => {
      this.toasts = this.toasts.filter(t => t.id !== id);
    }, 3200);
  },

  // Show an undo toast. Only one at a time — if a previous one exists, it's
  // finalized (i.e. the pending delete is committed — no undo possible).
  showUndoToast({ message, actionLabel = 'Annuler', duration = 5000, onUndo }) {
    // If there's already an undo toast in flight, dismiss it (finalizing prev delete).
    if (this.undoToast) this.clearUndoToast();
    this.undoToast = { message, actionLabel, duration, onUndo };
  },

  clearUndoToast() {
    this.undoToast = null;
  },

  // ===== helpers =====
  isAdmin()  { return this.userRole === 'owner' || this.userRole === 'admin'; },
  isOwner()  { return this.userRole === 'owner'; },
  teamSlug() { return this.currentTeam?.slug || null; },

  // Team members cache — used by ContactModal (Owner select) and any other
  // UI that needs to display team-mate names. Fetched lazily on demand and
  // cached per team slug; the cache is invalidated on team switch.
  _membersBySlug: {},
  _membersLoadingSlug: null,
  async listMembers(teamSlug) {
    const slug = teamSlug || this.teamSlug();
    if (!slug) return [];
    if (Array.isArray(this._membersBySlug[slug])) return this._membersBySlug[slug];
    if (this._membersLoadingSlug === slug) {
      // Someone else is already fetching — just wait (poll) until it lands.
      // In practice this is only a few ms and simpler than a shared promise.
      while (this._membersLoadingSlug === slug) {
        await new Promise(r => setTimeout(r, 40));
      }
      return this._membersBySlug[slug] || [];
    }
    this._membersLoadingSlug = slug;
    try {
      const list = await api.listMembers(slug);
      this._membersBySlug[slug] = Array.isArray(list) ? list : [];
    } catch (e) {
      this._membersBySlug[slug] = [];
    } finally {
      this._membersLoadingSlug = null;
    }
    return this._membersBySlug[slug];
  },

  // ===== auth =====
  async checkBootstrap() {
    try {
      const b = await api.bootstrap();
      this.bootstrapNeeded = !!b?.bootstrap_needed;
    } catch (e) {
      // backend offline — assume not needed (login screen will surface error)
      this.bootstrapNeeded = false;
    }
    this.authChecked = true;
  },
  async fetchMe() {
    try {
      const u = await api.me();
      this.user = u;
      setStoredUser(u);
      return u;
    } catch (e) {
      this.user = null;
      setStoredUser(null);
      return null;
    }
  },

  logout() {
    api.logout().catch(() => {});
    clearToken();
    this.user = null;
    this.teams = [];
    this.currentTeam = null;
    this.userRole = null;
    this.companies = [];
    this.folders = [];
    this.expandedFolders = new Set();
    this.activeCompany = null;
    this.activeSlug = null;
    try { localStorage.removeItem(LAST_TEAM_KEY); } catch (e) {}
    location.hash = '#/login';
  },

  // ===== teams =====
  async initTeams() {
    this.teamsLoading = true;
    try {
      const list = await api.listTeams();
      this.teams = Array.isArray(list) ? list : [];
    } catch (e) {
      this.teams = [];
    } finally {
      this.teamsLoading = false;
    }
    return this.teams;
  },

  setCurrentTeam(team) {
    this.currentTeam = team || null;
    this.userRole = team?.role || null;
    const s = team?.settings || {};
    this.teamICPs = Array.isArray(s.icps) ? s.icps : [];
    this.icpLlmEnabled = !!s.icp_llm_enabled;
    this.icpLlmAvailable = !!s.icp_llm_available;
    if (team?.slug) {
      try { localStorage.setItem(LAST_TEAM_KEY, team.slug); } catch (e) {}
    }
  },

  getLastTeamSlug() {
    try { return localStorage.getItem(LAST_TEAM_KEY) || null; } catch (e) { return null; }
  },

  pickInitialTeam() {
    if (!this.teams || this.teams.length === 0) return null;
    const last = this.getLastTeamSlug();
    if (last) {
      const t = this.teams.find(x => x.slug === last);
      if (t) return t;
    }
    return this.teams[0];
  },

  async switchTeam(slug, { navigate = true } = {}) {
    if (!slug) return null;
    const team = this.teams.find(t => t.slug === slug);
    if (!team) return null;
    this.setCurrentTeam(team);
    // invalidate any cached company state from previous team
    this.companies = [];
    this.folders = [];
    this.expandedFolders = new Set();
    this.activeCompany = null;
    this.activeSlug = null;
    // Clear the per-team members cache so the new team fetches fresh.
    this._membersBySlug = {};
    if (navigate) {
      const next = `#/${slug}/companies`;
      if (location.hash !== next) location.hash = next;
    }
    return team;
  },

  // ---- ICP management (team-scoped) ----
  async saveTeamICPs(icps, { llmEnabled } = {}) {
    const slug = this.currentTeam?.slug;
    if (!slug) throw new Error('No current team');
    const payload = { icps };
    if (typeof llmEnabled === 'boolean') payload.icp_llm_enabled = llmEnabled;
    const updated = await api.patchTeamICPs(slug, payload);
    // updated is the full TeamDetailOut; refresh local team state + reload
    // contacts so icp_match_ids surface in the UI.
    if (updated) {
      const idx = this.teams.findIndex(t => t.slug === slug);
      if (idx >= 0) this.teams[idx] = { ...this.teams[idx], ...updated };
      this.setCurrentTeam({ ...this.currentTeam, ...updated });
      await this.loadCompany?.(this.activeSlug);
    }
    return updated;
  },

  async recomputeICPsWithLLM() {
    const slug = this.currentTeam?.slug;
    if (!slug) throw new Error('No current team');
    const res = await api.recomputeICPsLLM(slug);
    // Reload the active company's contacts so new matches appear.
    if (this.activeSlug) await this.loadCompany?.(this.activeSlug);
    return res;
  },

  openICPDrawer() { this.icpDrawerOpen = true; },
  closeICPDrawer() { this.icpDrawerOpen = false; },

  openSettingsModal() {
    // Snapshot the current hash so we can restore it when closing the modal,
    // then switch to the settings sub-route so the existing tab-routing logic
    // in Settings.js picks up the right tab.
    const cur = location.hash || '';
    if (!cur.startsWith('#/settings')) this._preSettingsHash = cur;
    if (!cur.startsWith('#/settings')) location.hash = '#/settings/profile';
    this.settingsModalOpen = true;
  },
  closeSettingsModal() {
    this.settingsModalOpen = false;
    // Restore the underlying page's hash so app.js re-resolves to the
    // previous screen (typically /{team}/companies/{slug}). Fallback to the
    // current team's companies if we opened from Settings directly.
    let target = this._preSettingsHash;
    if (!target) {
      const slug = this.currentTeam?.slug || this.getLastTeamSlug?.();
      target = slug ? `#/${slug}/companies` : '#/';
    }
    if (target !== location.hash) location.hash = target;
    this._preSettingsHash = null;
  },

  async refreshTeams() {
    const prevSlug = this.currentTeam?.slug;
    await this.initTeams();
    if (prevSlug) {
      const still = this.teams.find(t => t.slug === prevSlug);
      if (still) {
        this.setCurrentTeam(still);
        return { ok: true, lostTeam: false };
      }
    }
    return { ok: this.teams.length > 0, lostTeam: true };
  },

  // ===== companies =====
  async loadCompanies() {
    const slug = this.teamSlug();
    if (!slug) return;
    this.companiesLoading = true;
    try {
      const list = await api.listCompanies(slug);
      this.companies = Array.isArray(list) ? list : [];
    } catch (e) {
      if (e.status === 403) {
        await this._handleTeamForbidden();
      } else {
        this.toast(e.message || 'Erreur chargement comptes', 'error');
      }
    } finally {
      this.companiesLoading = false;
    }
  },
  async loadCompany(slug) {
    const teamSlug = this.teamSlug();
    if (!slug || !teamSlug) return;
    this.activeSlug = slug;
    this.activeCompanyLoading = true;
    try {
      const c = await api.getCompany(teamSlug, slug);
      this.activeCompany = c;
    } catch (e) {
      if (e.status === 403) {
        await this._handleTeamForbidden();
      } else {
        this.toast(e.message || 'Erreur chargement compte', 'error');
        this.activeCompany = null;
      }
    } finally {
      this.activeCompanyLoading = false;
    }
    // Fire-and-forget: silently link FM contacts to their existing Pipedrive
    // person (if any). Backend throttles to ~1h per company, so calling this
    // on every `loadCompany` is cheap. The UI doesn't wait — the green
    // Pipedrive badge just appears on matched contacts when the call returns.
    this._runPipedriveAutoMatch(teamSlug, slug);
  },

  _runPipedriveAutoMatch(teamSlug, slug) {
    api.pipedriveAutoMatchCompany?.(teamSlug, slug)
      .then((res) => {
        if (!res || !res.updates || !Array.isArray(res.updates)) return;
        // Guard: user may have navigated away before the call resolved.
        if (this.activeSlug !== slug || !this.activeCompany) return;
        if (this.activeCompany.slug !== slug) return;
        for (const u of res.updates) {
          const c = (this.activeCompany.contacts || []).find(
            (x) => String(x._id) === String(u.contact_id)
          );
          if (c) c.pipedrive_person_id = u.pipedrive_person_id;
        }
      })
      .catch((e) => {
        // Silent — auto-match is a nice-to-have, not worth bothering the user.
        // eslint-disable-next-line no-console
        console.debug('[pipedrive auto-match] skipped:', e?.message || e);
      });
  },

  /* ===== Folders ===== */

  async loadFolders() {
    const slug = this.teamSlug();
    if (!slug) return;
    this.foldersLoading = true;
    try {
      const list = await api.listFolders(slug);
      this.folders = Array.isArray(list) ? list : [];
      // Rehydrate expanded set from localStorage for this team, keeping only
      // ids that still exist in the fetched folders.
      const persisted = readExpandedFolders(slug);
      const valid = new Set();
      for (const f of this.folders) {
        const id = f._id || f.id;
        if (id && persisted.has(id)) valid.add(id);
      }
      this.expandedFolders = valid;
    } catch (e) {
      // Silent fallback: absent/broken folders endpoint shouldn't break the
      // whole sidebar. The flat company list will still render.
      this.folders = [];
      if (e.status && e.status !== 404) {
        this.toast(e.message || 'Erreur chargement dossiers', 'error');
      }
    } finally {
      this.foldersLoading = false;
    }
  },

  async createFolder(data) {
    const slug = this.teamSlug();
    if (!slug) return null;
    try {
      const created = await api.createFolder(slug, data);
      if (created) this.folders.push(created);
      return created;
    } catch (e) {
      this.toast(e.message || 'Échec création dossier', 'error');
      return null;
    }
  },

  async renameFolder(id, name) {
    return this.updateFolder(id, { name });
  },

  /* Generic folder update — accepts {name?, icon?, color?}. Optimistic, rolls
     back on error. */
  async updateFolder(id, partial) {
    const slug = this.teamSlug();
    if (!slug || !id || !partial || Object.keys(partial).length === 0) return false;
    const idx = this.folders.findIndex(f => (f._id || f.id) === id);
    if (idx < 0) return false;
    const prev = { ...this.folders[idx] };
    this.folders[idx] = { ...this.folders[idx], ...partial };
    try {
      const updated = await api.patchFolder(slug, id, partial);
      if (updated) this.folders[idx] = { ...this.folders[idx], ...updated };
      return true;
    } catch (e) {
      // Rollback individual fields we tried to change.
      const rollback = { ...this.folders[idx] };
      for (const k of Object.keys(partial)) rollback[k] = prev[k];
      this.folders[idx] = rollback;
      this.toast(e.message || 'Échec mise à jour dossier', 'error');
      return false;
    }
  },

  async deleteFolder(id) {
    const slug = this.teamSlug();
    if (!slug || !id) return false;
    try {
      await api.deleteFolder(slug, id);
    } catch (e) {
      this.toast(e.message || 'Échec suppression dossier', 'error');
      return false;
    }
    // Remove the folder from state.
    this.folders = this.folders.filter(f => (f._id || f.id) !== id);
    // Reset folder_id on any local companies that lived in it — backend does
    // the same thing server-side.
    for (let i = 0; i < this.companies.length; i++) {
      if (this.companies[i].folder_id === id) {
        this.companies[i] = { ...this.companies[i], folder_id: null };
      }
    }
    // Clean the expanded set.
    if (this.expandedFolders.has(id)) {
      const next = new Set(this.expandedFolders);
      next.delete(id);
      this.expandedFolders = next;
      writeExpandedFolders(slug, next);
    }
    this.toast('Dossier supprimé', 'success');
    return true;
  },

  /* ===== Multi-select (Shift/Cmd-click) ===== */
  setLastClickedCompany(id) { this.lastClickedCompanyId = id; },
  isCompanySelected(id) { return this.selectedCompanyIds.has(id); },
  hasSelection() { return this.selectedCompanyIds.size > 0; },
  selectionSize() { return this.selectedCompanyIds.size; },
  toggleCompanySelection(id) {
    const next = new Set(this.selectedCompanyIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.selectedCompanyIds = next;
  },
  addCompanyToSelection(id) {
    if (this.selectedCompanyIds.has(id)) return;
    const next = new Set(this.selectedCompanyIds);
    next.add(id);
    this.selectedCompanyIds = next;
  },
  selectCompanyRange(toId, orderedIds) {
    if (!Array.isArray(orderedIds) || orderedIds.length === 0) return;
    let from = this.lastClickedCompanyId;
    // If the anchor is stale (no longer in the displayed list), fall back to
    // the first currently-selected id that IS in orderedIds. Prevents shift-
    // click from degrading to single-add when data has refreshed between clicks.
    if (!from || !orderedIds.includes(from)) {
      for (const id of this.selectedCompanyIds) {
        if (orderedIds.includes(id)) { from = id; break; }
      }
    }
    const next = new Set(this.selectedCompanyIds);
    if (!from || !orderedIds.includes(from)) {
      // Truly no anchor — just add the target.
      next.add(toId);
      this.selectedCompanyIds = next;
      this.lastClickedCompanyId = toId;
      return;
    }
    const i = orderedIds.indexOf(from);
    const j = orderedIds.indexOf(toId);
    if (i < 0 || j < 0) return;
    const [a, b] = i <= j ? [i, j] : [j, i];
    for (let k = a; k <= b; k++) next.add(orderedIds[k]);
    this.selectedCompanyIds = next;
    // Keep original anchor for subsequent shift-clicks (Finder/macOS semantics).
  },
  clearCompanySelection() {
    if (this.selectedCompanyIds.size === 0 && !this.lastClickedCompanyId) return;
    this.selectedCompanyIds = new Set();
    this.lastClickedCompanyId = null;
  },

  /* Batch move — used by multi-drag drop. Applies the same folder_id to
     every id in parallel, optimistically updates local state, toasts at
     the end. Returns count of successful moves. */
  async moveCompaniesToFolder(ids, folderId) {
    const slug = this.teamSlug();
    if (!slug || !Array.isArray(ids) || ids.length === 0) return 0;
    const next = folderId || null;
    // Filter: only ids that actually need to move (folder_id != next).
    const targetCompanies = ids
      .map(id => this.companies.find(c => (c._id === id) || (c.id === id) || (c.slug === id)))
      .filter(c => c && (c.folder_id ?? null) !== next);
    if (targetCompanies.length === 0) return 0;

    // Optimistic: apply folder_id locally upfront.
    for (const c of targetCompanies) {
      const idx = this.companies.findIndex(x => x === c);
      if (idx >= 0) this.companies[idx] = { ...c, folder_id: next };
    }
    let ok = 0;
    const errors = [];
    await Promise.all(targetCompanies.map(async (c) => {
      const apiId = c._id || c.id;
      try {
        await api.moveCompanyToFolder(slug, apiId, next);
        ok++;
      } catch (e) {
        errors.push(c.name || apiId);
        // Rollback this one.
        const idx = this.companies.findIndex(x => (x._id === apiId) || (x.id === apiId));
        if (idx >= 0) this.companies[idx] = { ...this.companies[idx], folder_id: c.folder_id ?? null };
      }
    }));
    if (next) {
      const ex = new Set(this.expandedFolders);
      ex.add(next);
      this.expandedFolders = ex;
      writeExpandedFolders(slug, ex);
    }
    if (errors.length) {
      this.toast(`${errors.length}/${targetCompanies.length} déplacement(s) échoué(s)`, 'error');
    }
    return ok;
  },

  async moveCompanyToFolder(companyId, folderId) {
    const slug = this.teamSlug();
    if (!slug || !companyId) return false;
    const idx = this.companies.findIndex(c =>
      (c._id === companyId) || (c.id === companyId) || (c.slug === companyId)
    );
    if (idx < 0) return false;
    const prev = this.companies[idx].folder_id ?? null;
    const next = folderId || null;
    if (prev === next) return true;
    // Optimistic.
    const apiId = this.companies[idx]._id || this.companies[idx].id || companyId;
    this.companies[idx] = { ...this.companies[idx], folder_id: next };
    try {
      const updated = await api.moveCompanyToFolder(slug, apiId, next);
      if (updated) this.companies[idx] = { ...this.companies[idx], ...updated };
      // If we moved INTO a folder, auto-expand it so the user sees the result.
      if (next) {
        const ex = new Set(this.expandedFolders);
        ex.add(next);
        this.expandedFolders = ex;
        writeExpandedFolders(slug, ex);
      }
      return true;
    } catch (e) {
      // Rollback.
      this.companies[idx] = { ...this.companies[idx], folder_id: prev };
      this.toast(e.message || 'Échec déplacement compte', 'error');
      return false;
    }
  },

  /* Reorder companies inside one container (folder or root), optionally
     moving them into that container in the same call. Optimistic — writes
     `position` (and `folder_id` for cross-container drops) locally then
     persists. Rolls back on failure.

     Shifts every OTHER company in the target container down by N so the
     dragged block lands at positions [0..N-1], mirroring the backend. */
  async reorderCompaniesInFolder(folderId, orderedIds) {
    const slug = this.teamSlug();
    if (!slug || !Array.isArray(orderedIds) || orderedIds.length === 0) return false;
    const target = folderId || null;

    // Snapshot for rollback.
    const before = this.companies.map(c => ({ ...c }));

    // Build a lookup so we can update each company in-place by id.
    const idOf = (c) => c._id || c.id;
    const orderedSet = new Set(orderedIds);
    const n = orderedIds.length;

    // 1) Shift everyone ELSE in the target container by +N.
    for (let i = 0; i < this.companies.length; i++) {
      const c = this.companies[i];
      const cid = idOf(c);
      if (orderedSet.has(cid)) continue;
      if ((c.folder_id ?? null) !== target) continue;
      this.companies[i] = { ...c, position: (c.position ?? 0) + n };
    }
    // 2) Assign new positions to the ordered block (0..N-1) + retarget folder_id.
    for (let i = 0; i < orderedIds.length; i++) {
      const id = orderedIds[i];
      const idx = this.companies.findIndex(c => idOf(c) === id);
      if (idx >= 0) {
        this.companies[idx] = { ...this.companies[idx], position: i, folder_id: target };
      }
    }

    // Auto-expand the target folder so the user sees the result landed where they dropped.
    if (target) {
      const ex = new Set(this.expandedFolders);
      ex.add(target);
      this.expandedFolders = ex;
      writeExpandedFolders(slug, ex);
    }

    try {
      await api.reorderCompaniesInFolder(slug, target, orderedIds);
      return true;
    } catch (e) {
      this.companies = before;
      this.toast(e.message || 'Échec réorganisation', 'error');
      return false;
    }
  },

  async reorderFolders(ids) {
    const slug = this.teamSlug();
    if (!slug || !Array.isArray(ids) || ids.length === 0) return false;
    // Optimistic local reorder — rebuild folders array in the requested order,
    // preserving any folders not listed (defensive) at the tail.
    const byId = new Map(this.folders.map(f => [f._id || f.id, f]));
    const reordered = [];
    for (const id of ids) {
      const f = byId.get(id);
      if (f) { reordered.push(f); byId.delete(id); }
    }
    for (const f of byId.values()) reordered.push(f);
    const prev = this.folders;
    this.folders = reordered;
    try {
      await api.reorderFolders(slug, ids);
      return true;
    } catch (e) {
      this.folders = prev;
      this.toast(e.message || 'Échec réorganisation dossiers', 'error');
      return false;
    }
  },

  toggleFolderExpanded(id) {
    if (!id) return;
    const slug = this.teamSlug();
    const next = new Set(this.expandedFolders);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    this.expandedFolders = next;
    writeExpandedFolders(slug, next);
  },

  // True only when the user explicitly expanded this folder. We no longer
  // force-expand when the folder contains the active company — the user
  // should always be able to collapse a folder. The detail view for the
  // active company stays visible in the main panel regardless.
  isFolderExpanded(id) {
    if (!id) return false;
    return this.expandedFolders.has(id);
  },

  async _handleTeamForbidden() {
    this.toast('Accès refusé — rafraîchissement des équipes', 'error');
    const r = await this.refreshTeams();
    if (!r.ok || this.teams.length === 0) {
      this.currentTeam = null;
      this.userRole = null;
      this.companies = [];
      this.folders = [];
      this.expandedFolders = new Set();
      this.activeCompany = null;
      this.activeSlug = null;
      location.hash = '#/onboarding';
    } else {
      const t = this.pickInitialTeam();
      if (t) await this.switchTeam(t.slug);
    }
  },

  // ===== filters =====
  toggleCategory(cat) {
    if (this.activeCategories.has(cat)) this.activeCategories.delete(cat);
    else this.activeCategories.add(cat);
    // force reactivity
    this.activeCategories = new Set(this.activeCategories);
  },
  toggleCountry(code) {
    if (!code) return;
    if (this.activeCountries.has(code)) this.activeCountries.delete(code);
    else this.activeCountries.add(code);
    // force reactivity
    this.activeCountries = new Set(this.activeCountries);
  },
  resetFilters() {
    this.activeCategories = new Set();
    this.activeCountries = new Set();
    this.techtomedOnly = false;
    this.icpOnly = false;
  },

  // ===== contacts (optimistic + refresh) =====
  async refreshActiveCompany() {
    if (this.activeSlug) await this.loadCompany(this.activeSlug);
  },

  async moveContact(id, level, position_in_level) {
    const teamSlug = this.teamSlug();
    if (!teamSlug) return;
    try {
      await api.moveContact(teamSlug, id, { level, position_in_level });
      await this.refreshActiveCompany();
    } catch (e) {
      this.toast('Échec déplacement — rollback', 'error');
      await this.refreshActiveCompany();
    }
  },

  async deleteContact(id) {
    const teamSlug = this.teamSlug();
    if (!teamSlug) return;
    try {
      await api.deleteContact(teamSlug, id);
      this.toast('Contact supprimé', 'success');
      await this.refreshActiveCompany();
    } catch (e) {
      this.toast(e.message || 'Échec suppression', 'error');
    }
  },

  async createContact(slug, payload) {
    const teamSlug = this.teamSlug();
    if (!teamSlug) return false;
    try {
      await api.createContact(teamSlug, slug, payload);
      this.toast('Contact créé', 'success');
      await this.refreshActiveCompany();
      await this.loadCompanies(); // updates counts
      return true;
    } catch (e) {
      this.toast(e.message || 'Échec création', 'error');
      return false;
    }
  },

  async updateContact(id, payload) {
    const teamSlug = this.teamSlug();
    if (!teamSlug) return false;
    try {
      await api.patchContact(teamSlug, id, payload);
      this.toast('Contact mis à jour', 'success');
      await this.refreshActiveCompany();
      return true;
    } catch (e) {
      this.toast(e.message || 'Échec mise à jour', 'error');
      return false;
    }
  },

  async createCompany(payload) {
    const teamSlug = this.teamSlug();
    if (!teamSlug) return null;
    try {
      const c = await api.createCompany(teamSlug, payload);
      this.toast('Compte créé', 'success');
      await this.loadCompanies();
      if (c?.slug) location.hash = `#/${teamSlug}/companies/${c.slug}`;
      return c;
    } catch (e) {
      this.toast(e.message || 'Échec création compte', 'error');
      return null;
    }
  },

  async updateCompany(id, payload) {
    const teamSlug = this.teamSlug();
    if (!teamSlug) return false;
    try {
      await api.patchCompany(teamSlug, id, payload);
      this.toast('Compte mis à jour', 'success');
      await this.loadCompanies();
      await this.refreshActiveCompany();
      return true;
    } catch (e) {
      this.toast(e.message || 'Échec mise à jour compte', 'error');
      return false;
    }
  },

  /**
   * Optimistic delete of a company from the sidebar + API call.
   * On success, shows an undo toast with a "Annuler" button that calls the
   * backend restore endpoint. Relies on the backend soft-delete pattern:
   *   DELETE /api/teams/{slug}/companies/{id}
   *   POST   /api/teams/{slug}/companies/{id}/restore
   * The cached company is kept in `softDeletedCompanies[id]` so we can re-add
   * it locally without a full refetch.
   */
  async deleteCompany(companyId) {
    const teamSlug = this.teamSlug();
    if (!teamSlug || !companyId) return;

    // Find + snapshot the company before removing it.
    const idx = this.companies.findIndex(c =>
      (c._id === companyId) || (c.id === companyId) || (c.slug === companyId)
    );
    if (idx < 0) return;
    const snapshot = { ...this.companies[idx] };
    const idForApi = snapshot._id || snapshot.id || snapshot.slug;

    // Optimistic remove from sidebar.
    this.companies.splice(idx, 1);

    // If the deleted company was the active one, clear active state + navigate.
    if (this.activeSlug && this.activeSlug === snapshot.slug) {
      this.activeCompany = null;
      this.activeSlug = null;
      if (this.currentTeam?.slug) {
        location.hash = `#/${this.currentTeam.slug}/companies`;
      }
    }

    // Fire the API call. On failure, put it back immediately.
    try {
      await api.deleteCompany(teamSlug, idForApi);
    } catch (e) {
      // Re-insert at the original index, sorted position will be recomputed
      // by components via their own sort function.
      this.companies.splice(idx, 0, snapshot);
      this.toast(e.message || 'Échec suppression compte', 'error');
      return;
    }

    // Cache for potential undo. We keep teamSlug with it because the user
    // might switch teams before clicking undo.
    this.softDeletedCompanies[idForApi] = { company: snapshot, teamSlug };

    // Show undo toast.
    this.showUndoToast({
      message: `Compte « ${snapshot.name || snapshot.slug} » supprimé`,
      actionLabel: 'Annuler',
      duration: 5000,
      onUndo: async () => {
        await this.restoreCompany(idForApi);
      }
    });
  },

  async restoreCompany(companyId) {
    const cached = this.softDeletedCompanies[companyId];
    if (!cached) {
      this.toast('Restauration impossible : cache expiré', 'error');
      return;
    }
    const { company, teamSlug } = cached;
    // Remove from cache before calling API to prevent double-restore.
    delete this.softDeletedCompanies[companyId];
    try {
      // Backend endpoint: POST /api/teams/{slug}/companies/{id}/restore
      // (part of the backend delta referenced in the refactor brief).
      await api.restoreCompany(teamSlug, companyId);
    } catch (e) {
      // Put it back into the cache so a retry is possible.
      this.softDeletedCompanies[companyId] = cached;
      this.toast(e.message || 'Échec restauration', 'error');
      return;
    }

    // Re-insert in the sidebar if we're still on the same team.
    if (this.currentTeam?.slug === teamSlug) {
      // Avoid duplicates if backend also returned it via a parallel refresh.
      const already = this.companies.some(c =>
        (c._id === companyId) || (c.id === companyId) || (c.slug === company.slug)
      );
      if (!already) this.companies.push(company);
    }
    this.toast('Compte restauré', 'success');
    this.clearUndoToast();
  },

  /**
   * Merge a freshly-updated contact (returned from an API call) into
   * `activeCompany.contacts`, without re-fetching the whole company.
   * Returns the merged contact or null if it wasn't in the cached list.
   */
  patchActiveContact(updated) {
    if (!updated || !this.activeCompany?.contacts) return null;
    const id = updated._id || updated.id;
    if (!id) return null;
    const contacts = this.activeCompany.contacts;
    const idx = contacts.findIndex(c => (c._id || c.id) === id);
    if (idx < 0) return null;
    // Spread in place to preserve reactivity.
    contacts[idx] = { ...contacts[idx], ...updated };
    return contacts[idx];
  },

  /**
   * Push a SINGLE contact to Pipedrive and merge the server response into
   * the active company's contacts list so the UI re-renders without a
   * full company refetch.
   */
  async syncContactToPipedrive(contactId) {
    const teamSlug = this.teamSlug();
    if (!teamSlug || !contactId) return null;
    try {
      const updated = await api.syncContactToPipedrive(teamSlug, contactId);
      this.patchActiveContact(updated);
      this.toast('Contact synchronisé avec Pipedrive', 'success');
      return updated;
    } catch (e) {
      this.toast(e.message || 'Sync Pipedrive échouée', 'error');
      throw e;
    }
  },

  /* ===== Freeform view ===== */

  async loadConnections(companySlug) {
    const teamSlug = this.teamSlug();
    const slug = companySlug || this.activeSlug;
    if (!teamSlug || !slug) return;
    this.connectionsLoading = true;
    try {
      const list = await api.listConnections(teamSlug, slug);
      this.connections = Array.isArray(list) ? list : [];
    } catch (e) {
      this.connections = [];
      // Non-blocking: freeform view still works without connections.
      if (e.status && e.status !== 404) {
        this.toast(e.message || 'Erreur chargement connections', 'error');
      }
    } finally {
      this.connectionsLoading = false;
    }
  },

  async createConnection({ source, target, type = 'default', label = '' }) {
    const teamSlug = this.teamSlug();
    const companySlug = this.activeSlug;
    if (!teamSlug || !companySlug || !source || !target) return null;
    // Prevent self-loops and obvious duplicates.
    if (source === target) return null;
    const already = this.connections.find(
      c => c.source_contact_id === source && c.target_contact_id === target
    );
    if (already) return already;
    try {
      const created = await api.createConnection(teamSlug, companySlug, {
        source_contact_id: source,
        target_contact_id: target,
        type,
        label
      });
      if (created) this.connections.push(created);
      return created;
    } catch (e) {
      this.toast(e.message || 'Échec création connection', 'error');
      return null;
    }
  },

  async deleteConnection(id) {
    const teamSlug = this.teamSlug();
    const companySlug = this.activeSlug;
    if (!teamSlug || !companySlug || !id) return false;
    const prev = this.connections;
    // Optimistic remove.
    this.connections = prev.filter(c => (c._id || c.id) !== id);
    try {
      await api.deleteConnection(teamSlug, companySlug, id);
      return true;
    } catch (e) {
      this.connections = prev;
      this.toast(e.message || 'Échec suppression connection', 'error');
      return false;
    }
  },

  /**
   * Persist a contact's freeform position. Optimistic: caller has already
   * mutated the local position for dragging; we just push it to the server.
   * We also merge the returned contact back into activeCompany.contacts so
   * `freeform_position.updated_at` stays in sync.
   */
  async updateContactPosition(contactId, x, y) {
    const teamSlug = this.teamSlug();
    if (!teamSlug || !contactId) return null;
    const payload = { freeform_position: { x: Number(x), y: Number(y) } };
    // Optimistic local update.
    const contacts = this.activeCompany?.contacts || [];
    const idx = contacts.findIndex(c => (c._id || c.id) === contactId);
    if (idx >= 0) {
      contacts[idx] = { ...contacts[idx], freeform_position: { x, y } };
    }
    try {
      const updated = await api.patchContact(teamSlug, contactId, payload);
      this.patchActiveContact(updated);
      return updated;
    } catch (e) {
      // Non-fatal; drag already happened locally. Surface lightly.
      this.toast(e.message || 'Position non sauvegardée', 'error');
      return null;
    }
  }
});

/* ---- helpers exposed for components ---- */

export const CATEGORIES = [
  { key: 'c_level',       label: 'C-Level' },
  { key: 'digital',       label: 'Digital' },
  { key: 'data_ai',       label: 'Data / AI' },
  { key: 'it_is',         label: 'IT / IS' },
  { key: 'medical',       label: 'Medical' },
  { key: 'market_access', label: 'Market Access' },
  { key: 'commercial',    label: 'Commercial' },
  { key: 'rd_clinical',   label: 'R&D / Clinical' },
  { key: 'operations',    label: 'Operations' },
  { key: 'finance',       label: 'Finance' },
  { key: 'legal',         label: 'Legal' },
  { key: 'hr',            label: 'HR' },
  { key: 'marketing',     label: 'Marketing' },
  { key: 'quality',       label: 'Quality' },
  { key: 'other',         label: 'Other' }
];

export const LEVEL_LABELS = {
  1: 'Niveau 1 — PDG / CEO',
  2: 'Niveau 2 — C-Level fonctionnel',
  3: 'Niveau 3 — VP',
  4: 'Niveau 4 — Heads / Directors',
  5: 'Niveau 5 — Managers',
  6: 'Niveau 6 — IC / Other'
};

export const PRIORITY_ORDER = { 'P1+': 4, 'P1': 3, 'P2': 2, 'P3': 1, '': 0 };

export function priorityChipClass(p) {
  if (p === 'P1+') return 'prio-chip prio-P1plus';
  if (p === 'P1')  return 'prio-chip prio-P1';
  if (p === 'P2')  return 'prio-chip prio-P2';
  if (p === 'P3')  return 'prio-chip prio-P3';
  return 'prio-chip prio-none';
}

export function countryFlag(iso) {
  if (!iso || iso.length !== 2) return '';
  const A = 0x1F1E6;
  const code = iso.toUpperCase().charCodeAt(0) - 65 + A;
  const code2 = iso.toUpperCase().charCodeAt(1) - 65 + A;
  try {
    return String.fromCodePoint(code) + String.fromCodePoint(code2);
  } catch (e) { return ''; }
}

/* ICP (Ideal Customer Profile) — set of category keys. User-editable via
   popover in AccountToolbar; persisted in localStorage. */
export const ICP_CATEGORIES_DEFAULT = ['c_level', 'digital', 'data_ai', 'commercial'];
const ICP_STORAGE_KEY = 'icp_categories_v1';

function readICP() {
  try {
    const raw = localStorage.getItem(ICP_STORAGE_KEY);
    if (raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return new Set(arr);
    }
  } catch (e) {}
  return new Set(ICP_CATEGORIES_DEFAULT);
}

export const ICP_CATEGORIES = readICP();

export function setICPCategories(keys) {
  ICP_CATEGORIES.clear();
  for (const k of keys) ICP_CATEGORIES.add(k);
  try { localStorage.setItem(ICP_STORAGE_KEY, JSON.stringify([...ICP_CATEGORIES])); } catch (e) {}
}

export function resetICPCategories() {
  setICPCategories(ICP_CATEGORIES_DEFAULT);
}

export function contactPassesFilters(c, store) {
  if (store.techtomedOnly && !c.is_techtomed) return false;
  if (store.icpOnly) {
    // V2 ICP: filter on backend-computed icp_match_ids (team-scoped roles).
    // If the team hasn't defined ICPs yet, fall back to the legacy
    // category-based toggle so the filter still has an effect.
    const teamHasIcps = (store.teamICPs && store.teamICPs.length > 0);
    if (teamHasIcps) {
      const ids = c.icp_match_ids || [];
      if (!ids.length) return false;
    } else {
      if (!ICP_CATEGORIES.has(c.category)) return false;
    }
  }
  if (store.activeCategories.size > 0 && !store.activeCategories.has(c.category)) return false;
  if (store.activeCountries.size > 0) {
    const country = extractCountry(c.location);
    // Unknown country → filtered out when a country filter is active.
    if (!country || !store.activeCountries.has(country.code)) return false;
  }
  return true;
}

export function initialsOf(text) {
  const n = (text || '').trim();
  if (!n) return '—';
  return n.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

export const ROLE_LABELS = {
  owner:  'Propriétaire',
  admin:  'Admin',
  member: 'Membre'
};
