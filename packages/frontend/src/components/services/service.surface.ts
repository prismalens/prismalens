// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

/** The service page's actions; its card places the same list (#1127). */
const ENTRIES = [
	"service.open",
	"service.ask",
	"service.edit",
	"-",
	"service.link",
	"service.delete",
] as const;

/** A service's card: ⋯ and right-click list the same rows (ListCard draws both). */
export const serviceRow = defineSurface({
	id: "service.row",
	label: "Service actions",
	menus: { more: ENTRIES },
	states: { default: "app-services", phone: "app-services" },
	marks: ["health", "code", "alert"],
});

/** A service page's band: right-click, Shift+F10 and the Menu key; Edit and Delete are its buttons too. */
export const serviceHeader = defineSurface({
	id: "service.header",
	object: "service",
	label: "Service actions",
	menus: { context: ENTRIES },
	states: { default: "app-services", phone: "app-services" },
	marks: [],
});
