// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

export interface FireInput {
	labels: Record<string, string>;
	annotations?: Record<string, string>;
	startsAt?: string;
	generatorURL?: string;
	state?: "active" | "suppressed" | "unprocessed";
}

export interface ListedAlert {
	labels: Record<string, string>;
	annotations: Record<string, string>;
	startsAt: string;
	endsAt: string;
	generatorURL: string;
	fingerprint: string;
	state: "active" | "suppressed" | "unprocessed";
}

export interface FakeAlertmanager {
	url: string;
	alerts(): ListedAlert[];
	fire(input: FireInput): ListedAlert;
	clear(fingerprint: string): boolean;
	restart(at?: Date): void;
	setStartedAt(at: Date): void;
	post(
		webhookUrl: string,
		token: string,
		opts?: { only?: string[] },
	): Promise<Response>;
	close(): Promise<void>;
}

export function fingerprintOf(labels: Record<string, string>): string;

export function startFakeAlertmanager(options?: {
	port?: number;
	host?: string;
	startedAt?: Date;
	receiver?: string;
}): Promise<FakeAlertmanager>;
