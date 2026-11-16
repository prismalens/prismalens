// @vitest-environment happy-dom
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { beforeEach, describe, expect, it } from "vitest";
import { lastSubject, rememberSubject, subjectMenu } from "./last-subject";

const projects = [
	{ id: "p1", name: "acme/shop" },
	{ id: "p2", name: "acme/api" },
];
const services = [
	{ id: "s1", name: "Checkout API" },
	{ id: "s2", name: "Payments" },
];

beforeEach(() => localStorage.clear());

describe("subjectMenu", () => {
	it("puts the last-used service first and removes it from the services group", () => {
		expect(subjectMenu(projects, services, "service:s2")).toEqual({
			first: { value: "service:s2", name: "Payments" },
			projects,
			services: [{ id: "s1", name: "Checkout API" }],
		});
	});

	it("puts the last-used project first and removes it from the projects group", () => {
		expect(subjectMenu(projects, services, "project:p2")).toEqual({
			first: { value: "project:p2", name: "acme/api" },
			projects: [{ id: "p1", name: "acme/shop" }],
			services,
		});
	});

	it("keeps the plain order when nothing was used or the used one is gone", () => {
		expect(subjectMenu(projects, services, null)).toEqual({
			first: null,
			projects,
			services,
		});
		expect(subjectMenu(projects, services, "service:gone")).toEqual({
			first: null,
			projects,
			services,
		});
	});
});

describe("rememberSubject", () => {
	it("stores a project or service and ignores a send with no subject", () => {
		rememberSubject({ kind: "service", serviceId: "s1" });
		expect(lastSubject()).toBe("service:s1");
		rememberSubject({ kind: "none" });
		expect(lastSubject()).toBe("service:s1");
		rememberSubject({ kind: "project", repositoryId: "p2" });
		expect(lastSubject()).toBe("project:p2");
	});
});
