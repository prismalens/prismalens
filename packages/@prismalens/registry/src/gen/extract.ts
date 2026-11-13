// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import ts from "typescript";
import type { Scaffold } from "../kind.ts";
import type {
	Literal,
	ManifestEntry,
	ManifestKind,
	ManifestUse,
} from "../manifest.ts";

/** A kind as read from its file, plus where its entries render. */
export interface KindSource extends ManifestKind {
	readonly name: string;
	/** The interface the generator writes as `id: object`, e.g. `ActionObjects`. */
	readonly index?: string;
	/** JSX components whose `id` prop names an entry, and a raw attribute that does the same. */
	readonly uses?: {
		readonly components?: readonly string[];
		readonly attribute?: string;
		readonly prop?: string;
	};
}

export const parse = (file: string, text: string) =>
	ts.createSourceFile(
		file,
		text,
		ts.ScriptTarget.Latest,
		true,
		file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
	);

const unwrap = (n: ts.Expression): ts.Expression =>
	ts.isAsExpression(n) ||
	ts.isSatisfiesExpression(n) ||
	ts.isParenthesizedExpression(n) ||
	ts.isTypeAssertionExpression(n)
		? unwrap(n.expression)
		: n;

const propName = (n: ts.PropertyName): string | undefined =>
	ts.isIdentifier(n) || ts.isStringLiteral(n) || ts.isNumericLiteral(n)
		? n.text
		: undefined;

/** A file's top-level `const` initializers by name: an entry may spread or reference them. */
export type Scope = ReadonlyMap<string, ts.Expression>;
const NONE: Scope = new Map();

export function scopeOf(sf: ts.SourceFile): Scope {
	const out = new Map<string, ts.Expression>();
	for (const st of sf.statements)
		if (
			ts.isVariableStatement(st) &&
			st.declarationList.flags & ts.NodeFlags.Const
		)
			for (const d of st.declarationList.declarations)
				if (ts.isIdentifier(d.name) && d.initializer)
					out.set(d.name.text, d.initializer);
	return out;
}

/**
 * The JSON value of an expression written as a literal, or undefined when any
 * part is computed. Same-file consts and spreads of them count as literal.
 */
export function literal(
	node: ts.Expression,
	scope: Scope = NONE,
	depth = 0,
): Literal | undefined {
	const n = unwrap(node);
	if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n))
		return n.text;
	if (ts.isNumericLiteral(n)) return Number(n.text);
	if (n.kind === ts.SyntaxKind.TrueKeyword) return true;
	if (n.kind === ts.SyntaxKind.FalseKeyword) return false;
	if (n.kind === ts.SyntaxKind.NullKeyword) return null;
	if (
		ts.isPrefixUnaryExpression(n) &&
		n.operator === ts.SyntaxKind.MinusToken &&
		ts.isNumericLiteral(n.operand)
	)
		return -Number(n.operand.text);
	if (ts.isIdentifier(n)) {
		const to = scope.get(n.text);
		return to && depth < 8 ? literal(to, scope, depth + 1) : undefined;
	}
	if (ts.isArrayLiteralExpression(n)) {
		const out: Literal[] = [];
		for (const el of n.elements) {
			const spread = ts.isSpreadElement(el);
			const v = literal(spread ? el.expression : el, scope, depth);
			if (v === undefined || (spread && !Array.isArray(v))) return undefined;
			if (spread) out.push(...(v as readonly Literal[]));
			else out.push(v);
		}
		return out;
	}
	if (ts.isObjectLiteralExpression(n)) return fieldsOf(n, scope, depth);
	return undefined;
}

/** The literal-valued properties of an object; computed ones are left out. */
export function fieldsOf(
	obj: ts.ObjectLiteralExpression,
	scope: Scope = NONE,
	depth = 0,
): {
	[key: string]: Literal;
} {
	const out: { [key: string]: Literal } = {};
	for (const p of obj.properties) {
		if (ts.isSpreadAssignment(p)) {
			const v = literal(p.expression, scope, depth);
			if (v && typeof v === "object" && !Array.isArray(v))
				Object.assign(out, v);
			continue;
		}
		const key =
			ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)
				? propName(p.name)
				: undefined;
		if (key === undefined) continue;
		const v = ts.isPropertyAssignment(p)
			? literal(p.initializer, scope, depth)
			: literal((p as ts.ShorthandPropertyAssignment).name, scope, depth);
		if (v !== undefined) out[key] = v;
	}
	return out;
}

const objectArg = (call: ts.CallExpression) => {
	const a = call.arguments[0];
	const u = a && unwrap(a);
	return u && ts.isObjectLiteralExpression(u) ? u : undefined;
};

const lineOf = (sf: ts.SourceFile, n: ts.Node) =>
	sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1;

/** Reads every `defineKind({...})` in a kind file. */
export function readKinds(
	file: string,
	text: string,
	problems: string[],
): KindSource[] {
	const sf = parse(file, text);
	const out: KindSource[] = [];
	const visit = (n: ts.Node) => {
		if (
			ts.isCallExpression(n) &&
			ts.isIdentifier(n.expression) &&
			n.expression.text === "defineKind"
		) {
			const obj = objectArg(n);
			const f = obj ? fieldsOf(obj) : {};
			const where = `${file}:${lineOf(sf, n)}`;
			if (
				typeof f.name !== "string" ||
				typeof f.suffix !== "string" ||
				typeof f.about !== "string"
			) {
				problems.push(
					`${where}: a kind's name, suffix and about must be string literals`,
				);
				return;
			}
			const guards: string[] = [];
			const g = obj?.properties.find(
				(p): p is ts.PropertyAssignment =>
					ts.isPropertyAssignment(p) && propName(p.name) === "guards",
			);
			const arr = g && unwrap(g.initializer);
			if (arr && ts.isArrayLiteralExpression(arr))
				for (const el of arr.elements) {
					const e = unwrap(el);
					if (ts.isIdentifier(e)) guards.push(e.text);
					else if (ts.isPropertyAccessExpression(e)) guards.push(e.name.text);
				}
			const uses = f.uses as KindSource["uses"] | undefined;
			out.push({
				name: f.name,
				file,
				suffix: f.suffix,
				about: f.about,
				refs: (f.refs ?? {}) as Record<string, string>,
				aliases: (f.aliases ?? []) as string[],
				keywords: (f.keywords ?? []) as string[],
				...(typeof f.index === "string" ? { index: f.index } : {}),
				...(f.scaffold ? { scaffold: f.scaffold as unknown as Scaffold } : {}),
				guards,
				...(uses ? { uses } : {}),
			});
			return;
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return out;
}

/** The kind a call defines: `define.<kind>(...)`, or one of a kind's aliases. */
function kindOfCall(
	call: ts.CallExpression,
	kinds: readonly KindSource[],
): string | undefined {
	const c = call.expression;
	if (
		ts.isPropertyAccessExpression(c) &&
		ts.isIdentifier(c.expression) &&
		c.expression.text === "define"
	)
		return c.name.text;
	if (ts.isIdentifier(c))
		return kinds.find((k) => k.aliases.includes(c.text))?.name;
	return undefined;
}

/** Reads the entries a file defines; anything the collector could not see becomes a problem. */
export function readEntries(
	file: string,
	text: string,
	kinds: readonly KindSource[],
	problems: string[],
): { kind: string; entry: ManifestEntry }[] {
	const sf = parse(file, text);
	const scope = scopeOf(sf);
	const out: { kind: string; entry: ManifestEntry }[] = [];
	const handled = new Set<ts.Node>();
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		const exported = st.modifiers?.some(
			(m) => m.kind === ts.SyntaxKind.ExportKeyword,
		);
		for (const d of st.declarationList.declarations) {
			const init = d.initializer && unwrap(d.initializer);
			if (!init || !ts.isCallExpression(init) || !ts.isIdentifier(d.name))
				continue;
			const kind = kindOfCall(init, kinds);
			if (!kind) continue;
			handled.add(init);
			const where = `${file}:${lineOf(sf, d)}`;
			const k = kinds.find((x) => x.name === kind);
			if (!k) {
				problems.push(`${where}: define.${kind} names no registered kind`);
				continue;
			}
			if (!file.endsWith(k.suffix)) {
				problems.push(
					`${where}: ${kind === "action" ? "an" : "a"} ${kind} is defined only in a ${k.suffix} file`,
				);
				continue;
			}
			if (!exported) {
				problems.push(
					`${where}: export ${d.name.text}; the collector reads exports only`,
				);
				continue;
			}
			const obj = objectArg(init);
			const fields = obj ? fieldsOf(obj, scope) : {};
			const idNode = obj?.properties.find(
				(p): p is ts.PropertyAssignment =>
					ts.isPropertyAssignment(p) && propName(p.name) === "id",
			)?.initializer;
			if (
				!idNode ||
				!(
					ts.isStringLiteral(idNode) ||
					ts.isNoSubstitutionTemplateLiteral(idNode)
				) ||
				typeof fields.id !== "string"
			) {
				problems.push(
					`${where}: ${kind === "action" ? "an" : "a"} ${kind}'s id must be a string literal`,
				);
				continue;
			}
			out.push({
				kind,
				entry: { id: fields.id, file, export: d.name.text, fields },
			});
		}
	}
	const stray = (n: ts.Node) => {
		if (ts.isCallExpression(n) && !handled.has(n) && kindOfCall(n, kinds))
			problems.push(
				`${file}:${lineOf(sf, n)}: bind each definition to an exported const at the top of the file`,
			);
		ts.forEachChild(n, stray);
	};
	stray(sf);
	return out;
}

const attr = (
	el: ts.JsxOpeningLikeElement,
	name: string,
): string | undefined => {
	for (const p of el.attributes.properties) {
		if (!ts.isJsxAttribute(p) || p.name.getText() !== name || !p.initializer)
			continue;
		if (ts.isStringLiteral(p.initializer)) return p.initializer.text;
		if (ts.isJsxExpression(p.initializer) && p.initializer.expression) {
			const v = literal(p.initializer.expression);
			if (typeof v === "string") return v;
		}
	}
	return undefined;
};

/** Marks a use that names an entry by its exported binding; the generator resolves it to an id. */
export const EXPORT = "@export:";

/** The identifiers a prop's expression can evaluate to: `{a}`, `{x ? a : b}`, `{a ?? b}`. */
function bindings(el: ts.JsxOpeningLikeElement, name: string): string[] {
	const out: string[] = [];
	const walk = (e: ts.Expression) => {
		const u = unwrap(e);
		if (ts.isIdentifier(u)) out.push(u.text);
		else if (ts.isConditionalExpression(u)) {
			walk(u.whenTrue);
			walk(u.whenFalse);
		} else if (
			ts.isBinaryExpression(u) &&
			(u.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
				u.operatorToken.kind === ts.SyntaxKind.BarBarToken)
		) {
			walk(u.left);
			walk(u.right);
		}
	};
	for (const p of el.attributes.properties)
		if (
			ts.isJsxAttribute(p) &&
			p.name.getText() === name &&
			p.initializer &&
			ts.isJsxExpression(p.initializer) &&
			p.initializer.expression
		)
			walk(p.initializer.expression);
	return out;
}

/** A pattern no component may use outside its allowlist, counted per file into the ratchet. */
export interface Forbid {
	readonly rule: string;
	/** What to do instead; the ratchet prints it when a count rises. */
	readonly fix: string;
	/** Callees, written as in source: `copyText`, `navigator.clipboard.writeText`. */
	readonly calls?: readonly string[];
	readonly components?: readonly string[];
	/** Regular expressions matched against the file's text, for patterns no call or tag names. */
	readonly patterns?: readonly string[];
	/** Root-relative files, or `*<suffix>` for every file ending so, that may use them. */
	readonly allow?: readonly string[];
}

/** How many times a file uses each forbidden pattern. */
export function readForbidden(
	file: string,
	text: string,
	forbid: readonly Forbid[],
): { rule: string; count: number }[] {
	const allowed = (f: Forbid) =>
		(f.allow ?? []).some((a) =>
			a.startsWith("*") ? file.endsWith(a.slice(1)) : file === a,
		);
	const counts = new Map<string, number>();
	for (const f of forbid) {
		if (allowed(f)) continue;
		const n = (f.patterns ?? []).reduce(
			(sum, p) => sum + (text.match(new RegExp(p, "g"))?.length ?? 0),
			0,
		);
		if (n) counts.set(f.rule, n);
	}
	const live = forbid.filter(
		(f) =>
			!allowed(f) &&
			[...(f.calls ?? []), ...(f.components ?? [])].some((w) =>
				text.includes(w.split(".").at(-1) ?? w),
			),
	);
	if (!live.length)
		return Array.from(counts, ([rule, count]) => ({ rule, count }));
	const sf = parse(file, text);
	const visit = (n: ts.Node) => {
		for (const f of live) {
			const hit =
				(ts.isCallExpression(n) &&
					(f.calls ?? []).includes(n.expression.getText(sf))) ||
				((ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) &&
					(f.components ?? []).includes(n.tagName.getText(sf)));
			if (hit) counts.set(f.rule, (counts.get(f.rule) ?? 0) + 1);
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return Array.from(counts, ([rule, count]) => ({ rule, count }));
}

/** Gallery ids a design file draws: `<Stage id>`, `data-kit-state` and `{ id, title }` sections. */
export function readGallery(file: string, text: string): string[] {
	const sf = parse(file, text);
	const out: string[] = [];
	const visit = (n: ts.Node) => {
		if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
			const state = attr(n, "data-kit-state");
			if (state) out.push(state);
			if (n.tagName.getText() === "Stage") {
				const id = attr(n, "id");
				if (id) out.push(id);
			}
		}
		if (ts.isObjectLiteralExpression(n)) {
			const id = fieldsOf(n).id;
			if (
				typeof id === "string" &&
				n.properties.some((p) => p.name && propName(p.name) === "title")
			)
				out.push(id);
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return out;
}

/** Where a file renders kinds' ids, by kind. */
export function readUses(
	file: string,
	text: string,
	kinds: readonly KindSource[],
): { kind: string; use: ManifestUse }[] {
	const sf = parse(file, text);
	const out: { kind: string; use: ManifestUse }[] = [];
	const visit = (n: ts.Node) => {
		if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
			const tag = n.tagName.getText();
			for (const k of kinds) {
				if (k.uses?.components?.includes(tag)) {
					const id = attr(n, "id");
					if (id) out.push({ kind: k.name, use: { id, file } });
					if (k.uses.prop)
						for (const name of bindings(n, k.uses.prop))
							out.push({ kind: k.name, use: { id: `${EXPORT}${name}`, file } });
				}
				if (k.uses?.attribute) {
					const id = attr(n, k.uses.attribute);
					if (id) out.push({ kind: k.name, use: { id, file } });
				}
			}
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return out;
}

/** A closed set as read from source: its members' literal views, by id. */
export interface ClosedSource {
	readonly name: string;
	readonly file: string;
	readonly views: Readonly<Record<string, { [key: string]: Literal }>>;
}

/** The object literal an expression is, or names through a same-file const. */
function objectIn(
	e: ts.Expression,
	scope: Scope,
): ts.ObjectLiteralExpression | undefined {
	const u = unwrap(e);
	if (ts.isObjectLiteralExpression(u)) return u;
	if (ts.isIdentifier(u)) {
		const to = scope.get(u.text);
		return to ? objectIn(to, scope) : undefined;
	}
	return undefined;
}

/** A member whose view is a call such as `defineMark({...})`: the literal fields of its object argument. */
function viewOf(e: ts.Expression, scope: Scope): { [key: string]: Literal } {
	const u = unwrap(e);
	if (ts.isCallExpression(u)) {
		const arg = u.arguments[0];
		const o = arg && objectIn(arg, scope);
		if (o) return fieldsOf(o, scope);
	}
	return {};
}

/**
 * Reads every `defineClosed("name", members, views)`: its members are the keys of
 * `views` when that is a record in the same file, else the literal `members` list.
 */
export function readClosed(
	file: string,
	text: string,
	problems: string[],
): ClosedSource[] {
	const sf = parse(file, text);
	const scope = scopeOf(sf);
	const out: ClosedSource[] = [];
	const visit = (n: ts.Node) => {
		if (
			ts.isCallExpression(n) &&
			ts.isIdentifier(n.expression) &&
			n.expression.text === "defineClosed"
		) {
			const [nameArg, membersArg, viewsArg] = n.arguments;
			const name = nameArg && literal(nameArg, scope);
			const record = viewsArg && objectIn(viewsArg, scope);
			const listed = membersArg && literal(membersArg, scope);
			const ids = record
				? record.properties.flatMap((p) =>
						p.name && propName(p.name) !== undefined
							? [propName(p.name) as string]
							: [],
					)
				: Array.isArray(listed)
					? listed.filter((x): x is string => typeof x === "string")
					: undefined;
			if (typeof name !== "string" || !ids) {
				problems.push(
					`${file}:${lineOf(sf, n)}: a closed set needs a literal name, and its views as a record in the same file or its members as a literal list`,
				);
				return;
			}
			const views: Record<string, { [key: string]: Literal }> = {};
			for (const id of ids) {
				const prop = record?.properties.find(
					(p): p is ts.PropertyAssignment =>
						ts.isPropertyAssignment(p) && propName(p.name) === id,
				);
				const v = prop ? literal(prop.initializer, scope) : undefined;
				views[id] =
					v && typeof v === "object" && !Array.isArray(v)
						? (v as { [key: string]: Literal })
						: v !== undefined
							? { value: v }
							: prop
								? viewOf(prop.initializer, scope)
								: {};
			}
			out.push({ name, file, views });
			return;
		}
		ts.forEachChild(n, visit);
	};
	visit(sf);
	return out;
}

/** A test's coverage tags: `@cond:<id>`, `@walk:<id>` and `@surface:<id>` in its source. */
export function readCaseTags(text: string): {
	conditions: string[];
	walks: string[];
	surfaces: string[];
} {
	const tags = {
		conditions: new Set<string>(),
		walks: new Set<string>(),
		surfaces: new Set<string>(),
	};
	for (const m of text.matchAll(
		/@(cond|walk|surface):([A-Za-z0-9][\w.-]*[A-Za-z0-9])/g,
	)) {
		const into =
			m[1] === "cond"
				? tags.conditions
				: m[1] === "walk"
					? tags.walks
					: tags.surfaces;
		if (m[2]) into.add(m[2]);
	}
	return {
		conditions: [...tags.conditions].sort(),
		walks: [...tags.walks].sort(),
		surfaces: [...tags.surfaces].sort(),
	};
}

/** `export const threadObject = defineObject<ThreadCtx, ThreadState>("thread")`: one object kind's context and states. */
export interface ObjectSource {
	readonly name: string;
	readonly file: string;
	readonly export: string;
}

export function readObjects(
	file: string,
	text: string,
	problems: string[],
): ObjectSource[] {
	if (!text.includes("defineObject")) return [];
	const sf = parse(file, text);
	const out: ObjectSource[] = [];
	for (const st of sf.statements) {
		if (!ts.isVariableStatement(st)) continue;
		const exported = st.modifiers?.some(
			(m) => m.kind === ts.SyntaxKind.ExportKeyword,
		);
		for (const d of st.declarationList.declarations) {
			const init = d.initializer && unwrap(d.initializer);
			if (
				!init ||
				!ts.isCallExpression(init) ||
				!ts.isIdentifier(init.expression) ||
				init.expression.text !== "defineObject"
			)
				continue;
			const name = init.arguments[0] && literal(init.arguments[0]);
			const where = `${file}:${lineOf(sf, d)}`;
			if (typeof name !== "string" || !ts.isIdentifier(d.name)) {
				problems.push(`${where}: defineObject takes a string literal name`);
				continue;
			}
			if (!exported) {
				problems.push(
					`${where}: export ${d.name.getText(sf)}; the generator reads exports only`,
				);
				continue;
			}
			out.push({ name, file, export: d.name.text });
		}
	}
	return out;
}
