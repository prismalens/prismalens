// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import type {
	PrCheckRun,
	PrChecks,
	PrHostTerms,
	PrState,
} from "@prismalens/contracts";
import type { FakeRoute } from "../../__fixtures__/fake-host.js";
import type { CodeHostKind } from "../adapter.js";
import { githubContract } from "./github.contract.js";
import { gitlabContract } from "./gitlab.contract.js";

export interface ExpectedActivityItem {
	source: string;
	id: number;
	login: string;
}

export interface ExpectedReviewThread {
	id: string;
	resolved: boolean;
}

export interface ExpectedCheckLog {
	step: string | null;
	unavailable: string | null;
	lastLine: string;
}

export interface ExpectedRead {
	state: PrState;
	headSha: string | null;
	checks: PrChecks;
}

export interface ContractFixture {
	readonly kind: CodeHostKind;
	readonly host: string;
	readonly apiBase: string;
	readonly repo: string;
	readonly number: number;
	readonly branch: string;
	readonly webUrl: string;
	readonly parsePath: { repoParts: string[]; number: string | undefined };
	readonly otherHostPathSegments: string[];
	readonly routes: () => Record<string, FakeRoute>;
	readonly read: ExpectedRead;
	readonly secondReadEtags: (string | undefined)[];
	readonly activity: ExpectedActivityItem[];
	readonly reviewThreads: ExpectedReviewThread[];
	readonly checkRun: PrCheckRun;
	readonly statusRun?: PrCheckRun;
	readonly checkLog: ExpectedCheckLog;
	readonly findByBranchUrl: string;
	readonly terms: PrHostTerms;
}

export const CONTRACT_FIXTURES: Record<CodeHostKind, ContractFixture> = {
	github: githubContract,
	gitlab: gitlabContract,
};
