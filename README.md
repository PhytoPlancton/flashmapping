# FlashMapping

> **Build a clean account map of any company in 5 minutes.**
> Source the right contacts, organise them by your ICPs, and one-click sync to your CRM.

FlashMapping is the account-mapping tool for B2B SDRs and AEs. Drop a company name → we surface every C-Level, VP, Head, and ICP-fit contact, classify them by seniority + role, and let you push the lot to Pipedrive in one click.

Stop spending 30 minutes per account in Sales Navigator. Spend 5.

---

## What you get

- **One-click mapping** — paste a company name, get 30–60 ranked contacts grouped by your Ideal Customer Profile (DRH, Sales Director, Head of L&D, etc.).
- **Smart classification** — every contact auto-tagged with seniority (C-Level / VP / Head / Manager), role category (HR, Commercial, Marketing, IT…), and a 0–100 priority score.
- **ICP-aware** — define your roles once with synonyms (e.g. "DRH" = `chief people`, `head of HR`, `VP people`); contacts matching any synonym light up across every account.
- **Pipedrive sync** — push contacts straight into Pipedrive Persons with custom-field auto-mapping. Detects existing CRM entries by name to avoid duplicates.
- **Folders & multi-team** — organise accounts by vertical, share with teammates via invites, keep a personal space.
- **Org tree views** — Niveaux (hierarchical levels) or Freeform canvas with manual contact placement and connections.
- **Excel export** — download any folder as a Pipedrive-ready XLSX (Organizations + People sheets).

## Pricing (preview)

| Plan | Mappings / month | Teammates | Pipedrive sync | Price |
|---|---:|---:|:---:|---:|
| Free | 3 | 1 | — | €0 |
| Pro | 50 | 1 | ✓ | €29 / mo |
| Team | 500 | 5 | ✓ + multi-CRM | €99 / mo |

Roadmap: HubSpot + Salesforce sync, AI-assisted ICP matching, public-facing prospect mapping.

---

## Tech stack

- **Backend** — FastAPI (Python 3.11) + Motor (async MongoDB) + Pydantic v2. JWT auth (bcrypt passwords), per-team Pipedrive keys encrypted at rest with Fernet.
- **Frontend** — Vue 3 (ESM CDN, no build step) + Tailwind. Component-based, single-page, hash router.
- **Database** — MongoDB Atlas (multi-tenant via `team_id` scoping on every collection).
- **Hosting** — Docker image on GHCR, deployed via Traefik on EDJ Labs (production at https://flashmapping.nmt.ovh).
- **Enrichment** — Clay API for company + contact metadata, classified by an in-house keyword + seniority matcher (`backend/app/taxonomy.py` + `backend/app/icp.py`).

## Repo layout

```
backend/        FastAPI app — auth, teams, companies, contacts,
                folders, Pipedrive sync, taxonomy classifier,
                ICP keyword matcher, security middleware.
frontend/       Vue 3 SPA — sidebar, account page, freeform canvas,
                ICP drawer, Settings popup, all served by FastAPI.
scripts/        One-off ops scripts (Atlas migration, recompute,
                category fixes).
.github/        CI workflow — builds + pushes Docker image to
                ghcr.io/<owner>/flashmapping on every version tag.
Dockerfile      Production image (Python 3.11-slim, uvicorn on $PORT).
```

## Running locally

You need: Python 3.11+, a MongoDB Atlas cluster (free tier works), and optionally a Pipedrive personal API token to test the CRM integration.

```bash
# 1. Backend
cd backend
cp .env.example .env
#    Edit .env: MONGO_URI, MONGO_DB, JWT_SECRET (≥32 chars random),
#    SECRETS_ENCRYPTION_KEY (Fernet), and ENV=dev for local hacking.
pip install -r requirements.txt
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000

# 2. Open http://127.0.0.1:8000 in your browser.
#    First user becomes admin; create a team via onboarding.
```

In production, set `ENV=prod` (hides /docs, /redoc, /openapi.json + enables HSTS) and `ALLOW_OPEN_REGISTRATION=false` (locks public sign-up to invite-only until billing is wired up).

### Generating secrets

```bash
# JWT signing key
openssl rand -hex 48

# Fernet key for encrypting Pipedrive API keys at rest
python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
```

## Deploying

The repo ships with a working CI pipeline:

```bash
git tag v0.7.0
git push origin v0.7.0
# → GitHub Actions builds + pushes ghcr.io/<owner>/flashmapping:0.7.0 + :0.7 + :latest
```

Pin the moving `stable` tag for production:

```bash
git tag -f stable
git push origin stable --force
# → GitHub Actions pushes ghcr.io/<owner>/flashmapping:stable
```

Then deploy `:stable` (or `:latest`) to your container host. The image binds `0.0.0.0:$PORT` (defaults to 3000) and serves both the API (`/api/*`) and the SPA (`/*`). Required runtime env: `MONGO_URI`, `MONGO_DB`, `JWT_SECRET`, plus the optional `ENV=prod` / `ALLOW_OPEN_REGISTRATION` / `SECRETS_ENCRYPTION_KEY` for hardened deployments.

## Security

- Passwords are bcrypt-hashed (12 rounds, via `passlib`). Plaintext passwords are never stored.
- JWTs signed with HS256, 24h TTL.
- Pipedrive API keys encrypted at rest with Fernet (legacy plaintext values transparently re-encrypted on next write).
- Login endpoint is rate-limited (8 / minute / IP). Registration is rate-limited (3 / hour / IP) and lockable behind `ALLOW_OPEN_REGISTRATION=false`.
- Security headers enforced site-wide: HSTS (prod), X-Frame-Options: DENY, X-Content-Type-Options: nosniff, Referrer-Policy: strict-origin-when-cross-origin, Permissions-Policy locked down.
- Team-slug enumeration mitigated (404 for both "doesn't exist" and "exists but you're not a member").
- API documentation (Swagger / Redoc / openapi.json) disabled when `ENV=prod`.

Found a vulnerability? Email `security@<your-domain>` — please don't open a public issue.

## Contributing

This is currently a single-author SaaS in active development. PRs are welcome but expect changes to land fast and APIs to evolve. Open an issue to discuss meaningful contributions before sending a PR.

## License

Proprietary. © 2026 FlashMapping. All rights reserved.
