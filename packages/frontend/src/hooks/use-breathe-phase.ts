// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useEffect } from "react";

const BREATHE_MS = 2400;

/**
 * Every live thing breathes on one clock (look ruling §3.1). The shell sets
 * the shared phase once, and a breathing animation that starts later is
 * pinned to the document timeline so it lands in step with the rest.
 */
export function useBreathePhase() {
	useEffect(() => {
		document.documentElement.style.setProperty(
			"--breathe-phase",
			`${-(performance.now() % BREATHE_MS)}ms`,
		);
		const pin = (e: AnimationEvent) => {
			if (!e.animationName.includes("breathe")) return;
			if (!(e.target instanceof Element)) return;
			for (const a of e.target.getAnimations({ subtree: true })) {
				if (a instanceof CSSAnimation && a.animationName === e.animationName)
					a.startTime = 0;
			}
		};
		document.addEventListener("animationstart", pin, true);
		return () => document.removeEventListener("animationstart", pin, true);
	}, []);
}
