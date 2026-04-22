"""Pydantic v2 models for the FlashMapping API."""
from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Any, Literal, Optional

from bson import ObjectId
from pydantic import (
    BaseModel,
    BeforeValidator,
    ConfigDict,
    EmailStr,
    Field,
    model_validator,
)

# ---------------------------------------------------------------------------
# ObjectId helper
# ---------------------------------------------------------------------------


def _coerce_objectid(v: Any) -> str:
    """Accept ObjectId/str, always return the hex string form."""
    if v is None:
        return v
    if isinstance(v, ObjectId):
        return str(v)
    if isinstance(v, str):
        return v
    raise TypeError(f"Cannot coerce {type(v)} to ObjectId string")


PyObjectId = Annotated[str, BeforeValidator(_coerce_objectid)]


class MongoModel(BaseModel):
    """Base for any document coming out of MongoDB.

    Serialises `_id` as `_id` (alias) rather than the internal field name `id`.
    """

    model_config = ConfigDict(
        populate_by_name=True,
        arbitrary_types_allowed=True,
        str_strip_whitespace=False,
        ser_json_by_alias=True,
    )


# ---------------------------------------------------------------------------
# Auth
# ---------------------------------------------------------------------------

Role = Literal["admin", "user"]
TeamRole = Literal["owner", "admin", "member"]
TeamRoleAssignable = Literal["admin", "member"]  # can't assign "owner" via API


class UserPublic(MongoModel):
    id: PyObjectId = Field(alias="_id")
    email: EmailStr
    name: str
    role: Role
    created_at: Optional[datetime] = None
    last_login: Optional[datetime] = None


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=6)
    name: str = Field(min_length=1)


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserPublic


class BootstrapResponse(BaseModel):
    bootstrap_needed: bool


class UpdateMeRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)
    email: Optional[EmailStr] = None


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str = Field(min_length=6)


class OnboardingStateResponse(BaseModel):
    has_teams: bool
    teams_count: int


# ---------------------------------------------------------------------------
# Teams
# ---------------------------------------------------------------------------


class TeamSettings(BaseModel):
    """Full TeamSettings — includes secrets. Never serialise this to HTTP.

    Use `TeamSettingsPublic` for any outbound response.
    """
    default_currency: str = ""
    # Pipedrive connection (per-team). Stored in plaintext in MongoDB — the
    # DB is Nicolas' own Atlas; encryption-at-rest can be added later.
    pipedrive_api_key: Optional[str] = None
    pipedrive_connected_at: Optional[datetime] = None
    pipedrive_user_name: Optional[str] = None
    pipedrive_company_domain: Optional[str] = None

    # --- Pipedrive custom-field mapping (V4) ---
    # `pipedrive_person_field_mapping` maps *our* internal contact keys
    # (e.g. "linkedin_url", "category", "seniority") to the *Pipedrive* field
    # key (the hashed column name for custom fields, or the standard name for
    # native ones). Example:
    #   {"linkedin_url": "f1ab23…hash", "headline": "c4de56…hash"}
    # Our internal keys are a stable whitelist declared in
    # `routes/pipedrive.py::AVAILABLE_OUR_FIELDS` — see that module for the
    # authoritative list + heuristics used to auto-detect each one.
    pipedrive_person_field_mapping: dict[str, str] = Field(default_factory=dict)
    # Timestamp of the last successful /personFields fetch. Used as a TTL
    # marker: the auto-map routine refreshes the cache if older than 24h.
    pipedrive_field_schema_cached_at: Optional[datetime] = None
    # Raw list of Pipedrive field dicts as returned by /personFields, kept
    # verbatim so the Settings UI can render a full "<select>" of candidates
    # without having to re-hit Pipedrive on every page load. Each entry has
    # at least `key`, `name`, `field_type`, and `edit_flag`.
    pipedrive_field_schema: Optional[list[dict]] = None

    # --- ICP (Ideal Customer Profile) roles ---
    # List of role definitions (DRH, Dir Commercial, Resp Formation…) used to
    # match contact titles. Keyword matcher first, optional LLM fallback.
    icps: list["ICP"] = Field(default_factory=list)
    # Enable LLM fallback (Anthropic Claude) on contacts no keyword matched.
    icp_llm_enabled: bool = False


class ICP(BaseModel):
    """One Ideal-Customer-Profile role definition, team-scoped.

    Matched against `contact.title` (and optionally LLM-assisted). A contact
    can match multiple ICPs. Stored on `team.settings.icps`.
    """
    id: str  # short random slug, generated client-side or in PATCH handler
    name: str
    emoji: str = "👤"
    # Case- and accent-insensitive substring patterns. A title matches if it
    # *contains* any synonym (after normalize). Empty list = ICP never matches
    # via keywords (only via LLM fallback, if enabled).
    synonyms: list[str] = Field(default_factory=list)


class TeamSettingsPublic(BaseModel):
    """Sanitised projection of TeamSettings exposed in team responses.

    The Pipedrive API key is never returned verbatim — only a masked hint
    (last 4 chars) so the UI can render "configured" state without ever
    receiving the full secret.
    """
    default_currency: str = ""
    pipedrive_configured: bool = False
    pipedrive_api_key_hint: Optional[str] = None  # e.g. "****abcd"
    pipedrive_connected_at: Optional[datetime] = None
    pipedrive_user_name: Optional[str] = None
    pipedrive_company_domain: Optional[str] = None
    icps: list[ICP] = Field(default_factory=list)
    icp_llm_enabled: bool = False
    icp_llm_available: bool = False  # True if ANTHROPIC_API_KEY is configured

    @classmethod
    def from_settings(
        cls, s: Optional[dict | "TeamSettings"]
    ) -> "TeamSettingsPublic":
        if s is None:
            return cls()
        if isinstance(s, TeamSettings):
            data = s.model_dump()
        else:
            data = dict(s)
        key = (data.get("pipedrive_api_key") or "").strip()
        hint: Optional[str] = None
        if key:
            hint = f"****{key[-4:]}" if len(key) >= 4 else "****"
        # Import lazily to avoid circulars at module import time.
        import os
        llm_available = bool((os.environ.get("ANTHROPIC_API_KEY") or "").strip())
        icps_raw = data.get("icps") or []
        icps: list[ICP] = []
        for it in icps_raw:
            if isinstance(it, ICP):
                icps.append(it)
            elif isinstance(it, dict):
                try:
                    icps.append(ICP(**it))
                except Exception:
                    continue
        return cls(
            default_currency=data.get("default_currency", "") or "",
            pipedrive_configured=bool(key),
            pipedrive_api_key_hint=hint,
            pipedrive_connected_at=data.get("pipedrive_connected_at"),
            pipedrive_user_name=data.get("pipedrive_user_name"),
            pipedrive_company_domain=data.get("pipedrive_company_domain"),
            icps=icps,
            icp_llm_enabled=bool(data.get("icp_llm_enabled")),
            icp_llm_available=llm_available,
        )


class TeamBase(BaseModel):
    name: str
    slug: str
    settings: TeamSettingsPublic = Field(default_factory=TeamSettingsPublic)


class TeamOut(MongoModel):
    id: PyObjectId = Field(alias="_id")
    name: str
    slug: str
    owner_id: PyObjectId
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    # A "personal space": auto-created for every user at register time. The
    # user owns it, cannot leave it, cannot delete it. Guarantees that every
    # user always has at least one team (no empty-state dead-end).
    is_personal: bool = False
    # Public, sanitised settings — never contains the raw API key.
    settings: TeamSettingsPublic = Field(default_factory=TeamSettingsPublic)

    @model_validator(mode="before")
    @classmethod
    def _sanitise_settings(cls, data: Any) -> Any:
        """Replace raw settings dict (which may carry the Pipedrive API key
        or other internal fields) with a sanitised `TeamSettingsPublic`
        projection before pydantic touches it. This guarantees the secret
        never leaks into HTTP output.
        """
        if isinstance(data, dict):
            raw = data.get("settings")
            if isinstance(raw, dict):
                data = {**data, "settings": TeamSettingsPublic.from_settings(raw)}
        return data


class TeamSummaryOut(TeamOut):
    """Team summary including current user's role and aggregated counts."""
    role: TeamRole
    members_count: int = 0
    companies_count: int = 0


class TeamCreateRequest(BaseModel):
    name: str = Field(min_length=1)


class TeamUpdateRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1)


class TeamICPsUpdateRequest(BaseModel):
    """PATCH payload for the team's ICP list + LLM toggle."""
    icps: Optional[list[ICP]] = None
    icp_llm_enabled: Optional[bool] = None


class TeamMemberOut(MongoModel):
    id: PyObjectId = Field(alias="_id")
    team_id: PyObjectId
    user_id: PyObjectId
    role: TeamRole
    joined_at: Optional[datetime] = None
    invited_by: Optional[PyObjectId] = None
    # User info (joined)
    email: Optional[EmailStr] = None
    name: Optional[str] = None


class TeamMemberRoleUpdate(BaseModel):
    role: TeamRoleAssignable


class TeamDetailOut(TeamOut):
    role: TeamRole  # current user's role
    members: list[TeamMemberOut] = Field(default_factory=list)
    members_count: int = 0
    companies_count: int = 0


# ---------------------------------------------------------------------------
# Invites
# ---------------------------------------------------------------------------


class TeamInviteOut(MongoModel):
    id: PyObjectId = Field(alias="_id")
    team_id: PyObjectId
    code: str
    role: TeamRoleAssignable
    created_by: PyObjectId
    created_at: Optional[datetime] = None
    expires_at: Optional[datetime] = None
    used_by: Optional[PyObjectId] = None
    used_at: Optional[datetime] = None
    max_uses: int = 1
    uses: int = 0


class TeamInviteCreateRequest(BaseModel):
    role: TeamRoleAssignable = "member"
    max_uses: int = Field(default=1, ge=1, le=1000)
    expires_in_days: int = Field(default=30, ge=1, le=365)


class AcceptInviteRequest(BaseModel):
    code: str = Field(min_length=1)


class AcceptInviteResponse(BaseModel):
    team: TeamOut


# ---------------------------------------------------------------------------
# Folders (organise companies in a team workspace)
# ---------------------------------------------------------------------------


class FolderBase(BaseModel):
    """Shared shape for inbound folder payloads.

    `parent_folder_id` is reserved for V2 (nested) and always `None` in V1.
    `color` is optional pastel hex or Tailwind token — also UI-only for now.
    `position` is a manual sort key; the route auto-fills it at creation.
    """
    name: str = Field(min_length=1, max_length=80)
    icon: Optional[str] = None            # short emoji (e.g. "📁", "💊")
    color: Optional[str] = None           # pastel hex / token, reserved
    parent_folder_id: Optional[PyObjectId] = None  # reserved for nested V2
    position: int = 0                     # manual sort; auto-filled on create


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    icon: Optional[str] = None
    color: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=80)
    icon: Optional[str] = None
    color: Optional[str] = None
    position: Optional[int] = None


class FolderReorderRequest(BaseModel):
    """Ordered list of folder ids. `position` is rewritten to match the index."""
    ids: list[str] = Field(default_factory=list)


class FolderOut(MongoModel):
    id: PyObjectId = Field(alias="_id")
    team_id: PyObjectId
    name: str
    icon: Optional[str] = None
    color: Optional[str] = None
    parent_folder_id: Optional[PyObjectId] = None
    position: int = 0
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[PyObjectId] = None
    # Aggregated count of live companies in this folder (excludes soft-deleted).
    companies_count: int = 0


# ---------------------------------------------------------------------------
# Companies
# ---------------------------------------------------------------------------

Priority = Literal["P1+", "P1", "P2", "P3", ""]


class CompanyBase(BaseModel):
    name: str
    slug: str
    domain: str = ""
    linkedin_url: str = ""
    priority: Priority = ""
    crm_id: str = ""
    pic: str = ""
    crm_status: str = ""
    work_status: str = ""
    next_step: str = ""
    industry: str = ""
    headcount: int = 0
    hq: str = ""
    country: str = ""
    annual_revenue: str = ""
    therapeutic_areas: list[str] = Field(default_factory=list)
    comments_crm: str = ""
    # Organisation folder. `None` = root ("Sans dossier" in the sidebar). A
    # company belongs to at most one folder (arborescence, not tags).
    folder_id: Optional[PyObjectId] = None
    # Manual sort position within the company's container (folder_id or root).
    # Lower = earlier. Rewritten by the `/companies/reorder` route; new
    # companies default to 0 so they float at the top of their container (the
    # comparator's tie-breakers — techtomed_count then name — keep ordering
    # deterministic before any manual reorder happens).
    position: int = 0


class CompanyCreate(CompanyBase):
    pass


# Sentinel used by `CompanyUpdate` to distinguish "folder_id not provided"
# from "folder_id: null" (reset to root). Pydantic can't natively represent
# that tri-state on a single field, so we rely on `model_fields_set` in the
# route handler.
class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    slug: Optional[str] = None
    domain: Optional[str] = None
    linkedin_url: Optional[str] = None
    priority: Optional[Priority] = None
    crm_id: Optional[str] = None
    pic: Optional[str] = None
    crm_status: Optional[str] = None
    work_status: Optional[str] = None
    next_step: Optional[str] = None
    industry: Optional[str] = None
    headcount: Optional[int] = None
    hq: Optional[str] = None
    country: Optional[str] = None
    annual_revenue: Optional[str] = None
    therapeutic_areas: Optional[list[str]] = None
    comments_crm: Optional[str] = None
    # `folder_id` is tri-state:
    #   - absent from the payload → no change (dropped by `exclude_unset`)
    #   - explicit `null`         → move to root
    #   - ObjectId string         → move to that folder (validated team-scope)
    # The route handler uses `model_fields_set` to detect the explicit-null
    # case, because `None` alone is indistinguishable from "not provided".
    folder_id: Optional[PyObjectId] = None


class CompanyReorderRequest(BaseModel):
    """Reorder companies within one container (folder or root).

    `folder_id` identifies the target container — `None` / missing means the
    implicit root ("Sans dossier"). `ordered_ids` is the new ordering for the
    listed ids; any company in the same container but absent from the list
    keeps its relative order, shifted after the reordered block.

    Accepting `folder_id` in the payload (rather than deriving it from the
    ids) means the reorder endpoint can also perform a cross-container move:
    every id in `ordered_ids` has its `folder_id` rewritten to the payload's
    target.
    """

    folder_id: Optional[PyObjectId] = None
    ordered_ids: list[str] = Field(default_factory=list)


class CompanyOut(CompanyBase, MongoModel):
    id: PyObjectId = Field(alias="_id")
    team_id: Optional[PyObjectId] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[PyObjectId] = None
    # Soft-delete marker. When set, the company is hidden from all list/get
    # endpoints and will be hard-deleted (cascade to contacts) by the
    # background purger after 24h. Unset via POST /restore.
    deleted_at: Optional[datetime] = None
    contact_count: int = 0
    techtomed_count: int = 0


# ---------------------------------------------------------------------------
# Contacts
# ---------------------------------------------------------------------------

Category = Literal[
    "c_level", "digital", "data_ai", "it_is", "medical",
    "market_access", "commercial", "rd_clinical",
    "operations", "finance", "legal",
    "hr", "marketing", "quality", "other",
]

Source = Literal["techtomed", "mcp_enrich", "crm", "manual"]

Decision = Literal["decision", "influencer", ""]

Qualification = Literal["cold", "warm", "hot", "customer", "lost"]


class ContactBase(BaseModel):
    name: str
    title: str = ""
    email: str = ""
    phone: str = ""
    linkedin_url: str = ""
    location: str = ""
    level: int = Field(default=6, ge=1, le=6)
    category: Category = "other"
    seniority: str = "Unknown"
    flag_c_level: bool = False
    flag_bu_head: bool = False
    flag_manager_of_managers: bool = False
    therapeutic_areas: list[str] = Field(default_factory=list)
    priority_score: int = 0
    source: Source = "manual"
    is_techtomed: bool = False
    position_in_level: int = 0
    notes: str = ""
    decision_vs_influencer: Decision = ""
    # Pipedrive sync metadata (push-only integration)
    pipedrive_person_id: Optional[int] = None
    pipedrive_synced_at: Optional[datetime] = None
    # Pipedrive Note id — notes are a separate entity in Pipedrive
    # (POST /notes), not a Person attribute. Stored so re-sync updates
    # the same note instead of creating duplicates.
    pipedrive_note_id: Optional[int] = None
    # Freeform canvas position. `None` = not yet placed manually (UI falls back
    # to auto-layout from levels). Shape: {"x": float, "y": float}. Positions
    # are shared across the whole team — stored on the contact doc itself.
    freeform_position: Optional[dict] = None
    # IDs of team ICPs matched by this contact's title (team.settings.icps[].id).
    icp_match_ids: list[str] = Field(default_factory=list)

    # ---- Pipedrive-inspired Person fields (V3) ----
    # Contact info
    mobile_phone: Optional[str] = None       # mobile phone (separate from `phone`)
    secondary_email: Optional[str] = None    # personal / backup email
    website: Optional[str] = None            # personal site / blog URL
    # Detailed location (in addition to the free-text `location`)
    address: Optional[str] = None            # full postal address
    city: Optional[str] = None
    country: Optional[str] = None            # ISO2 ("FR") or label ("France")
    # Ownership / qualification
    owner_id: Optional[PyObjectId] = None    # team member assigned — ref users._id
    qualification: Optional[Qualification] = None
    lead_source: Optional[str] = None        # "linkedin", "referral", "event"…
    # Activity / CRM
    labels: list[str] = Field(default_factory=list)  # free-form tags
    last_contacted_at: Optional[datetime] = None
    next_action: Optional[str] = None        # "Send email", "Call", "LinkedIn DM"…
    next_action_at: Optional[datetime] = None
    birthday: Optional[date] = None          # rare but Pipedrive-standard


class ContactCreate(BaseModel):
    name: str
    title: str = ""
    email: str = ""
    phone: str = ""
    linkedin_url: str = ""
    location: str = ""
    level: Optional[int] = Field(default=None, ge=1, le=6)
    category: Optional[Category] = None
    seniority: Optional[str] = None
    flag_c_level: Optional[bool] = None
    flag_bu_head: Optional[bool] = None
    flag_manager_of_managers: Optional[bool] = None
    therapeutic_areas: Optional[list[str]] = None
    priority_score: Optional[int] = None
    source: Source = "manual"
    is_techtomed: bool = False
    position_in_level: Optional[int] = None
    notes: str = ""
    decision_vs_influencer: Decision = ""


class ContactUpdate(BaseModel):
    name: Optional[str] = None
    title: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None
    linkedin_url: Optional[str] = None
    location: Optional[str] = None
    level: Optional[int] = Field(default=None, ge=1, le=6)
    category: Optional[Category] = None
    seniority: Optional[str] = None
    flag_c_level: Optional[bool] = None
    flag_bu_head: Optional[bool] = None
    flag_manager_of_managers: Optional[bool] = None
    therapeutic_areas: Optional[list[str]] = None
    priority_score: Optional[int] = None
    source: Optional[Source] = None
    is_techtomed: Optional[bool] = None
    position_in_level: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = None
    decision_vs_influencer: Optional[Decision] = None
    # Freeform canvas position. Explicit `null` = reset (card will fall back to
    # auto-layout). Absent from payload = no change. The PATCH route preserves
    # `None` only for this field; all others drop Nones.
    freeform_position: Optional[dict] = None

    # ---- Pipedrive-inspired Person fields (V3) ----
    mobile_phone: Optional[str] = None
    secondary_email: Optional[str] = None
    website: Optional[str] = None
    address: Optional[str] = None
    city: Optional[str] = None
    country: Optional[str] = None
    owner_id: Optional[PyObjectId] = None
    qualification: Optional[Qualification] = None
    lead_source: Optional[str] = None
    labels: Optional[list[str]] = None
    last_contacted_at: Optional[datetime] = None
    next_action: Optional[str] = None
    next_action_at: Optional[datetime] = None
    birthday: Optional[date] = None


class ContactMove(BaseModel):
    level: int = Field(ge=1, le=6)
    position_in_level: int = Field(ge=0)


class ContactOut(ContactBase, MongoModel):
    id: PyObjectId = Field(alias="_id")
    company_id: PyObjectId
    team_id: Optional[PyObjectId] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[PyObjectId] = None


class CompanyDetailOut(CompanyOut):
    contacts: list[ContactOut] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Taxonomy
# ---------------------------------------------------------------------------


class TaxonomyRequest(BaseModel):
    title: str


class TaxonomyResponse(BaseModel):
    level: int
    category: Category
    seniority: str
    flag_c_level: bool
    flag_bu_head: bool
    flag_manager_of_managers: bool
    therapeutic_areas: list[str]
    priority_score: int


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------


class SeedResponse(BaseModel):
    companies_created: int
    companies_skipped: int
    contacts_created: int
    techtomed_matched: int


# ---------------------------------------------------------------------------
# Pipedrive integration
# ---------------------------------------------------------------------------


class PipedriveSyncError(BaseModel):
    contact_id: str
    contact_name: str = ""
    error: str


class PipedriveSyncResponse(BaseModel):
    synced: int = 0
    created: int = 0
    updated: int = 0
    skipped: int = 0
    errors: list[PipedriveSyncError] = Field(default_factory=list)
    org_id: Optional[int] = None
    last_synced_at: Optional[datetime] = None


class PipedriveUserInfo(BaseModel):
    id: Optional[int] = None
    name: Optional[str] = None
    email: Optional[str] = None
    company_domain: Optional[str] = None
    company_name: Optional[str] = None


class PipedriveStatusResponse(BaseModel):
    configured: bool
    user: Optional[PipedriveUserInfo] = None
    error: Optional[str] = None
    company_domain: Optional[str] = None
    connected_at: Optional[datetime] = None
    # "db" if the key is stored in team settings; "env" if falling back to the
    # environment variable; None if not configured at all. The UI disables the
    # "Disconnect" button when source == "env".
    source: Optional[str] = None


class PipedriveConnectRequest(BaseModel):
    api_key: str = Field(min_length=1)


class PipedriveConnectResponse(BaseModel):
    connected: bool
    user_name: Optional[str] = None
    company_domain: Optional[str] = None
    connected_at: Optional[datetime] = None


# --- Pipedrive custom-field mapping (V4) -----------------------------------
#
# These power the Settings > Intégrations > Pipedrive "Mapping des champs"
# panel. The GET endpoint returns the full Pipedrive field catalog, the
# current mapping, and the list of our internal fields so the UI can build a
# select for each row without needing to hard-code anything frontend-side.


class PipedriveFieldOut(BaseModel):
    """Trimmed projection of a Pipedrive /personFields entry.

    We expose only what the UI needs to render a <select>. The raw dict is
    also cached in `team.settings.pipedrive_field_schema` for any future
    feature that needs more (e.g. enum options).
    """
    key: str
    name: str
    field_type: Optional[str] = None
    editable: bool = True
    # For enum/set fields. Each option: { "id": int, "label": str }. Not used
    # by the current V1 "string-only" push but surfaced so the UI can warn.
    options: Optional[list[dict]] = None


class PipedriveFieldsResponse(BaseModel):
    """Response of GET /teams/{slug}/pipedrive/fields."""
    fields: list[PipedriveFieldOut] = Field(default_factory=list)
    # `mapping[our_key] = pipedrive.key`. Only entries explicitly mapped
    # (either auto-detected or manually set) are present.
    mapping: dict[str, str] = Field(default_factory=dict)
    # Internal field whitelist — the UI iterates this to render one row per
    # known "our field" so the order/labels stay under backend control.
    available_our_fields: list[str] = Field(default_factory=list)
    # Subset of `mapping` whose values were populated by the auto-detect
    # heuristic. The UI uses this to show the little green "Auto-détecté"
    # badge. Entries that are present in `mapping` but NOT here are
    # considered manually-curated.
    auto_detected: list[str] = Field(default_factory=list)
    cached_at: Optional[datetime] = None


class PipedriveMappingUpdateRequest(BaseModel):
    """PATCH body — full replace (not a merge) of the mapping dict.

    Admin-only. Empty string or missing key = remove the mapping for that
    field (falls back to the Notes block). Unknown our_keys are rejected by
    the route handler so we fail loud rather than silently storing garbage.
    """
    mapping: dict[str, str] = Field(default_factory=dict)


# ---------------------------------------------------------------------------
# Connections (Freeform view — edges between contacts within a company)
# ---------------------------------------------------------------------------


class ConnectionCreate(BaseModel):
    source_contact_id: str = Field(min_length=1)
    target_contact_id: str = Field(min_length=1)
    type: str = "default"
    label: str = ""


class ConnectionUpdate(BaseModel):
    type: Optional[str] = None
    label: Optional[str] = None


class ConnectionOut(MongoModel):
    id: PyObjectId = Field(alias="_id")
    team_id: PyObjectId
    company_id: PyObjectId
    source_contact_id: PyObjectId
    target_contact_id: PyObjectId
    type: str = "default"
    label: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    created_by: Optional[PyObjectId] = None
