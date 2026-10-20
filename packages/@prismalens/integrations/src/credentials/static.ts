// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

/** Credential kinds that are pasted once and sent as they are (#848). */
import type { CredentialKind } from "../port/credential-kind.js";

const basicValue = (username: string, password: string) =>
	Buffer.from(`${username}:${password}`).toString("base64");

export const none: CredentialKind<"none"> = {
	kind: "none",
	enrol: "none",
	secrets: () => [],
	authorize: async () => ({ headers: {} }),
};

export const bearer: CredentialKind<"bearer"> = {
	kind: "bearer",
	enrol: "paste",
	secrets: (c) => [c.token],
	authorize: async (c) => ({ headers: { Authorization: `Bearer ${c.token}` } }),
};

export const basic: CredentialKind<"basic"> = {
	kind: "basic",
	enrol: "paste",
	secrets: (c) => [c.password, basicValue(c.username, c.password)],
	authorize: async (c) => ({
		headers: { Authorization: `Basic ${basicValue(c.username, c.password)}` },
	}),
};

export const header: CredentialKind<"header"> = {
	kind: "header",
	enrol: "paste",
	secrets: (c) => [c.value],
	authorize: async (c) => ({ headers: { [c.name]: c.value } }),
};

export const mtls: CredentialKind<"mtls"> = {
	kind: "mtls",
	enrol: "paste",
	secrets: (c) => [c.key],
	authorize: async (c) => ({
		headers: {},
		tls: { cert: c.cert, key: c.key, ...(c.ca ? { ca: c.ca } : {}) },
	}),
};
