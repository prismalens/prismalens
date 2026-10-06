// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
	type ArgType,
	ColumnTypeEnum,
	DriverAdapterError,
	type SqlDriverAdapter,
	type SqlQuery,
} from "@prisma/driver-adapter-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getColumnTypes, mapArg, mapRow, UnexpectedTypeError } from "./conversion.js";
import { convertDriverError, isBusyError } from "./errors.js";
import { PrismaNodeSqlite } from "./index.js";

const t = (scalarType: ArgType["scalarType"]): ArgType => ({
	scalarType,
	arity: "scalar",
});
const q = (sql: string, args: unknown[] = [], types?: ArgType[]): SqlQuery => ({
	sql,
	args,
	argTypes: types ?? args.map(() => t("unknown")),
});

/** The DriverAdapterError a call rejected with, so tests can read its cause. */
async function rejection(p: Promise<unknown>) {
	const error = await p.then(
		() => undefined,
		(e: unknown) => e,
	);
	expect(error).toBeInstanceOf(DriverAdapterError);
	return (error as DriverAdapterError).cause;
}

let dir: string;
let file: string;
let adapter: SqlDriverAdapter;

beforeEach(async () => {
	dir = mkdtempSync(join(tmpdir(), "pl-node-sqlite-"));
	file = join(dir, "test.db");
	adapter = await new PrismaNodeSqlite({ url: `file:${file}` }).connect();
	await adapter.executeScript(`
		CREATE TABLE t (
			id INTEGER PRIMARY KEY,
			i INTEGER, b BIGINT, r REAL, s TEXT NOT NULL DEFAULT '', bl BLOB,
			bo BOOLEAN, d DATETIME, dec DECIMAL, j JSONB, untyped,
			email TEXT UNIQUE
		);
		CREATE TABLE child (id INTEGER PRIMARY KEY, t_id INTEGER NOT NULL REFERENCES t(id));
	`);
});

afterEach(async () => {
	await adapter.dispose();
	rmSync(dir, { recursive: true, force: true });
});

describe("types round-trip through queryRaw", () => {
	it("maps int, bigint, real, text, blob, null, boolean and datetime", async () => {
		const when = new Date("2026-10-06T12:34:56.789Z");
		const changed = await adapter.executeRaw(
			q(
				"INSERT INTO t (i, b, r, s, bl, bo, d, untyped) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
				["42", "9007199254740993", 1.5, "hi", "aGk=", true, when.toISOString(), null],
				[t("int"), t("bigint"), t("float"), t("string"), t("bytes"), t("boolean"), t("datetime"), t("unknown")],
			),
		);
		expect(changed).toBe(1);

		const result = await adapter.queryRaw(
			q("SELECT i, b, r, s, bl, bo, d, untyped FROM t"),
		);
		expect(result.columnNames).toEqual(["i", "b", "r", "s", "bl", "bo", "d", "untyped"]);
		expect(result.columnTypes).toEqual([
			ColumnTypeEnum.Int32,
			ColumnTypeEnum.Int64,
			ColumnTypeEnum.Double,
			ColumnTypeEnum.Text,
			ColumnTypeEnum.Bytes,
			ColumnTypeEnum.Boolean,
			ColumnTypeEnum.DateTime,
			ColumnTypeEnum.Int32, // all-null untyped column falls back to Int32
		]);
		const [row] = result.rows;
		expect(row[0]).toBe(42);
		expect(row[1]).toBe("9007199254740993"); // unsafe integer stays exact as text
		expect(row[2]).toBe(1.5);
		expect(row[3]).toBe("hi");
		expect(Buffer.from(row[4] as Uint8Array).toString()).toBe("hi");
		expect(row[5]).toBe(1);
		expect(row[6]).toBe("2026-10-06T12:34:56.789+00:00"); // iso8601, as better-sqlite3 wrote it
		expect(row[7]).toBeNull();
	});

	it("types an expression column from its values", async () => {
		const result = await adapter.queryRaw(
			q("SELECT 1 + 1 AS n, 'x' AS s, x'00' AS bl, 2.5 AS f"),
		);
		expect(result.columnTypes).toEqual([
			ColumnTypeEnum.Int64,
			ColumnTypeEnum.Text,
			ColumnTypeEnum.Bytes,
			ColumnTypeEnum.UnknownNumber,
		]);
		expect(result.rows[0].slice(0, 2)).toEqual([2, "x"]);
	});

	it("returns RETURNING rows and an empty set for plain writes", async () => {
		const returning = await adapter.queryRaw(
			q("INSERT INTO t (i) VALUES (?) RETURNING id, i", [7], [t("int")]),
		);
		expect(returning.rows).toEqual([[1, 7]]);
		const write = await adapter.queryRaw(q("UPDATE t SET i = 8"));
		expect(write).toEqual({ columnNames: [], columnTypes: [], rows: [] });
	});
});

describe("conversion edge cases", () => {
	it("maps the remaining argument forms", () => {
		expect(mapArg("1.25", t("decimal"))).toBe(1.25);
		expect(mapArg(false, t("boolean"))).toBe(0);
		expect(mapArg(null, t("int"))).toBeNull();
		const d = new Date(5);
		expect(mapArg(d, t("datetime"), "unixepoch-ms")).toBe(5);
		expect(mapArg("plain", t("string"))).toBe("plain");
	});

	it("maps declared types and fixes up row values", () => {
		const types = getColumnTypes(
			["DECIMAL", "FLOAT", "TIME", "DATE", "JSONB", "VARCHAR", "INT8", "nonsense", ""],
			[[null, null, null, null, null, null, null, true, null]],
		);
		expect(types).toEqual([
			ColumnTypeEnum.Numeric,
			ColumnTypeEnum.Float,
			ColumnTypeEnum.Time,
			ColumnTypeEnum.Date,
			ColumnTypeEnum.Json,
			ColumnTypeEnum.Text,
			ColumnTypeEnum.Int64,
			ColumnTypeEnum.Boolean,
			ColumnTypeEnum.Int32,
		]);
		expect(
			mapRow([2.7, 5n, 0], [ColumnTypeEnum.Int32, ColumnTypeEnum.DateTime, ColumnTypeEnum.DateTime]),
		).toEqual([2, "1970-01-01T00:00:00.005Z", "1970-01-01T00:00:00.000Z"]);
		expect(() => getColumnTypes([null], [[{}]])).toThrow(UnexpectedTypeError);
		expect(() => getColumnTypes([null], [[Symbol("x")]])).toThrow(UnexpectedTypeError);
	});
});

describe("transactions", () => {
	it("commits, and rolls back what a rolled-back transaction wrote", async () => {
		const tx = await adapter.startTransaction();
		await tx.executeRaw(q("INSERT INTO t (i) VALUES (1)"));
		await tx.executeRaw(q("COMMIT"));
		await tx.commit();

		const rolled = await adapter.startTransaction();
		await rolled.executeRaw(q("INSERT INTO t (i) VALUES (2)"));
		await rolled.executeRaw(q("ROLLBACK"));
		await rolled.rollback();

		const rows = await adapter.queryRaw(q("SELECT i FROM t ORDER BY i"));
		expect(rows.rows).toEqual([[1]]);
	});

	it("rolls back to a savepoint and keeps what came before it", async () => {
		const tx = await adapter.startTransaction();
		await tx.executeRaw(q("INSERT INTO t (i) VALUES (1)"));
		await tx.createSavepoint?.("sp1");
		await tx.executeRaw(q("INSERT INTO t (i) VALUES (2)"));
		await tx.rollbackToSavepoint?.("sp1");
		await tx.releaseSavepoint?.("sp1");
		await tx.executeRaw(q("COMMIT"));
		await tx.commit();
		expect((await adapter.queryRaw(q("SELECT i FROM t"))).rows).toEqual([[1]]);
	});

	it("serialises a second transaction behind the first", async () => {
		const first = await adapter.startTransaction();
		let secondStarted = false;
		const second = adapter.startTransaction().then((tx) => {
			secondStarted = true;
			return tx;
		});
		await new Promise((r) => setTimeout(r, 20));
		expect(secondStarted).toBe(false);
		await first.executeRaw(q("COMMIT"));
		await first.commit();
		const tx = await second;
		expect(secondStarted).toBe(true);
		await tx.executeRaw(q("ROLLBACK"));
		await tx.rollback();
	});

	it("refuses an isolation level SQLite cannot give", async () => {
		expect(await rejection(adapter.startTransaction("READ COMMITTED"))).toMatchObject({
			kind: "InvalidIsolationLevel",
			level: "READ COMMITTED",
		});
	});

	it("frees the lock when BEGIN itself fails", async () => {
		await adapter.executeScript("BEGIN");
		expect(await rejection(adapter.startTransaction())).toMatchObject({ kind: "sqlite" });
		await adapter.executeScript("ROLLBACK");
		const tx = await adapter.startTransaction();
		await tx.executeRaw(q("ROLLBACK"));
		await tx.rollback();
	});
});

describe("errors", () => {
	it("maps SQLITE_BUSY to SocketTimeout, which the migrator retries on", async () => {
		const holder = new DatabaseSync(file);
		holder.exec("BEGIN IMMEDIATE");
		const contender = await new PrismaNodeSqlite({ url: file, timeout: 0 }).connect();
		try {
			const cause = await rejection(contender.executeRaw(q("INSERT INTO t (i) VALUES (1)")));
			expect(cause).toMatchObject({ kind: "SocketTimeout", originalCode: "5" });

			let raw: unknown;
			try {
				new DatabaseSync(file, { timeout: 0 }).exec("BEGIN IMMEDIATE");
			} catch (e) {
				raw = e;
			}
			expect(isBusyError(raw)).toBe(true);
			expect(isBusyError(new Error("nope"))).toBe(false);
		} finally {
			holder.exec("ROLLBACK");
			holder.close();
			await contender.dispose();
		}
	});

	it("maps constraint violations the way the better-sqlite3 adapter did", async () => {
		await adapter.executeRaw(q("INSERT INTO t (id, email) VALUES (1, 'a@b')"));
		expect(await rejection(adapter.executeRaw(q("INSERT INTO t (email) VALUES ('a@b')")))).toMatchObject({
			kind: "UniqueConstraintViolation",
			constraint: { fields: ["email"] },
			table: "t",
		});
		expect(await rejection(adapter.executeRaw(q("INSERT INTO t (id) VALUES (1)")))).toMatchObject({
			kind: "UniqueConstraintViolation",
			constraint: { fields: ["id"] },
		});
		expect(await rejection(adapter.executeRaw(q("INSERT INTO t (s) VALUES (NULL)")))).toMatchObject({
			kind: "NullConstraintViolation",
			constraint: { fields: ["s"] },
		});
		expect(await rejection(adapter.executeRaw(q("INSERT INTO child (t_id) VALUES (99)")))).toMatchObject({
			kind: "ForeignKeyConstraintViolation",
		});
	});

	it("maps missing tables and columns, and passes anything else through as sqlite", async () => {
		expect(await rejection(adapter.queryRaw(q("SELECT * FROM nope")))).toMatchObject({
			kind: "TableDoesNotExist",
			table: "nope",
		});
		expect(await rejection(adapter.queryRaw(q("SELECT nope FROM t")))).toMatchObject({
			kind: "ColumnNotFound",
			column: "nope",
		});
		expect(await rejection(adapter.executeRaw(q("INSERT INTO t (nope) VALUES (1)")))).toMatchObject({
			kind: "ColumnNotFound",
			column: "nope",
		});
		expect(await rejection(adapter.executeScript("NOT SQL"))).toMatchObject({ kind: "sqlite" });
	});

	it("rethrows errors that are not SQLite's", () => {
		const boom = new TypeError("not sqlite");
		expect(() => convertDriverError(boom)).toThrow(boom);
	});
});

describe("factory", () => {
	it("opens read-only when asked, and refuses writes", async () => {
		const ro = await new PrismaNodeSqlite({ url: file, readOnly: true }).connect();
		try {
			expect(await rejection(ro.executeRaw(q("INSERT INTO t (i) VALUES (1)")))).toMatchObject({
				kind: "sqlite",
				extendedCode: 8, // SQLITE_READONLY
			});
		} finally {
			await ro.dispose();
		}
	});

	it("gives the migration engine an in-memory shadow database", async () => {
		const factory = new PrismaNodeSqlite({ url: file });
		expect(factory.adapterName).toBe("@prismalens/adapter-node-sqlite");
		const shadow = await factory.connectToShadowDb();
		try {
			expect((await shadow.queryRaw(q("SELECT name FROM sqlite_master WHERE name = 't'"))).rows).toEqual([]);
		} finally {
			await shadow.dispose();
		}
	});
});
