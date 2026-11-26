# HearCare Tanzania — Backend API

Standalone Node.js + TypeScript + Express + MongoDB REST API for the HearCare mobile app and admin website.

## Features
- Patient phone OTP authentication (JWT access + rotating refresh tokens)
- Region, Service, Clinic and verified Audiologist catalog with EAT (`UTC+3`) slot generation
- Atomic anti-double-booking (`unique` partial index) with `Idempotency-Key` support, 4-hour cancel policy, and reschedule
- Automatic 24h and 2h appointment reminder cron job (SMS + Expo Push + in-app notifications)
- Bilingual (`en` / `sw`) Hearing Education articles with structured blocks and GridFS image media (`/media/:id`)
- Admin API (`/api/v1/admin/*`) with Word (`.docx`), Markdown (`.md`), `.txt` and `.pdf` document import

## Local development

### Quick start (no MongoDB install needed)
```bash
npm install
npm run dev:memory
```
This starts on `http://localhost:4000` with an in-memory MongoDB seeded with regions, services, topics, sample clinics/audiologists, bilingual articles, and the default admin (`admin@hearcare.local` / `ChangeMe123!`).

### With MongoDB Atlas / local MongoDB
1. Copy `.env.example` to `.env` and set `MONGODB_URI`, `JWT_SECRET`, `PUBLIC_URL`, and `ADMIN_PASSWORD`.
2. Seed base catalog (`npm run seed:base`) or demo data (`npm run seed:demo`).
3. Start dev server: `npm run dev` (or build & run: `npm run build && npm start`).

## Tests
```bash
npm run typecheck
npm run build
npm test
```

## Deploy (Render / Railway / Fly.io)
- Build command: `npm ci && npm run build`
- Start command: `node dist/server.js`
- Health check path: `/health`
- Set `MONGODB_URI` (MongoDB Atlas in `af-south-1` Cape Town recommended), `JWT_SECRET`, `PUBLIC_URL` (your HTTPS server URL, used for media URLs), `CORS_ORIGINS` (your admin URL), `ADMIN_EMAIL`, `ADMIN_PASSWORD`, and SMS credentials (`SMS_PROVIDER=africastalking` or `beem`).
