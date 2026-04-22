// api.js — thin fetch wrapper implementing the SPEC + V2 (teams) contract.
// Base URL empty: the FastAPI backend serves this static bundle from `/`.

import { getToken, clearToken } from './auth.js';

const BASE = '';

async function request(path, { method = 'GET', body, headers = {}, raw = false } = {}) {
  const token = getToken();
  const h = { 'Accept': 'application/json', ...headers };
  if (body && !(body instanceof FormData)) h['Content-Type'] = 'application/json';
  if (token) h['Authorization'] = `Bearer ${token}`;

  let res;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: h,
      body: body && !(body instanceof FormData) ? JSON.stringify(body) : body
    });
  } catch (networkErr) {
    const err = new Error('Network error — is the backend running?');
    err.cause = networkErr;
    err.network = true;
    throw err;
  }

  if (res.status === 401) {
    clearToken();
    if (!location.hash.startsWith('#/login')) {
      location.hash = '#/login';
    }
    throw new ApiError('Non authentifié', 401);
  }

  if (res.status === 204) return null;

  if (raw) return res;

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    data = await res.json().catch(() => null);
  } else {
    data = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const msg = (data && data.detail) || `HTTP ${res.status}`;
    throw new ApiError(msg, res.status, data);
  }

  return data;
}

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

const enc = encodeURIComponent;

/* ============ Auth ============ */

export const bootstrap = () => request('/api/auth/bootstrap');
export const login = (email, password) => request('/api/auth/login', { method: 'POST', body: { email, password } });
export const register = (email, password, name) => request('/api/auth/register', { method: 'POST', body: { email, password, name } });
export const me = () => request('/api/auth/me');
export const logout = () => request('/api/auth/logout', { method: 'POST' });

// V2 — profile
export const updateProfile = ({ name, email } = {}) => {
  const body = {};
  if (name !== undefined) body.name = name;
  if (email !== undefined) body.email = email;
  return request('/api/auth/me', { method: 'PATCH', body });
};
export const changePassword = ({ current_password, new_password }) =>
  request('/api/auth/change-password', { method: 'POST', body: { current_password, new_password } });

// V2 — onboarding state
export const onboardingState = () => request('/api/auth/onboarding-state');

/* ============ Teams ============ */

export const listTeams  = () => request('/api/teams');
export const createTeam = ({ name }) => request('/api/teams', { method: 'POST', body: { name } });
export const getTeam    = (slug) => request(`/api/teams/${enc(slug)}`);
export const patchTeam  = (slug, { name }) => request(`/api/teams/${enc(slug)}`, { method: 'PATCH', body: { name } });
export const deleteTeam = (slug) => request(`/api/teams/${enc(slug)}`, { method: 'DELETE' });

export const patchTeamICPs = (slug, { icps, icp_llm_enabled }) =>
  request(`/api/teams/${enc(slug)}/icps`, {
    method: 'PATCH',
    body: { icps, icp_llm_enabled }
  });
export const recomputeICPsLLM = (slug) =>
  request(`/api/teams/${enc(slug)}/icps/llm-recompute`, { method: 'POST' });

/* ============ Members ============ */

export const listMembers  = (slug) => request(`/api/teams/${enc(slug)}/members`);
export const patchMember  = (slug, userId, { role }) =>
  request(`/api/teams/${enc(slug)}/members/${enc(userId)}`, { method: 'PATCH', body: { role } });
export const removeMember = (slug, userId) =>
  request(`/api/teams/${enc(slug)}/members/${enc(userId)}`, { method: 'DELETE' });

/* ============ Invites ============ */

export const listInvites   = (slug) => request(`/api/teams/${enc(slug)}/invites`);
export const createInvite  = (slug, { role, expires_in_days, max_uses } = {}) => {
  const body = { role: role || 'member' };
  if (expires_in_days !== undefined) body.expires_in_days = expires_in_days;
  if (max_uses !== undefined) body.max_uses = max_uses;
  return request(`/api/teams/${enc(slug)}/invites`, { method: 'POST', body });
};
export const revokeInvite  = (slug, inviteId) =>
  request(`/api/teams/${enc(slug)}/invites/${enc(inviteId)}`, { method: 'DELETE' });
export const acceptInvite  = ({ code }) =>
  request('/api/teams/accept-invite', { method: 'POST', body: { code } });

/* ============ Companies (team-scoped) ============ */

export const listCompanies  = (teamSlug) =>
  request(`/api/teams/${enc(teamSlug)}/companies`);
export const getCompany     = (teamSlug, companySlug) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}`);
export const createCompany  = (teamSlug, payload) =>
  request(`/api/teams/${enc(teamSlug)}/companies`, { method: 'POST', body: payload });
export const patchCompany   = (teamSlug, id, payload) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(id)}`, { method: 'PATCH', body: payload });
export const deleteCompany  = (teamSlug, id) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(id)}`, { method: 'DELETE' });
export const restoreCompany = (teamSlug, id) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(id)}/restore`, { method: 'POST' });

/* ============ Folders (team-scoped) ============ */

export const listFolders = (teamSlug) =>
  request(`/api/teams/${enc(teamSlug)}/folders`);

export const createFolder = (teamSlug, { name, icon, color } = {}) => {
  const body = { name };
  if (icon !== undefined) body.icon = icon;
  if (color !== undefined) body.color = color;
  return request(`/api/teams/${enc(teamSlug)}/folders`, { method: 'POST', body });
};

export const patchFolder = (teamSlug, id, payload) =>
  request(`/api/teams/${enc(teamSlug)}/folders/${enc(id)}`, { method: 'PATCH', body: payload });

export const deleteFolder = (teamSlug, id) =>
  request(`/api/teams/${enc(teamSlug)}/folders/${enc(id)}`, { method: 'DELETE' });

export const reorderFolders = (teamSlug, ids) =>
  request(`/api/teams/${enc(teamSlug)}/folders/reorder`, { method: 'POST', body: { ids } });

// Thin wrapper over patchCompany for the folder-move flow.
// folderId === null moves the company back to the root ("Sans dossier").
export const moveCompanyToFolder = (teamSlug, companyId, folderId) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(companyId)}`, {
    method: 'PATCH',
    body: { folder_id: folderId }
  });

// Reorder a batch of companies inside one container (folder or root).
// `folderId === null` → root ("Sans dossier"). `orderedIds` is the new
// order for the listed ids (backend writes position = index). The same call
// also (re)assigns `folder_id` on every listed company — so it doubles as a
// cross-folder move with a precise insertion index.
export const reorderCompaniesInFolder = (teamSlug, folderId, orderedIds) =>
  request(`/api/teams/${enc(teamSlug)}/companies/reorder`, {
    method: 'POST',
    body: { folder_id: folderId || null, ordered_ids: orderedIds }
  });

/* ============ Contacts (team-scoped) ============ */

export const listContacts   = (teamSlug, companySlug) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/contacts`);
export const createContact  = (teamSlug, companySlug, payload) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/contacts`, { method: 'POST', body: payload });
export const patchContact   = (teamSlug, id, payload) =>
  request(`/api/teams/${enc(teamSlug)}/contacts/${enc(id)}`, { method: 'PATCH', body: payload });
export const deleteContact  = (teamSlug, id) =>
  request(`/api/teams/${enc(teamSlug)}/contacts/${enc(id)}`, { method: 'DELETE' });
export const moveContact    = (teamSlug, id, { level, position_in_level }) =>
  request(`/api/teams/${enc(teamSlug)}/contacts/${enc(id)}/move`, {
    method: 'POST',
    body: { level, position_in_level }
  });

/* ============ Connections (freeform view — team + company scoped) ============ */

export const listConnections = (teamSlug, companySlug) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/connections`);

export const createConnection = (
  teamSlug,
  companySlug,
  { source_contact_id, target_contact_id, type = 'default', label = '' } = {}
) =>
  request(`/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/connections`, {
    method: 'POST',
    body: { source_contact_id, target_contact_id, type, label }
  });

export const deleteConnection = (teamSlug, companySlug, id) =>
  request(
    `/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/connections/${enc(id)}`,
    { method: 'DELETE' }
  );

export const patchConnection = (teamSlug, companySlug, id, payload) =>
  request(
    `/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/connections/${enc(id)}`,
    { method: 'PATCH', body: payload }
  );

/* ============ Taxonomy (unscoped utility) ============ */

export const classifyTitle = (title) =>
  request('/api/taxonomy/classify', { method: 'POST', body: { title } });

/* ============ Admin / seed / export (team-scoped) ============ */

export const seed = (teamSlug) =>
  request(`/api/teams/${enc(teamSlug)}/admin/seed`, { method: 'POST' });

/* ============ Pipedrive (push-only) ============ */

export const pipedriveStatus = (teamSlug) =>
  request(`/api/teams/${enc(teamSlug)}/pipedrive/status`);

export const connectPipedrive = (teamSlug, { api_key }) =>
  request(`/api/teams/${enc(teamSlug)}/pipedrive/connect`, {
    method: 'POST',
    body: { api_key }
  });

export const disconnectPipedrive = (teamSlug) =>
  request(`/api/teams/${enc(teamSlug)}/pipedrive/connect`, { method: 'DELETE' });

export const syncCompanyToPipedrive = (teamSlug, companySlug) =>
  request(
    `/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/pipedrive/sync`,
    { method: 'POST' }
  );

export const syncContactToPipedrive = (teamSlug, contactId) =>
  request(
    `/api/teams/${enc(teamSlug)}/contacts/${enc(contactId)}/pipedrive/sync`,
    { method: 'POST' }
  );

// Silent backfill: link FM contacts of a company to their existing Pipedrive
// person (if any) by name + org match. Fire-and-forget from the UI.
export const pipedriveAutoMatchCompany = (teamSlug, companySlug) =>
  request(
    `/api/teams/${enc(teamSlug)}/companies/${enc(companySlug)}/pipedrive/auto-match`,
    { method: 'POST' }
  );

// --- Custom-field mapping --------------------------------------------------
// Drive the Settings > Intégrations > Pipedrive "Mapping des champs" panel.
//   GET    /fields          → schema + mapping + whitelist (any member)
//   POST   /fields/refresh  → force re-fetch + auto-map (admin+)
//   PATCH  /fields/mapping  → full replace of the mapping dict (admin+)
export const pipedriveListFields = (teamSlug) =>
  request(`/api/teams/${enc(teamSlug)}/pipedrive/fields`);

export const pipedriveRefreshFields = (teamSlug) =>
  request(`/api/teams/${enc(teamSlug)}/pipedrive/fields/refresh`, { method: 'POST' });

export const pipedriveUpdateMapping = (teamSlug, mapping) =>
  request(`/api/teams/${enc(teamSlug)}/pipedrive/fields/mapping`, {
    method: 'PATCH',
    body: { mapping: mapping || {} }
  });

export async function exportXlsx(teamSlug) {
  const res = await request(`/api/teams/${enc(teamSlug)}/admin/export/xlsx`, { raw: true });
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `mapping_${teamSlug}_${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default {
  bootstrap, login, register, me, logout,
  updateProfile, changePassword, onboardingState,
  listTeams, createTeam, getTeam, patchTeam, deleteTeam,
  patchTeamICPs, recomputeICPsLLM,
  listMembers, patchMember, removeMember,
  listInvites, createInvite, revokeInvite, acceptInvite,
  listCompanies, getCompany, createCompany, patchCompany, deleteCompany, restoreCompany,
  listFolders, createFolder, patchFolder, deleteFolder, reorderFolders, moveCompanyToFolder,
  reorderCompaniesInFolder,
  listContacts, createContact, patchContact, deleteContact, moveContact,
  listConnections, createConnection, deleteConnection, patchConnection,
  classifyTitle, seed, exportXlsx,
  pipedriveStatus, connectPipedrive, disconnectPipedrive,
  syncCompanyToPipedrive, syncContactToPipedrive, pipedriveAutoMatchCompany,
  pipedriveListFields, pipedriveRefreshFields, pipedriveUpdateMapping
};
