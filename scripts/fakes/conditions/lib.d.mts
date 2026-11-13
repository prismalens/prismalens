// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export type Api = (
	path: string,
	init?: { method?: string; body?: unknown; ok?: number[] },
	// biome-ignore lint/suspicious/noExplicitAny: the API answers untyped JSON to scripts
) => Promise<any>;

export function arg(name: string): string | undefined;
export function sleep(ms: number): Promise<void>;
export function stateDir(name: string): string;
export function connect(url: string): Promise<{ api: Api; cookie: string }>;
export function startThread(
	api: Api,
	session: string,
	title: string,
	subject?: Record<string, unknown>,
): Promise<string>;
export function waitFor(
	api: Api,
	id: string,
	// biome-ignore lint/suspicious/noExplicitAny: a run row as the API answers it
	done: (run: any) => boolean,
	ms?: number,
	what?: string,
	// biome-ignore lint/suspicious/noExplicitAny: a run row as the API answers it
): Promise<any>;
export const ACTIVE: string[];
// biome-ignore lint/suspicious/noExplicitAny: canonical events as stored
export function events(api: Api, id: string): Promise<any[]>;
