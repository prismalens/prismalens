import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../../../prisma/generated/client.js';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';
import { getConfig, ensureAppDataDir } from '@prismalens/config';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const config = getConfig();

    // Build appropriate adapter based on database type
    let adapter: PrismaBetterSqlite3 | PrismaPg;

    if (config.PRISMALENS_DB_TYPE === 'sqlite') {
      // Create application data directory if it doesn't exist
      // This stores the SQLite database file and other application data
      ensureAppDataDir();

      adapter = new PrismaBetterSqlite3({
        url: config.PRISMALENS_DB_URL,
        readonly: config.PRISMALENS_DB_SQLITE_READONLY,
        fileMustExist: config.PRISMALENS_DB_SQLITE_FILE_MUST_EXIST,
        timeout: config.PRISMALENS_DB_SQLITE_TIMEOUT,
      });
    } else if (config.PRISMALENS_DB_TYPE === 'postgresql') {
      // Configure PostgreSQL connection pool with SSL support
      const pool = new Pool({
        host: config.PRISMALENS_DB_POSTGRES_HOST,
        port: config.PRISMALENS_DB_POSTGRES_PORT,
        database: config.PRISMALENS_DB_POSTGRES_DATABASE,
        user: config.PRISMALENS_DB_POSTGRES_USER,
        password: config.PRISMALENS_DB_POSTGRES_PASSWORD,
        max: config.PRISMALENS_DB_POSTGRES_POOL_SIZE,
        ...(config.PRISMALENS_DB_POSTGRES_SSL_ENABLED && {
          ssl: {
            ca: config.PRISMALENS_DB_POSTGRES_SSL_CA,
            cert: config.PRISMALENS_DB_POSTGRES_SSL_CERT,
            key: config.PRISMALENS_DB_POSTGRES_SSL_KEY,
            rejectUnauthorized:
              config.PRISMALENS_DB_POSTGRES_SSL_REJECT_UNAUTHORIZED,
          },
        }),
      });

      adapter = new PrismaPg(pool);
    } else {
      throw new Error(
        `Unsupported database type: ${config.PRISMALENS_DB_TYPE}`,
      );
    }

    super({
      ...(adapter && { adapter }),
      log:
        process.env.NODE_ENV === 'development'
          ? ['query', 'info', 'warn', 'error']
          : ['error'],
    });

    this.logger.log(
      `Prisma initialized with ${config.PRISMALENS_DB_TYPE} database`,
    );
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.$connect();
      this.logger.log('Database connection established');
    } catch (error) {
      this.logger.error('Database connection failed!');
      this.logger.error('Run "pnpm db:init" to initialize the database');
      throw error;
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
    this.logger.log('Database connection closed');
  }
}
