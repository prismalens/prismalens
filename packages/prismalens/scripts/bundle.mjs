#!/usr/bin/env node

/**
 * PrismaLens Bundle Script
 *
 * Creates a distributable package by bundling:
 * - API (NestJS compiled output + production deps)
 * - Frontend (Next.js static export)
 * - Worker (Python source + pyproject.toml)
 * - Prisma schema
 */

import { execSync } from 'child_process';
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { resolve, dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const BUNDLED = resolve(ROOT, 'bundled');
const PACKAGES = resolve(ROOT, '..');

// Colors for output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  dim: '\x1b[2m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function step(num, message) {
  log(`\n${num}. ${message}`, 'blue');
}

/**
 * Copy directory with filtering
 */
function copyFiltered(src, dest, options = {}) {
  const { exclude = [] } = options;

  if (!existsSync(src)) {
    throw new Error(`Source not found: ${src}`);
  }

  mkdirSync(dest, { recursive: true });

  const items = readdirSync(src);
  for (const item of items) {
    // Skip excluded items
    if (exclude.some((pattern) => item.includes(pattern))) {
      continue;
    }

    const srcPath = join(src, item);
    const destPath = join(dest, item);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      copyFiltered(srcPath, destPath, options);
    } else {
      cpSync(srcPath, destPath);
    }
  }
}

async function main() {
  log('\n========================================', 'green');
  log('  Building PrismaLens Distributable', 'green');
  log('========================================\n', 'green');

  // Clean previous bundle
  log('Cleaning previous bundle...', 'dim');
  rmSync(BUNDLED, { recursive: true, force: true });
  mkdirSync(BUNDLED, { recursive: true });

  // Step 1: Build & bundle API
  step(1, 'Building API...');
  const apiSrc = resolve(PACKAGES, 'api');
  const apiDest = resolve(BUNDLED, 'api');

  if (!existsSync(apiSrc)) {
    throw new Error(`API package not found at ${apiSrc}`);
  }

  // Build API
  execSync('pnpm build', { cwd: apiSrc, stdio: 'inherit' });

  // Copy compiled output
  mkdirSync(apiDest, { recursive: true });
  cpSync(resolve(apiSrc, 'dist'), resolve(apiDest, 'dist'), { recursive: true });
  cpSync(resolve(apiSrc, 'package.json'), resolve(apiDest, 'package.json'));

  // Install production dependencies
  log('Installing API production dependencies...', 'dim');
  execSync('pnpm install --prod --ignore-scripts --force', {
    cwd: apiDest,
    stdio: 'inherit',
    env: { ...process.env, CI: 'true' },
  });

  log('API bundled successfully', 'green');

  // Step 2: Build & bundle Frontend
  step(2, 'Building Frontend...');
  const frontendSrc = resolve(PACKAGES, 'frontend');
  const frontendDest = resolve(BUNDLED, 'frontend');

  if (!existsSync(frontendSrc)) {
    throw new Error(`Frontend package not found at ${frontendSrc}`);
  }

  // Build frontend (static export)
  execSync('pnpm build', {
    cwd: frontendSrc,
    stdio: 'inherit',
    env: { ...process.env, NEXT_OUTPUT_MODE: 'export' },
  });

  // Copy static output
  mkdirSync(frontendDest, { recursive: true });
  const outDir = resolve(frontendSrc, 'out');
  if (existsSync(outDir)) {
    cpSync(outDir, resolve(frontendDest, 'out'), { recursive: true });
  } else {
    // Fallback to .next/static if not using static export
    const nextStatic = resolve(frontendSrc, '.next');
    if (existsSync(nextStatic)) {
      cpSync(nextStatic, resolve(frontendDest, '.next'), { recursive: true });
    }
  }

  log('Frontend bundled successfully', 'green');

  // Step 3: Bundle Python worker
  step(3, 'Bundling Python worker...');
  const workerSrc = resolve(PACKAGES, '@prismalens', 'worker-python');
  const workerDest = resolve(BUNDLED, 'worker');

  if (!existsSync(workerSrc)) {
    throw new Error(`Worker package not found at ${workerSrc}`);
  }

  // Copy worker source (excluding venv, cache, etc.)
  copyFiltered(workerSrc, workerDest, {
    exclude: ['.venv', '__pycache__', '.pytest_cache', '.mypy_cache', '*.pyc', '.git'],
  });

  log('Worker bundled successfully', 'green');

  // Step 4: Copy Prisma schema from database package
  step(4, 'Copying Prisma schema...');
  const databaseSrc = resolve(PACKAGES, '@prismalens', 'database');
  const prismaSchema = resolve(databaseSrc, 'prisma');
  const prismaDest = resolve(ROOT, 'prisma');

  if (existsSync(prismaSchema)) {
    rmSync(prismaDest, { recursive: true, force: true });
    cpSync(prismaSchema, prismaDest, { recursive: true });
    log('Prisma schema copied', 'green');
  } else {
    log(`Warning: Prisma schema not found at ${prismaSchema}`, 'yellow');
  }

  // Also copy Prisma to bundled API for runtime access
  const apiBundledPrisma = resolve(apiDest, 'prisma');
  if (existsSync(prismaSchema)) {
    cpSync(prismaSchema, apiBundledPrisma, { recursive: true });
    log('Prisma schema copied to bundled API', 'green');
  }

  // Summary
  log('\n========================================', 'green');
  log('  Bundle Complete!', 'green');
  log('========================================\n', 'green');

  // Show bundle sizes
  const getDirSize = (dir) => {
    if (!existsSync(dir)) return 0;
    let size = 0;
    const items = readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const path = join(dir, item.name);
      if (item.isDirectory()) {
        size += getDirSize(path);
      } else {
        size += statSync(path).size;
      }
    }
    return size;
  };

  const formatSize = (bytes) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  log('Bundle sizes:', 'dim');
  log(`  API:      ${formatSize(getDirSize(apiDest))}`, 'dim');
  log(`  Frontend: ${formatSize(getDirSize(frontendDest))}`, 'dim');
  log(`  Worker:   ${formatSize(getDirSize(workerDest))}`, 'dim');
  log(`  Total:    ${formatSize(getDirSize(BUNDLED))}`, 'dim');
  log('');
}

main().catch((error) => {
  console.error('\nBundle failed:', error.message);
  process.exit(1);
});
