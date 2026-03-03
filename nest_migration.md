# Implementation Plan - Backend Migration to NestJS

## Goal
Replace the current Express.js monolithic backend with a modular, scalable **NestJS** application. This will ensure "continuous stability," improved error handling, and a professional architecture.

## User Review Required
> [!IMPORTANT]
> This is a **Rewrite**, not just a refactor. We will create a new folder `backend-nest` so your current site keeps working during development. Once finished, we will switch the frontend to point to the new port (e.g., 3001 or 3000).

## Technology Stack
- **Framework**: NestJS (Modular, TypeScript)
- **Database ORM**: TypeORM (Native NestJS support, better than Sequelize)
- **Database**: PostgreSQL (Existing)
- **Real-time**: Socket.IO (NestJS Gateway)
- **Validation**: class-validator (Strict DTOs)

## Proposed Changes

### 1. Project Initialization
- [NEW] Create `backend-nest` using Nest CLI.
- [NEW] Configure `ConfigModule` for `.env`.

### 2. Database Layer (TypeORM)
- [NEW] `DatabaseModule` connecting to your existing Postgres.
- [NEW] Define Entities matching your current schema:
    - `UserEntity`
    - `AccountEntity`
    - `TradeEntity`
    - `PositionEntity`

### 3. Modules Migration
#### [Auth Module]
- Move JWT logic from `middleware/appAuthMiddleware.js`.
- Implement `AuthGuard` for protecting routes.

#### [MT5 Module] (The Core)
- Create `Mt5Controller` to handle user data push.
- Implement `Mt5Service` to handle "Upsert" logic properly (fixing the race conditions permanently).
- **Optimization**: Use a Queue (Bull) if possible, or robust async locks.

#### [Dashboard Module]
- Create `DashboardController` for frontend data (`/api/performance`, etc.).
- Migrate `StatsService.js` logic into `DashboardService`.

## Verification Plan
### Automated Tests
- Run NestJS e2e tests for the new endpoints.
### Manual Verification
- Point the MQL5 script to the new URL (e.g., `http://localhost:3001/api/mt5`).
- Verify data flows into the same DB.
- Point React frontend to new API.
