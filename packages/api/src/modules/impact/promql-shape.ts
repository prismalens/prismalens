// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { ComparisonOp, Threshold } from "@prismalens/contracts/schemas";
import { parser } from "@prometheus-io/lezer-promql";

/** What an alert expression is, read with the official PromQL grammar. */
export interface ExpressionShape {
	/** What to chart: the series side of a `<series> <op> <number>`, else the whole expression. */
	series: string;
	/** The threshold line, with the op read as `series op value`; null for any other shape. */
	threshold: Threshold | null;
	/** Why a fix check cannot judge it; null when it can. */
	uncheckable: "unsupported-shape" | "range-function" | null;
}

type SyntaxNode = ReturnType<typeof parser.parse>["topNode"];

const COMPARISONS: Record<string, ComparisonOp> = {
	Eql: "==",
	Neq: "!=",
	Gtr: ">",
	Lss: "<",
	Gte: ">=",
	Lte: "<=",
};
/** `5 < x` fires when `x > 5`. */
const MIRROR: Record<ComparisonOp, ComparisonOp> = {
	"==": "==",
	"!=": "!=",
	">": "<",
	"<": ">",
	">=": "<=",
	"<=": ">=",
};
/** A value stamped at evaluation time even when its newest input is old (Prometheus engine), so freshness is unknown. */
const TIME_SHIFTING = new Set([
	"MatrixSelector",
	"SubqueryExpr",
	"OffsetExpr",
	"StepInvariantExpr",
]);

function unwrap(node: SyntaxNode | null): SyntaxNode | null {
	let n = node;
	while (n?.name === "ParenExpr") n = n.firstChild;
	return n;
}

function some(node: SyntaxNode, test: (n: SyntaxNode) => boolean): boolean {
	if (test(node)) return true;
	for (let c = node.firstChild; c; c = c.nextSibling)
		if (some(c, test)) return true;
	return false;
}

function numberOf(node: SyntaxNode, expr: string): number | null {
	const n = unwrap(node);
	if (!n) return null;
	if (n.name === "UnaryExpr") {
		const sign = expr.slice(n.from, n.to).trim().startsWith("-") ? -1 : 1;
		const inner = n.lastChild ? numberOf(n.lastChild, expr) : null;
		return inner === null ? null : sign * inner;
	}
	if (n.name !== "NumberDurationLiteral") return null;
	const value = Number(expr.slice(n.from, n.to));
	return Number.isFinite(value) ? value : null;
}

/**
 * `<series> <op> <number>` or `<number> <op> <series>`, with no `bool`, splits into the series to
 * chart and its threshold (a comparison drops the samples where it is false). The check also needs
 * the series free of range functions, subqueries, `offset` and `@` (research-data Q1c, #811).
 */
export function expressionShape(expr: string): ExpressionShape {
	const whole = { series: expr, threshold: null };
	const tree = parser.parse(expr);
	const top = tree.topNode;
	if (some(top, (n) => n.type.isError))
		return { ...whole, uncheckable: "unsupported-shape" };
	const root = unwrap(top.firstChild);
	if (root?.name !== "BinaryExpr")
		return { ...whole, uncheckable: "unsupported-shape" };
	const left = root.firstChild;
	const opNode = left?.nextSibling;
	const right = root.lastChild;
	const op = opNode ? COMPARISONS[opNode.name] : undefined;
	// Node objects are not identity-stable; positions are. A `bool` or matching modifier sits between.
	if (!left || !right || !op || opNode?.nextSibling?.from !== right.from)
		return { ...whole, uncheckable: "unsupported-shape" };
	const leftNumber = numberOf(left, expr);
	const rightNumber = numberOf(right, expr);
	if ((leftNumber === null) === (rightNumber === null))
		return { ...whole, uncheckable: "unsupported-shape" };
	const seriesNode = rightNumber !== null ? left : right;
	const value = (rightNumber ?? leftNumber) as number;
	return {
		series: expr.slice(seriesNode.from, seriesNode.to),
		threshold: { op: rightNumber !== null ? op : MIRROR[op], value },
		uncheckable: some(seriesNode, (n) => TIME_SHIFTING.has(n.name))
			? "range-function"
			: null,
	};
}

/** True when `value` is on the firing side of the threshold. */
export function breaches(value: number, t: Threshold): boolean {
	switch (t.op) {
		case "==":
			return value === t.value;
		case "!=":
			return value !== t.value;
		case ">":
			return value > t.value;
		case "<":
			return value < t.value;
		case ">=":
			return value >= t.value;
		case "<=":
			return value <= t.value;
	}
}

/** The made-up catch-up form `ALERTS{alertname="X"}`: the firing series, never the metric. */
export function isAlertsSeriesExpr(expr: string, alertname: string): boolean {
	return expr.trim() === `ALERTS{alertname="${alertname}"}`;
}

/** An http(s) link, or null; the server never fetches it. */
export function httpLink(url: string | null | undefined): string | null {
	if (!url) return null;
	try {
		const { protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:" ? url : null;
	} catch {
		return null;
	}
}

/** `g0.expr` of a Prometheus graph link and the base URL before `/graph`, or null when it carries none. */
export function graphExpr(
	sourceUrl: string | null | undefined,
): { expr: string; base: string } | null {
	const link = httpLink(sourceUrl);
	if (!link) return null;
	const url = new URL(link);
	const expr = url.searchParams.get("g0.expr");
	if (!expr?.trim()) return null;
	const at = link.indexOf("/graph");
	return { expr, base: at >= 0 ? link.slice(0, at) : url.origin };
}
