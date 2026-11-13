// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export { type Closed, defineClosed } from "./closed.ts";
export { type Collected, collect } from "./collect.ts";
export {
	formatProblems,
	GENERIC_GUARDS,
	type Problem,
	populated,
	refsResolve,
	runGuards,
	unique,
} from "./guards.ts";
export {
	type AnyKind,
	type Define,
	type DefineFn,
	defineKind,
	type Entry,
	entry,
	type Guard,
	type GuardCtx,
	guard,
	type Kind,
	makeDefine,
	type Scaffold,
	type Schema,
} from "./kind.ts";
export {
	fieldAt,
	type Literal,
	type Manifest,
	type ManifestEntry,
	type ManifestKind,
	type ManifestUse,
	stringsIn,
} from "./manifest.ts";
export {
	blocksIn,
	brief,
	type Cell,
	type Condition,
	conditionGrid,
	conditions,
	envMissing,
	g1,
	g2,
	g3,
	g4Facts,
	g5,
	g6,
	judgePack,
	matrix,
	renderBar,
	replaceBlocks,
	SLOT,
	scoreCheck,
	staleBlocks,
} from "./quality.ts";
