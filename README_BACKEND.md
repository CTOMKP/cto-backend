# CTO Marketplace Backend (NestJS + Prisma + PostgreSQL)

## Overview
Production-ready NestJS backend for the CTO Marketplace. It exposes REST APIs with Swagger docs, integrates with PostgreSQL via Prisma, and provides modular architecture for Auth and Token Scanning (Solana). The design is future-ready for embeddings (pgvector), Pinecone, and AI features.

## Project Structure
```
src/
  app.module.ts
  main.ts
  auth/
    auth.controller.ts
    auth.module.ts
    auth.service.ts
    dto/
      login.dto.ts
      register.dto.ts
      auth-response.dto.ts
      register-response.dto.ts
    guards/
      jwt-auth.guard.ts
      local-auth.guard.ts
    strategies/
      jwt.strategy.ts
      local.strategy.ts
  scan/
    scan.controller.ts
    scan.module.ts
    dto/
      scan-request.dto.ts
      scan-response.dto.ts
    services/
      scan.service.ts
      solana-api.service.ts
      tier-classifier.service.ts
      risk-scoring.service.ts
      ai-summary.service.ts
  prisma/
    prisma.module.ts
    prisma.service.ts
  common/
    decorators/
      user.decorator.ts
  utils/
    validation.ts
    age-formatter.ts
    tiers.json
prisma/
  schema.prisma
```

## Prerequisites
- Node.js 18+
- PostgreSQL 14+ (database: `cto_db`)
- pnpm or npm

## Environment
Create `.env` (see `.env` already added):
```
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/cto_db?schema=public
JWT_SECRET=change_this_in_production
PORT=3001
NODE_ENV=development
HELIUS_API_KEY=
```

## Install & Run (Dev)
1. Install dependencies
   - npm install
2. Generate Prisma client
   - npm run db:generate
3. Run migrations (creates tables)
   - npm run db:migrate
4. Start dev server
   - npm run dev
5. Swagger docs
   - http://localhost:3001/api/docs

## Migrations & DB
- Create/modify models in `prisma/schema.prisma`.
- Generate client: `npm run db:generate`
- Dev migrate: `npm run db:migrate`
- Deploy migrate (CI/CD): `npm run db:deploy`
- Inspect data: `npm run db:studio`

## Auth Module
- Endpoints:
  - POST `/api/auth/register` — Register with email/password.
  - POST `/api/auth/login` — Login, returns access and refresh tokens.
  - GET `/api/auth/profile` — Get current user (Bearer).
  - POST `/api/auth/refresh` — Refresh access token.
  - POST `/api/auth/logout` — Dummy logout.
- Implementation:
  - Passwords hashed with bcrypt.
  - JWT strategies/guards for session handling.
  - DTOs and Swagger decorators included.

## Scan Module
- Endpoints:
  - POST `/api/scan/scan` — Auth required; scans a Solana token and persists `ScanResult` with `userId` if provided.
  - POST `/api/scan/scan-batch` — Public batch scan; no persistence.
- Logic:
  - Refactored from guide JS services into Nest services.
  - Returns tier/classification, risk score/level, and comprehensive metadata.

## Adding New Modules
1. Create a folder in `src/<module>` with `module`, `service`, `controller`.
2. Provide DTOs and Swagger decorators.
3. Register the module in `app.module.ts`.
4. For DB access, inject `PrismaService` from `src/prisma`.

## Future: Embeddings/AI
- Add `vector` columns using pgvector or external Pinecone indexer.
- Create a `vector` table/model and service; encapsulate third-party SDKs under `src/common` adapters.

## Security & Best Practices
- Use environment variables for secrets.
- Validate input with class-validator (global ValidationPipe enabled).
- JWT Bearer Auth on protected routes.
- CORS configured in `main.ts`.

## Notes
- Only code in `src/` is production code; JS files at project root are references.
- Keep services pure and controllers thin.