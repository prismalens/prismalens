// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// Ported from @prisma/adapter-better-sqlite3@7.10.0 dist/index.mjs (src/better-sqlite3.ts),
// Apache-2.0, Copyright Prisma Data, Inc. Same semantics, on Node's built-in
// `node:sqlite` so installs need no native addon or install script (n1).

import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import {
	DriverAdapterError,
	type IsolationLevel,
	type SqlDriverAdapter,
	type SqlMigrationAwareDriverAdapterFactory,
	type SqlQuery,
	type SqlQueryable,
	type SqlResultSet,
	type Transaction,
	type TransactionOptions,
} from "@prisma/driver-adapter-utils";
import { Mutex } from "async-mutex";
import {
	getColumnTypes,
	mapArg,
	mapRow,
	type TimestampFormat,
} from "./conversion.js";
import { convertDriverError } from "./errors.js";

export { isBusyError, isSqliteError } from "./errors.js";

const ADAPTER_NAME = "@prismalens/adapter-node-sqlite";

export interface NodeSqliteConfig {
	/** `file:<path>`, a bare path, or `:memory:`. */
	url: string;
	/** Busy timeout in milliseconds. */
	timeout?: number;
	readOnly?: boolean;
}

export interface NodeSqliteOptions {
	timestampFormat?: TimestampFormat;
	shadowDatabaseUrl?: string;
}

class NodeSqliteQueryable implements SqlQueryable {
	readonly provider = "sqlite";
	readonly adapterName = ADAPTER_NAME;

	constructor(
		protected readonly db: DatabaseSync,
		protected readonly adapterOptions: NodeSqliteOptions = {},
	) {}

	async queryRaw(query: SqlQuery): Promise<SqlResultSet> {
		const { columnNames, declaredTypes, rows } = this.run(
			query,
			(stmt, args) => {
				const columns = stmt.columns();
				if (columns.length === 0) {
					stmt.run(...args);
					return { columnNames: [], declaredTypes: [], rows: [] };
				}
				stmt.setReturnArrays(true);
				return {
					columnNames: columns.map((c) => c.name),
					declaredTypes: columns.map((c) => c.type),
					rows: stmt.all(...args) as unknown as unknown[][],
				};
			},
		);
		const columnTypes = getColumnTypes(declaredTypes, rows);
		return {
			columnNames,
			columnTypes,
			rows: rows.map((row) => mapRow(row, columnTypes)),
		};
	}

	async executeRaw(query: SqlQuery): Promise<number> {
		return Number(this.run(query, (stmt, args) => stmt.run(...args)).changes);
	}

	protected run<T>(
		query: SqlQuery,
		fn: (stmt: ReturnType<DatabaseSync["prepare"]>, args: SQLInputValue[]) => T,
	): T {
		try {
			const args = query.args.map(
				(arg, i) =>
					mapArg(
						arg,
						query.argTypes[i],
						this.adapterOptions.timestampFormat,
					) as SQLInputValue,
			);
			const stmt = this.db.prepare(query.sql);
			// Per statement: the `readBigInts` open option is ignored before Node 24.x.
			stmt.setReadBigInts(true);
			return fn(stmt, args);
		} catch (error) {
			throw new DriverAdapterError(convertDriverError(error));
		}
	}

	protected exec(sql: string): void {
		try {
			this.db.exec(sql);
		} catch (error) {
			throw new DriverAdapterError(convertDriverError(error));
		}
	}
}

class NodeSqliteTransaction extends NodeSqliteQueryable implements Transaction {
	readonly options: TransactionOptions = { usePhantomQuery: false };

	constructor(
		db: DatabaseSync,
		adapterOptions: NodeSqliteOptions,
		private readonly unlockParent: () => void,
	) {
		super(db, adapterOptions);
	}

	// Prisma sends COMMIT / ROLLBACK as queries (usePhantomQuery: false);
	// these only hand the connection back.
	async commit(): Promise<void> {
		this.unlockParent();
	}

	async rollback(): Promise<void> {
		this.unlockParent();
	}

	async createSavepoint(name: string): Promise<void> {
		this.exec(`SAVEPOINT ${name}`);
	}

	async rollbackToSavepoint(name: string): Promise<void> {
		this.exec(`ROLLBACK TO ${name}`);
	}

	async releaseSavepoint(name: string): Promise<void> {
		this.exec(`RELEASE SAVEPOINT ${name}`);
	}
}

export class PrismaNodeSqliteAdapter
	extends NodeSqliteQueryable
	implements SqlDriverAdapter
{
	readonly #mutex = new Mutex();

	async executeScript(script: string): Promise<void> {
		this.exec(script);
	}

	async startTransaction(
		isolationLevel?: IsolationLevel,
	): Promise<Transaction> {
		if (isolationLevel && isolationLevel !== "SERIALIZABLE") {
			throw new DriverAdapterError({
				kind: "InvalidIsolationLevel",
				level: isolationLevel,
			});
		}
		const release = await this.#mutex.acquire();
		try {
			this.exec("BEGIN");
		} catch (error) {
			release();
			throw error;
		}
		return new NodeSqliteTransaction(this.db, this.adapterOptions, release);
	}

	async dispose(): Promise<void> {
		this.db.close();
	}
}

export function openNodeSqlite(config: NodeSqliteConfig): DatabaseSync {
	return new DatabaseSync(config.url.replace(/^file:/, ""), {
		readOnly: config.readOnly ?? false,
		timeout: config.timeout,
	});
}

export class PrismaNodeSqlite implements SqlMigrationAwareDriverAdapterFactory {
	readonly provider = "sqlite";
	readonly adapterName = ADAPTER_NAME;

	constructor(
		private readonly config: NodeSqliteConfig,
		private readonly options: NodeSqliteOptions = {},
	) {}

	async connect(): Promise<SqlDriverAdapter> {
		return new PrismaNodeSqliteAdapter(
			openNodeSqlite(this.config),
			this.options,
		);
	}

	async connectToShadowDb(): Promise<SqlDriverAdapter> {
		const url = this.options.shadowDatabaseUrl ?? ":memory:";
		return new PrismaNodeSqliteAdapter(
			openNodeSqlite({ ...this.config, url }),
			this.options,
		);
	}
}
