// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The contract with its schemas stripped, for the browser's link: routes and methods only, so a
// page bundles the schemas it validates and no others (#1101 category 12).
import { writeFileSync } from "node:fs";
import { minifyContractRouter } from "@orpc/contract";
import { contract } from "../dist/index.js";

/** What the link reads to call a route; summaries and tags stay in the OpenAPI document. */
const KEEP = new Set([
	"method",
	"path",
	"inputStructure",
	"outputStructure",
	"successStatus",
]);
// `meta` stays, empty: the link only knows a procedure by its errorMap, route and meta keys.
const lean = (key, value) =>
	key === "route"
		? Object.fromEntries(Object.entries(value).filter(([k]) => KEEP.has(k)))
		: key === "meta"
			? {}
			: value;

writeFileSync(
	new URL("../dist/contract.min.json", import.meta.url),
	`${JSON.stringify(minifyContractRouter(contract), lean)}\n`,
);
