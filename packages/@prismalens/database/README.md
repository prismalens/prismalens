# @prismalens/database

Prisma client and database adapter for the in-development server.
This package is `private: true` and meant for Node server environments.

## Demo Data Seeding

Demo data seed logic lives in `prisma/seeds/demo-data.ts`.
It provisions monitoed services, correlation rules, incidents, alerts, and investigations for empty dev databases.

To extend the demo dataset:
1. Add or modify seed functions in `prisma/seeds/`.
2. Export a function that accepts `SeedPrismaClient` (or `PrismaClient`).
3. Call it from `seedDemoData` in `prisma/seeds/demo-data.ts`.
