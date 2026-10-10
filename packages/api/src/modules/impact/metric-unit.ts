// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type { MetricUnit } from "@prismalens/contracts/schemas";
import { parser } from "@prometheus-io/lezer-promql";

type SyntaxNode = ReturnType<typeof parser.parse>["topNode"];
/** A bare number: it carries no unit and leaves the other side's alone. */
type Unit = MetricUnit | "scalar" | null;

const SUFFIX: [string, MetricUnit][] = [
	["_seconds", "s"],
	["_bytes", "bytes"],
	["_ratio", "ratio"],
	["_percent", "percent"],
];
const PER_SECOND: Partial<Record<MetricUnit, MetricUnit>> = {
	count: "count/s",
	bytes: "bytes/s",
};
/** Functions whose result has the unit of their (only) vector argument. */
const SAME_UNIT = new Set([
	"abs",
	"ceil",
	"floor",
	"round",
	"clamp",
	"clamp_max",
	"clamp_min",
	"sort",
	"sort_desc",
	"label_replace",
	"label_join",
	"increase",
	"delta",
	"avg_over_time",
	"min_over_time",
	"max_over_time",
	"last_over_time",
	"quantile_over_time",
	"stddev_over_time",
	"sum_over_time",
]);
const SAME_UNIT_AGG = new Set([
	"sum",
	"avg",
	"min",
	"max",
	"quantile",
	"topk",
	"bottomk",
	"stddev",
]);

/** The unit a metric name declares, per the Prometheus naming conventions; `_total` and `_count` are counts. */
export function nameUnit(name: string): MetricUnit | null {
	const base = name.replace(/_(total|bucket|sum)$/, "");
	for (const [suffix, unit] of SUFFIX) if (base.endsWith(suffix)) return unit;
	return /_(total|count)$/.test(name) ? "count" : null;
}

function children(node: SyntaxNode): SyntaxNode[] {
	const out: SyntaxNode[] = [];
	for (let c = node.firstChild; c; c = c.nextSibling) out.push(c);
	return out;
}

function find(node: SyntaxNode, name: string): SyntaxNode | null {
	if (node.name === name) return node;
	for (const c of children(node)) {
		const hit = find(c, name);
		if (hit) return hit;
	}
	return null;
}

function hasError(node: SyntaxNode): boolean {
	return node.type.isError || children(node).some(hasError);
}

function vectorArg(body: SyntaxNode | undefined, expr: string): Unit {
	const units = (body ? children(body) : [])
		.map((c) => unitOf(c, expr))
		.filter((u) => u !== "scalar");
	return units.length === 1 ? units[0] : null;
}

function unitOf(node: SyntaxNode, expr: string): Unit {
	const kids = children(node);
	switch (node.name) {
		case "ParenExpr":
		case "MatrixSelector":
		case "SubqueryExpr":
		case "OffsetExpr":
		case "StepInvariantExpr":
			return kids[0] ? unitOf(kids[0], expr) : null;
		case "UnaryExpr":
			return kids.length ? unitOf(kids[kids.length - 1], expr) : null;
		case "NumberDurationLiteral":
			return "scalar";
		case "VectorSelector": {
			const id = kids.find((c) => c.name === "Identifier");
			return id ? nameUnit(expr.slice(id.from, id.to)) : null;
		}
		case "FunctionCall": {
			const fn = kids.find((c) => c.name === "FunctionIdentifier");
			const body = kids.find((c) => c.name === "FunctionCallBody");
			const name = fn ? expr.slice(fn.from, fn.to) : "";
			if (name === "histogram_quantile") {
				// The quantile is in the buckets' `le` unit: `*_seconds_bucket` gives seconds.
				const id = body && find(body, "Identifier");
				return id ? nameUnit(expr.slice(id.from, id.to)) : null;
			}
			const arg = vectorArg(body, expr);
			if (name === "rate" || name === "irate")
				return arg && arg !== "scalar" ? (PER_SECOND[arg] ?? null) : null;
			return SAME_UNIT.has(name) ? arg : null;
		}
		case "AggregateExpr": {
			const op = kids.find((c) => c.name === "AggregateOp");
			const name = op ? expr.slice(op.from, op.to).toLowerCase() : "";
			if (name === "count" || name === "count_values") return "count";
			const body = kids.find((c) => c.name === "FunctionCallBody");
			return SAME_UNIT_AGG.has(name) ? vectorArg(body, expr) : null;
		}
		case "BinaryExpr":
			return binaryUnit(kids, expr);
		default:
			return null;
	}
}

function binaryUnit(kids: SyntaxNode[], expr: string): Unit {
	const [left, opNode] = kids;
	const right = kids[kids.length - 1];
	if (!left || !opNode || right === opNode) return null;
	const a = unitOf(left, expr);
	const b = unitOf(right, expr);
	const vector = a === "scalar" ? b : a;
	switch (opNode.name) {
		case "Eql":
		case "Neq":
		case "Gtr":
		case "Lss":
		case "Gte":
		case "Lte":
		case "And":
		case "Unless":
			return vector;
		case "Add":
		case "Sub":
		case "Or":
			return a === "scalar" || b === "scalar" || a === b ? vector : null;
		case "Mul":
			// `x_ratio * 100` is the one scaling with a known unit.
			return (a === "ratio" && numberIs(right, expr, 100)) ||
				(b === "ratio" && numberIs(left, expr, 100))
				? "percent"
				: null;
		case "Div":
			return a && a !== "scalar" && a === b ? "ratio" : null;
		default:
			return null;
	}
}

function numberIs(node: SyntaxNode, expr: string, value: number): boolean {
	return (
		node.name === "NumberDurationLiteral" &&
		Number(expr.slice(node.from, node.to)) === value
	);
}

/** The charted query's unit, null when its metric names do not settle one (#811). */
export function metricUnit(query: string): MetricUnit | null {
	const top = parser.parse(query).topNode;
	const root = top.firstChild;
	if (!root || hasError(top)) return null;
	const unit = unitOf(root, query);
	return unit === "scalar" ? null : unit;
}
