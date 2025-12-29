#!/usr/bin/env npx tsx
/**
 * Smart database initialization script.
 * Detects database state and runs appropriate Prisma commands.
 * Supports separate migration folders for SQLite and PostgreSQL.
 */
import { existsSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import 'dotenv/config';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT_PATH = resolve(__dirname, '..');  // Monorepo root
const API_PATH = resolve(ROOT_PATH, 'packages/api');

type DbType = 'sqlite' | 'postgresql';

function getDbType(): DbType {
  return (process.env.PRISMALENS_DB_TYPE || 'sqlite') as DbType;
}

function getMigrationsPath(dbType: DbType): string {
  const folder = dbType === 'postgresql' ? 'migrations-pg' : 'migrations-sqlite';
  return resolve(API_PATH, `prisma/${folder}`);
}

function migrationsExist(dbType: DbType): boolean {
  const migrationsPath = getMigrationsPath(dbType);
  if (!existsSync(migrationsPath)) return false;
  try {
    const entries = readdirSync(migrationsPath, { withFileTypes: true });
    // Check for actual migration folders (not just migration_lock.toml)
    return entries.some(e => e.isDirectory() && !e.name.startsWith('.'));
  } catch {
    return false;
  }
}

function sqliteDbExists(): boolean {
  const dbPath = process.env.PRISMALENS_DB_SQLITE_DATABASE || '.prismalens/prismalens.db';
  // Check relative to monorepo root
  return existsSync(resolve(ROOT_PATH, dbPath));
}

async function main() {
  console.log('🔍 Checking database state...');

  const dbType = getDbType();
  const migrationsFolder = dbType === 'postgresql' ? 'migrations-pg' : 'migrations-sqlite';
  const hasMigrations = migrationsExist(dbType);
  const dbExists = dbType === 'sqlite' ? sqliteDbExists() : true; // PostgreSQL connectivity deferred to Prisma

  console.log(`   Database type: ${dbType}`);
  console.log(`   Migrations path: prisma/${migrationsFolder}`);
  console.log(`   Migrations exist: ${hasMigrations}`);
  if (dbType === 'sqlite') {
    console.log(`   Database exists: ${dbExists}`);
  }

  if (!hasMigrations) {
    // Fresh install - create initial migration
    console.log('📦 Creating initial migration...');
    execSync('pnpm exec prisma migrate dev --name init', {
      cwd: API_PATH,
      stdio: 'inherit',
      env: { ...process.env },
    });
  } else if (!dbExists) {
    // Migrations exist but DB is missing - apply them
    console.log('🔄 Applying migrations to new database...');
    execSync('pnpm exec prisma migrate dev', {
      cwd: API_PATH,
      stdio: 'inherit',
      env: { ...process.env },
    });
  } else {
    // Check for pending migrations using migrate status
    console.log('✅ Database ready (checking for pending migrations...)');
    try {
      const result = execSync('pnpm exec prisma migrate status', {
        cwd: API_PATH,
        stdio: 'pipe',
        env: { ...process.env },
      });
      const output = result.toString();

      // If output mentions pending migrations, apply them
      if (output.includes('Following migration') || output.includes('have not yet been applied')) {
        console.log('🔄 Applying pending migrations...');
        execSync('pnpm exec prisma migrate dev', {
          cwd: API_PATH,
          stdio: 'inherit',
          env: { ...process.env },
        });
      } else {
        console.log('✅ All migrations are up to date');
      }
    } catch (error) {
      // migrate status returns non-zero if there are pending migrations or issues
      console.log('🔄 Applying pending migrations...');
      execSync('pnpm exec prisma migrate dev', {
        cwd: API_PATH,
        stdio: 'inherit',
        env: { ...process.env },
      });
    }
  }

  console.log('✅ Database initialization complete');
}

main().catch((err) => {
  console.error('❌ Database initialization failed:', err.message);
  process.exit(1);
});
