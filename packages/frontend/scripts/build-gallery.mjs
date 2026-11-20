// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// `vite build` with the design gallery, so `pnpm sim judge-evidence` shoots the build a sim
// serves; a turbo task (build:gallery) so a second checkout restores it from the cache (#1101).
import { execFileSync } from "node:child_process";

execFileSync(process.execPath, ["node_modules/vite/bin/vite.js", "build"], {
	stdio: "inherit",
	windowsHide: true,
	env: { ...process.env, VITE_DESIGN_GALLERY: "1" },
});
