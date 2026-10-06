// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel
// Ported from @prisma/adapter-better-sqlite3@7.10.0 dist/index.mjs (src/conversion.ts),
// Apache-2.0, Copyright Prisma Data, Inc.

import {
	type ArgType,
	type ColumnType,
	ColumnTypeEnum,
} from "@prisma/driver-adapter-utils";

export type TimestampFormat = "iso8601" | "unixepoch-ms";

function mapDeclType(declType: string | null): ColumnType | null {
	if (declType === null) return null;
	switch (declType.toUpperCase()) {
		case "":
			return null;
		case "DECIMAL":
			return ColumnTypeEnum.Numeric;
		case "FLOAT":
			return ColumnTypeEnum.Float;
		case "DOUBLE":
		case "DOUBLE PRECISION":
		case "NUMERIC":
		case "REAL":
			return ColumnTypeEnum.Double;
		case "TINYINT":
		case "SMALLINT":
		case "MEDIUMINT":
		case "INT":
		case "INTEGER":
		case "SERIAL":
		case "INT2":
			return ColumnTypeEnum.Int32;
		case "BIGINT":
		case "UNSIGNED BIG INT":
		case "INT8":
			return ColumnTypeEnum.Int64;
		case "DATETIME":
		case "TIMESTAMP":
			return ColumnTypeEnum.DateTime;
		case "TIME":
			return ColumnTypeEnum.Time;
		case "DATE":
			return ColumnTypeEnum.Date;
		case "TEXT":
		case "CLOB":
		case "CHARACTER":
		case "VARCHAR":
		case "VARYING CHARACTER":
		case "NCHAR":
		case "NATIVE CHARACTER":
		case "NVARCHAR":
			return ColumnTypeEnum.Text;
		case "BLOB":
			return ColumnTypeEnum.Bytes;
		case "BOOLEAN":
			return ColumnTypeEnum.Boolean;
		case "JSONB":
			return ColumnTypeEnum.Json;
		default:
			return null;
	}
}

export class UnexpectedTypeError extends Error {
	override name = "UnexpectedTypeError";
	constructor(value: unknown) {
		const type = typeof value;
		const repr =
			type === "object" ? JSON.stringify(value) : String(value as string);
		super(`unexpected value of type ${type}: ${repr}`);
	}
}

function inferColumnType(value: unknown): ColumnType {
	switch (typeof value) {
		case "string":
			return ColumnTypeEnum.Text;
		case "bigint":
			return ColumnTypeEnum.Int64;
		case "boolean":
			return ColumnTypeEnum.Boolean;
		case "number":
			return ColumnTypeEnum.UnknownNumber;
		case "object":
			// node:sqlite returns BLOBs as Uint8Array (better-sqlite3: Buffer).
			if (value instanceof Uint8Array || value instanceof ArrayBuffer)
				return ColumnTypeEnum.Bytes;
			throw new UnexpectedTypeError(value);
		default:
			throw new UnexpectedTypeError(value);
	}
}

/** Declared types first; a column with none is typed from its first non-null value. */
export function getColumnTypes(
	declaredTypes: Array<string | null>,
	rows: unknown[][],
): ColumnType[] {
	const columnTypes = declaredTypes.map(mapDeclType);
	columnTypes.forEach((type, columnIndex) => {
		if (type !== null) return;
		const sample = rows.find((row) => row[columnIndex] !== null);
		columnTypes[columnIndex] =
			sample === undefined
				? ColumnTypeEnum.Int32
				: inferColumnType(sample[columnIndex]);
	});
	return columnTypes as ColumnType[];
}

export function mapRow(row: unknown[], columnTypes: ColumnType[]): unknown[] {
	return row.map((value, i) => {
		const type = columnTypes[i];
		if (
			typeof value === "number" &&
			(type === ColumnTypeEnum.Int32 || type === ColumnTypeEnum.Int64) &&
			!Number.isInteger(value)
		) {
			return Math.trunc(value);
		}
		if (
			(typeof value === "number" || typeof value === "bigint") &&
			type === ColumnTypeEnum.DateTime
		) {
			return new Date(Number(value)).toISOString();
		}
		if (typeof value === "bigint") {
			const asNumber = Number(value);
			return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
		}
		return value;
	});
}

export function mapArg(
	arg: unknown,
	argType: ArgType,
	timestampFormat: TimestampFormat = "iso8601",
): unknown {
	if (arg === null) return null;
	if (typeof arg === "string") {
		switch (argType.scalarType) {
			case "int":
				return Number.parseInt(arg, 10);
			case "float":
			case "decimal":
				return Number.parseFloat(arg);
			case "bigint":
				return BigInt(arg);
			case "datetime":
				arg = new Date(arg);
				break;
			case "bytes":
				return Buffer.from(arg, "base64");
		}
	}
	if (typeof arg === "boolean") return arg ? 1 : 0;
	if (arg instanceof Date) {
		return timestampFormat === "unixepoch-ms"
			? arg.getTime()
			: arg.toISOString().replace("Z", "+00:00");
	}
	return arg;
}
