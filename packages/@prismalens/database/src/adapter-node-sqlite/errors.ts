// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// Ported from @prisma/adapter-better-sqlite3@7.10.0 dist/index.mjs (src/errors.ts),
// Apache-2.0, Copyright Prisma Data, Inc. node:sqlite reports the numeric
// extended result code as `errcode` where better-sqlite3 gave a code name.

import type { Error as DriverError } from "@prisma/driver-adapter-utils";

const SQLITE_BUSY = 5;
const SQLITE_CONSTRAINT_FOREIGNKEY = 787;
const SQLITE_CONSTRAINT_NOTNULL = 1299;
const SQLITE_CONSTRAINT_PRIMARYKEY = 1555;
const SQLITE_CONSTRAINT_TRIGGER = 1811;
const SQLITE_CONSTRAINT_UNIQUE = 2067;
const PRIMARY_ERROR_CODE_MASK = 0xff;

/** What node:sqlite throws for an SQLite failure (`code: "ERR_SQLITE_ERROR"`). */
export interface SqliteError extends Error {
	code: "ERR_SQLITE_ERROR";
	errcode: number;
	errstr: string;
}

export function isSqliteError(error: unknown): error is SqliteError {
	if (!(error instanceof Error)) return false;
	const e = error as Partial<SqliteError>;
	return e.code === "ERR_SQLITE_ERROR" && typeof e.errcode === "number";
}

/** SQLITE_BUSY or any of its extended codes: another connection holds the lock. */
export function isBusyError(error: unknown): boolean {
	return (
		isSqliteError(error) &&
		(error.errcode & PRIMARY_ERROR_CODE_MASK) === SQLITE_BUSY
	);
}

const fieldsOf = (message: string) =>
	message
		.split("constraint failed: ")
		.at(1)
		?.split(", ")
		.map((field) => field.split(".").pop() as string);

function mapSqliteError(error: SqliteError): DriverError {
	switch (error.errcode) {
		case SQLITE_CONSTRAINT_UNIQUE:
		case SQLITE_CONSTRAINT_PRIMARYKEY: {
			const columns = error.message
				.split("constraint failed: ")
				.at(1)
				?.split(", ");
			const fields = fieldsOf(error.message);
			const table =
				columns?.at(0)?.split(".").slice(0, -1).join(".") || undefined;
			return {
				kind: "UniqueConstraintViolation",
				constraint: fields !== undefined ? { fields } : undefined,
				table,
			};
		}
		case SQLITE_CONSTRAINT_NOTNULL: {
			const fields = fieldsOf(error.message);
			return {
				kind: "NullConstraintViolation",
				constraint: fields !== undefined ? { fields } : undefined,
			};
		}
		case SQLITE_CONSTRAINT_FOREIGNKEY:
		case SQLITE_CONSTRAINT_TRIGGER:
			return {
				kind: "ForeignKeyConstraintViolation",
				constraint: { foreignKey: {} },
			};
	}
	if (isBusyError(error)) return { kind: "SocketTimeout" };
	if (error.message.startsWith("no such table")) {
		return {
			kind: "TableDoesNotExist",
			table: error.message.split(": ").at(1),
		};
	}
	if (error.message.startsWith("no such column")) {
		return { kind: "ColumnNotFound", column: error.message.split(": ").at(1) };
	}
	if (error.message.includes("has no column named ")) {
		return {
			kind: "ColumnNotFound",
			column: error.message.split("has no column named ").at(1),
		};
	}
	return {
		kind: "sqlite",
		extendedCode: error.errcode,
		message: error.message,
	};
}

/** Prisma's error shape for an SQLite failure; anything else is rethrown untouched. */
export function convertDriverError(error: unknown): DriverError {
	if (!isSqliteError(error)) throw error;
	return {
		originalCode: String(error.errcode),
		originalMessage: error.message,
		...mapSqliteError(error),
	};
}
