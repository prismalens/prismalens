// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { defineSurface } from "@/components/kit/actions";

declare module "@/components/kit/actions" {
	interface SurfaceObjects {
		"child.card": "child";
	}
}

export const childCard = defineSurface({
	id: "child.card",
	label: "Child thread actions",
	menus: { context: ["child.open", "child.copyLink", "child.stop"] },
	states: { default: "child-cards", phone: "child-cards" },
	marks: ["status", "startedBy"],
});
