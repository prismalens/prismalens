// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/**
 * ACP form elicitation ↔ PendingAsk (#1024). A form whose fields are all 2..4-option
 * selects is a `question` ask; another flat primitive form is an `input` ask; any
 * other form is declined, since nobody could answer it faithfully.
 */
import {
	type AskAnswer,
	type AskQuestion,
	type ElicitField,
	type ElicitForm,
	ElicitFormSchema,
} from "@prismalens/contracts/schemas";

/** The `elicitation/create` params PrismaLens reads; url mode is not declared (#1024). */
export interface ElicitationParams {
	mode?: string;
	message?: string;
	requestedSchema?: {
		properties?: Record<string, Record<string, unknown>>;
		required?: string[] | null;
	};
}

export type ElicitationAsk =
	| { kind: "question"; title: string; questions: AskQuestion[] }
	| { kind: "input"; title: string; schema: ElicitForm };

interface SelectOption {
	value: string;
	label: string;
	description?: string;
	preview?: string;
}

const CUSTOM_SUFFIX = "_custom";

function str(v: unknown): string | undefined {
	return typeof v === "string" && v.trim() ? v : undefined;
}

/** A preview string under any `_meta` key, where agents put what EnumOption has no slot for. */
function metaPreview(meta: unknown): string | undefined {
	if (!meta || typeof meta !== "object") return undefined;
	for (const v of Object.values(meta as Record<string, unknown>)) {
		const p =
			v && typeof v === "object"
				? (v as { preview?: unknown }).preview
				: undefined;
		if (typeof p === "string" && p) return p.slice(0, 8000);
	}
	return undefined;
}

function options(list: unknown): SelectOption[] | null {
	if (!Array.isArray(list)) return null;
	const out: SelectOption[] = [];
	for (const o of list) {
		if (typeof o === "string") out.push({ value: o, label: o });
		else if (
			o &&
			typeof o === "object" &&
			typeof (o as { const?: unknown }).const === "string"
		) {
			const e = o as Record<string, unknown>;
			const value = e.const as string;
			out.push({
				value,
				label: str(e.title) ?? value,
				...(str(e.description) ? { description: str(e.description) } : {}),
				...(metaPreview(e._meta) ? { preview: metaPreview(e._meta) } : {}),
			});
		} else return null;
	}
	return out;
}

/** A field's choices and whether several may be picked; null when it is not a select. */
function select(
	field: Record<string, unknown>,
): { multi: boolean; options: SelectOption[] } | null {
	if (field.type === "string") {
		const o = options(field.oneOf) ?? options(field.enum);
		if (!o) return null;
		const names = Array.isArray(field.enumNames) ? field.enumNames : null;
		return {
			multi: false,
			options: names
				? o.map((x, i) => ({ ...x, label: str(names[i]) ?? x.label }))
				: o,
		};
	}
	if (
		field.type === "array" &&
		field.items &&
		typeof field.items === "object"
	) {
		const items = field.items as Record<string, unknown>;
		const o = options(items.anyOf) ?? options(items.enum);
		return o ? { multi: true, options: o } : null;
	}
	return null;
}

function selects(params: ElicitationParams) {
	const props = params.requestedSchema?.properties ?? {};
	const fields: {
		key: string;
		multi: boolean;
		options: SelectOption[];
		field: Record<string, unknown>;
	}[] = [];
	const customs = new Set<string>();
	for (const [key, field] of Object.entries(props)) {
		const s = select(field);
		if (s) fields.push({ key, ...s, field });
		else if (
			field.type === "string" &&
			key.endsWith(CUSTOM_SUFFIX) &&
			props[key.slice(0, -CUSTOM_SUFFIX.length)]
		)
			customs.add(key.slice(0, -CUSTOM_SUFFIX.length));
		else return null;
	}
	return { fields, customs };
}

const TITLE_MAX = 500;

/** What PrismaLens asks the user for an elicitation; null declines it. */
export function elicitationAsk(
	params: ElicitationParams,
): ElicitationAsk | null {
	if (params.mode !== undefined && params.mode !== "form") return null;
	const title = (str(params.message) ?? "The agent has a question").slice(
		0,
		TITLE_MAX,
	);
	// An agent's `required` that is not a list of names declines the form, never throws.
	const requiredList: unknown = params.requestedSchema?.required;
	if (
		requiredList != null &&
		!(
			Array.isArray(requiredList) &&
			requiredList.every((k) => typeof k === "string")
		)
	)
		return null;
	const s = selects(params);
	const required = new Set<string>((requiredList as string[] | null) ?? []);
	if (
		s &&
		s.fields.length >= 1 &&
		s.fields.length <= 4 &&
		s.fields.every((f) => f.options.length >= 2 && f.options.length <= 4)
	) {
		const single = s.fields.length === 1;
		return {
			kind: "question",
			title,
			questions: s.fields.map((f) => {
				const header = str(f.field.title)?.slice(0, 40);
				return {
					id: f.key.slice(0, 100),
					prompt: (single
						? title
						: (str(f.field.description) ?? str(f.field.title) ?? title)
					).slice(0, 2000),
					...(header ? { header } : {}),
					multiSelect: f.multi,
					allowOther: s.customs.has(f.key),
					required: required.has(f.key),
					options: f.options.map((o) => ({
						id: o.value.slice(0, 100),
						label: o.label.slice(0, 200),
						...(o.description
							? { description: o.description.slice(0, 1000) }
							: {}),
						...(o.preview ? { preview: o.preview } : {}),
					})),
				};
			}),
		};
	}
	const form = ElicitFormSchema.safeParse({
		type: "object",
		properties: params.requestedSchema?.properties ?? {},
		...(params.requestedSchema?.required
			? { required: params.requestedSchema.required }
			: {}),
	});
	if (!form.success || Object.keys(form.data.properties).length === 0)
		return null;
	return { kind: "input", title, schema: form.data };
}

/** The `accept` content for an answer; null when the answer does not fit the ask, so it is declined. */
export function elicitationContent(
	ask: ElicitationAsk,
	answer: AskAnswer,
): Record<string, string | number | boolean | string[]> | null {
	if (ask.kind === "question" && answer.kind === "question") {
		const byId = new Map(ask.questions.map((q) => [q.id, q]));
		if (Object.keys(answer.answers).some((id) => !byId.has(id))) return null;
		const content: Record<string, string | string[]> = {};
		for (const q of ask.questions) {
			const a = answer.answers[q.id];
			if (!a) {
				if (q.required) return null;
				continue;
			}
			const known = new Set(q.options.map((o) => o.id));
			if (a.options.some((o) => !known.has(o))) return null;
			if (a.other && !q.allowOther) return null;
			if (!q.multiSelect && a.options.length > 1) return null;
			if (a.options.length === 0 && !a.other) return null;
			if (q.multiSelect) content[q.id] = [...a.options];
			else if (a.options[0]) content[q.id] = a.options[0];
			if (a.other) content[`${q.id}${CUSTOM_SUFFIX}`] = a.other;
		}
		return content;
	}
	if (ask.kind === "input" && answer.kind === "input") {
		const fields = ask.schema.properties;
		if (Object.keys(answer.values).some((key) => !(key in fields))) return null;
		const content: Record<string, string | number | boolean> = {};
		for (const [key, field] of Object.entries(fields)) {
			const v = answer.values[key];
			if (v === undefined) {
				if (ask.schema.required?.includes(key)) return null;
				continue;
			}
			if (!fieldTakes(field, v)) return null;
			content[key] = v;
		}
		return content;
	}
	return null;
}

/** What settles an elicitation: a decline, or an answer the whole form takes (#1024). */
export function elicitationAccepts(
	ask: ElicitationAsk,
): (answer: AskAnswer) => boolean {
	return (answer) =>
		answer.kind === "decline" || elicitationContent(ask, answer) !== null;
}

/** A real calendar day: `2026-02-31` parses in JS but is no date. */
function calendarDay(v: string): boolean {
	const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v);
	if (!m) return false;
	const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
	const day = new Date(Date.UTC(y, mo - 1, d));
	return (
		day.getUTCFullYear() === y &&
		day.getUTCMonth() === mo - 1 &&
		day.getUTCDate() === d
	);
}

const DATE_TIME =
	/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d+)?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$/i;

const FORMATS: Record<string, (v: string) => boolean> = {
	email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v),
	uri: (v) => URL.canParse(v),
	date: (v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && calendarDay(v),
	// RFC 3339: a real time and an offset; `Date.parse` alone takes no offset or T24.
	"date-time": (v) =>
		DATE_TIME.test(v) && calendarDay(v) && !Number.isNaN(Date.parse(v)),
};

/** Whether one value fits its field: type, length, format, enum and bounds (#1024). */
function fieldTakes(field: ElicitField, v: string | number | boolean): boolean {
	if (field.type === "boolean") return typeof v === "boolean";
	if (field.type === "string") {
		if (typeof v !== "string") return false;
		if (field.minLength !== undefined && v.length < field.minLength)
			return false;
		if (field.maxLength !== undefined && v.length > field.maxLength)
			return false;
		if (field.enum && !field.enum.includes(v)) return false;
		return !field.format || (FORMATS[field.format]?.(v) ?? false);
	}
	if (typeof v !== "number" || !Number.isFinite(v)) return false;
	if (field.type === "integer" && !Number.isInteger(v)) return false;
	if (field.minimum !== undefined && v < field.minimum) return false;
	return field.maximum === undefined || v <= field.maximum;
}
