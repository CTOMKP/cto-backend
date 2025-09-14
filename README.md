# CTO Marketplace Backend (NestJS + Prisma + PostgreSQL)

A production-ready Solana token vetting API focused on accuracy, speed, and scalability. Built with NestJS, documented with Swagger, persists with Prisma/PostgreSQL, and supports Redis caching and optional image storage on a VPS.

---

## Highlights

- **NestJS + Swagger**: Modular, typed API with interactive docs at `/api/docs`
- **Speed-focused scanning**: Clear validation, graceful fallbacks, and structured errors
- **JWT auth**: Access/refresh tokens with guards and DTO validation
- **Risk & Tiers**: Tier classifier + risk scoring + AI summary
- **Prisma + PostgreSQL**: Strong schema with migrations
- **Redis-ready**: Caching hook points in scan services
- **VPS integration**: Optional SFTP image handling via Contabo

---

## Clean project structure

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
├─ dist/                   # Build output
├─ .env                    # Local/server env (ignored in Git)
├─ .env.example            # Safe template for required variables
├─ package.json
├─ tsconfig.json
└─ README.md               # This file
```

Removed legacy/duplicates to keep the repo professional and minimal:
- Removed `lagacy/` (old Express implementation)
- Removed duplicate `src/utils/ageFormatter.ts` (kept `age-formatter.ts`)
- Removed empty `config/` and stray `.txt`

---

## Environment variables

Copy `.env.example` to `.env` and fill in values.

Security: `.env` is Git-ignored. Set production values on the server or your hosting provider (Vercel/Railway/VPS) and never commit secrets to Git.

---

## Local development

1) Install dependencies
```bash
npm install
```

2) Prepare environment
```bash
# copy and edit .env
type .env.example > .env  # Windows PowerShell shortcut or copy manually
```

3) Prisma client and migrations
```bash
npm run db:generate
npm run db:migrate
```

4) Start API
```bash
npm run dev
# Swagger: http://localhost:3001/api/docs
```

5) Auth in Swagger
- Click Authorize and paste `Bearer <access_token>` from login.

---

## Deployment (VPS/Containers/Platforms)

- Ensure environment variables are set in the platform:
  - DATABASE_URL, JWT_SECRET, CORS_ORIGINS, HELIUS_API_KEY, REDIS_*, CONTABO_*
- Build and run:
```bash
npm run build
npm start
```
- Prisma in production:
```bash
npm run db:generate
npm run db:deploy
```

### VPS notes (PostgreSQL/Redis/Image storage)
- PostgreSQL: create `cto_db` and user; set `DATABASE_URL`
- Redis (optional): enable and set password if desired; configure `REDIS_*`
- Image storage (optional): ensure `CONTABO_IMAGE_PATH` and `CONTABO_BASE_URL`

---

## API usage

- Swagger: `/api/docs`
- Endpoints:
  - POST `/api/auth/register` — register user
  - POST `/api/auth/login` — login and receive tokens
  - GET `/api/auth/profile` — current user (Bearer)
  - POST `/api/auth/refresh` — refresh access token
  - POST `/api/scan/scan` — scan a single token (200 OK)
  - POST `/api/scan/scan-batch` — scan multiple tokens

Example single scan body:
```json
{
  "contractAddress": "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM"
}
```

---

## Design choices for performance & reliability

- Strict input validation and early exits (bad addresses/too-young tokens)
- Clear error mapping with consistent HTTP codes
- External API fallbacks and timeouts recommended
- Redis integration points for hot-result caching (TTL 5–15m)
- DB writes minimized (single scans persist only when authenticated)

---

## Development checklist

- Keep `.env` off Git; use `.env.example` for onboarding
- Run Prisma migrations after schema changes
- Keep Swagger docs aligned with controller status codes
- Prefer Helius for RPC-heavy calls to avoid rate limits
- Add tests for new modules/services/DTOs

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

## Contributing standards

- TypeScript only; DTOs for all inputs
- Controllers thin; logic in services
- Explicit status codes; add Swagger decorators
- Add/adjust tests when modifying behavior

---

## Contact / Maintenance

- Keep environment variables synchronized between environments via platform settings
- Review logs and metrics regularly; consider adding APM/monitoring
- Use semantic commits and PR reviews for changes