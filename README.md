# CTO Marketplace Backend (NestJS)

A production-ready Solana token vetting API built with NestJS. Provides automated token analysis, tier classification, risk scoring, and image handling with Redis caching and Prisma/PostgreSQL.

This README documents the current architecture, how to run locally, how to deploy on the Contabo VPS, the environment configuration, and what legacy items were moved.

## Highlights

- **NestJS + Swagger**: Typed, modular API with interactive docs at `/api/docs`
- **JWT auth**: Access/refresh tokens with guards
- **Scan engine**: Helius, Jupiter, Solscan, DexScreener integrations with graceful fallbacks
- **Risk & Tiers**: Tier classifier + risk scoring + AI summary
- **Prisma + PostgreSQL**: Persistent storage for users and scan results
- **Redis**: Pluggable cache layer (also used by image module)
- **Image module**: Optional remote storage via Contabo VPS
- **Deployment**: Works locally and on VPS; Vercel adapter present if needed

---

## Project structure (current)

```
cto-backend/
├─ src/                    # NestJS source
│  ├─ auth/                # Auth module (JWT, guards)
│  ├─ scan/                # Scan controller + services
│  ├─ image/               # Image controller, Redis service, types
│  ├─ prisma/              # Prisma module/service
│  ├─ utils/               # Helpers (formatters, validation)
│  ├─ main.ts              # Nest bootstrap
│  └─ app.module.ts        # Root module
├─ prisma/
│  ├─ schema.prisma        # DB schema (User, ScanResult)
│  └─ migrations/          # Prisma migrations
├─ dist/                   # Compiled JS (build output)
├─ lagacy/                 # Legacy Express code moved here
│  ├─ index.js, routes/, services/, utils/, test/, config/tiers.json
├─ .env                    # Environment variables (local dev / server)
├─ package.json
├─ README.md               # This file
├─ README-NESTJS.md        # NestJS quickstart (kept)
├─ README_BACKEND.md       # Historical notes (kept)
└─ vercel.json             # Vercel route adapter
```

---

## What changed (cleanup and consistency)

- **Consolidated on NestJS**: All active endpoints live under `src/`.
- **Moved legacy Express** to `lagacy/`:
  - `index.js`, `routes/`, `services/`, `utils/` (JS), `test/`, `config/tiers.json`
- **Swagger contract**: Scan endpoints documented for 200 OK responses.
- **External APIs**: Uses Helius (RPC), Jupiter, Solscan with fallbacks and error handling.
- **Redis service**: Centralized in `src/image/redis.service.ts` and can be reused for caching scan results.

Next recommended improvements (optional):
- Add `@HttpCode(HttpStatus.OK)` to `scan` and `scan-batch` routes to enforce 200 responses.
- Cache hot scan results in Redis under `scan:token:<mint>` with 5–15 min TTL.
- Switch Solana pagination calls fully to Helius RPC URL to avoid 429s.

---

## Environment variables

Place these in `.env` (local) and on the VPS. Values marked with “replace” must be updated for your environment.

```bash
# App
PORT=3001
NODE_ENV=development
CORS_ORIGINS=http://localhost:3000,http://localhost:5173

# Backend base URL (frontend uses this)
BACKEND_BASE_URL=http://localhost:3001
KEEP_ALIVE_INTERVAL=180000

# Auth
JWT_SECRET=REPLACE_ME # set a strong secret in production
ADMIN_EMAIL=admin@ctomemes.xyz
# Bcrypt hash for the admin bootstrap user (already hashed)
ADMIN_PASSWORD=$2b$10$6xOMVd/QOJfWkQ.7khD6COvMVnVGY5O.i8ZepMM2uI.PO6BuHgPyK

# Solana / external APIs
HELIUS_API_KEY=REPLACE_WITH_YOUR_KEY
SOLSCAN_API_KEY=REPLACE_OR_LEAVE_EMPTY

# Database (PostgreSQL via Prisma)
# Use VPS values once DB is installed and created
DB_HOST=localhost
DB_PORT=5432
DB_USERNAME=postgres
DB_PASSWORD=postgres
DB_NAME=cto_db
DATABASE_URL=postgresql://${DB_USERNAME}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public

# Redis
# If Redis runs on the VPS, set host to VPS IP; password optional if configured
REDIS_PORT=6379
REDIS_PASSWORD=
REDIS_DB=0

# Contabo VPS (Image storage + optional Redis host)
CONTABO_HOST=84.54.23.80
CONTABO_PORT=22
CONTABO_USERNAME=root         # or cto-admin (see VPS section)
CONTABO_PASSWORD=REPLACE_IN_LOCAL_ONLY
# Or use SSH key auth instead of password
# CONTABO_PRIVATE_KEY_PATH=/path/to/private/key

CONTABO_IMAGE_PATH=/var/www/ctomemes.xyz/images
CONTABO_BASE_URL=http://ctomemes.xyz/images
```

Security note: do not commit real secrets to Git. Keep production `.env` on the server or in a secret manager.

---

## Local development

1. Install dependencies
```bash
npm install
```

2. Copy and edit environment
```bash
# adjust .env as needed
```

3. Generate Prisma client and run migrations
```bash
npm run db:generate
npm run db:migrate
```

4. Start the API
```bash
npm run dev
# Swagger: http://localhost:3001/api/docs
```

5. Authenticate in Swagger
- Click Authorize and paste `Bearer <access_token>` from your login/refresh flow.

---

## Contabo VPS setup (PostgreSQL, Redis, images)

Assuming Ubuntu on the VPS at 84.54.23.80 and you have SSH access.

1) SSH into the VPS
```bash
ssh <your-user>@84.54.23.80
# Use the credentials safely provided to the team
```

2) Install PostgreSQL
```bash
sudo apt update
sudo apt install -y postgresql postgresql-contrib
sudo systemctl enable postgresql
sudo systemctl start postgresql
```

3) Create DB and user
```bash
sudo -u postgres psql <<'SQL'
CREATE DATABASE cto_db;
CREATE USER cto_admin WITH ENCRYPTED PASSWORD 'REPLACE_STRONG_PASS';
GRANT ALL PRIVILEGES ON DATABASE cto_db TO cto_admin;
ALTER DATABASE cto_db OWNER TO cto_admin;
SQL
```

4) Allow remote connections (only if backend is remote)
- Edit `/etc/postgresql/*/main/postgresql.conf`: set `listen_addresses = '*'`
- Edit `/etc/postgresql/*/main/pg_hba.conf`: add a line like
```
host    cto_db   cto_admin   0.0.0.0/0   md5
```
- Reload
```bash
sudo systemctl restart postgresql
```
- Optional firewall
```bash
sudo ufw allow 22/tcp
sudo ufw allow 5432/tcp
sudo ufw allow 6379/tcp
sudo ufw enable
```

5) Set DATABASE_URL on backend
```
DATABASE_URL=postgresql://cto_admin:REPLACE_STRONG_PASS@84.54.23.80:5432/cto_db?schema=public
```
Then run
```bash
npm run db:generate
npm run db:deploy
```

6) Redis (optional, recommended)
- Install Redis on VPS
```bash
sudo apt install -y redis-server
sudo systemctl enable redis-server
sudo systemctl start redis-server
```
- If you enable a Redis password, set it in `/etc/redis/redis.conf` (`requirepass <pass>`)
- In `.env`, set
```
REDIS_PORT=6379
REDIS_PASSWORD=<your_redis_password_if_set>
REDIS_DB=0
# Redis host is taken from CONTABO_HOST in our Redis service
CONTABO_HOST=84.54.23.80
```

7) Image storage (optional)
```bash
sudo mkdir -p /var/www/ctomemes.xyz/images
sudo chown -R <your-user>:<your-user> /var/www/ctomemes.xyz
```
- In `.env`, set `CONTABO_IMAGE_PATH` and `CONTABO_BASE_URL` accordingly.

---

## API usage

- Swagger: `/api/docs`
- Endpoints:
  - POST `/api/scan/scan` – single token scan
  - POST `/api/scan/scan-batch` – batch scan
- Auth: Bearer token via JWT

Typical single scan body:
```json
{
  "contractAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

---

## Troubleshooting

- Helius 401 → set `HELIUS_API_KEY` correctly.
- Public RPC 429 → switch pagination calls to Helius RPC.
- Jupiter/Solscan 404 → token may not be indexed; service will fallback.
- Prisma errors → verify `DATABASE_URL`, run migrations.
- Redis unavailable → features still work, cache skips gracefully.

---

## Legacy code notes

- All legacy Express code resides in `lagacy/` and isn’t used by Nest.
- Do not edit code under `lagacy/` unless you intend to revive Express. Consider removing unneeded dependencies later (`express`, `helmet`, etc.).

---

## Scripts

```bash
npm run dev         # Start Nest in watch mode
npm run build       # Compile to dist/
npm start           # Run compiled build
npm run db:generate # Prisma client
npm run db:migrate  # Dev migrations
npm run db:deploy   # Deploy migrations in prod
```

---

## Maintainers’ checklist

- Keep `.env` updated (server-only for secrets)
- Ensure Prisma migrations are run after DB changes
- Keep Swagger docs aligned with actual status codes (prefer 200 OK in scan routes)
- Prefer Helius for RPC-heavy calls
- Add Redis caching for hot scans if traffic grows