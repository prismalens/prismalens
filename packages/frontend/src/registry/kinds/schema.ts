// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import * as z from "zod/mini";

/** Schema parts the kinds share; zod/mini keeps the entry chunk small. */
export const fn = z.custom<(...args: never[]) => unknown>(
	(v) => typeof v === "function",
	"must be a function",
);
export const text = z.string().check(z.minLength(1));
/** A Lucide icon component (an object), or a function of the object that picks one. */
export const icon = z.custom<object>(
	(v) => (typeof v === "object" && v !== null) || typeof v === "function",
	"must be an icon",
);
/** `object.name`, e.g. `thread.archive`. */
export const dottedId = z
	.string()
	.check(
		z.regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9-]+)+$/, "must read object.name"),
	);
export const plainId = z
	.string()
	.check(
		z.regex(
			/^[a-z][a-zA-Z0-9]*(?:[.-][a-zA-Z0-9]+)*$/,
			"must be lower-case words joined by . or -",
		),
	);
export const states = z.catchall(
	z.object({ default: text, phone: text }),
	text,
);
export const ymd = z
	.string()
	.check(z.regex(/^\d{4}-\d{2}-\d{2}$/, "must be YYYY-MM-DD"));
/** Who asked for an entry: a date, their words and where they said them. */
export const said = z.object({ date: ymd, quote: text, where: text });
export { z };
