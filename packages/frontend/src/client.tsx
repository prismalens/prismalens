// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { ConnectionError } from "@/lib/api/orpc-client";

// Start's default entry, plus one rule: a first load that cannot reach the server shows the
// error page by design (`throwOnError` in `router.tsx`), so that caught error is not logged.
startTransition(() => {
	hydrateRoot(
		document,
		<StrictMode>
			<StartClient />
		</StrictMode>,
		{
			onCaughtError: (error) => {
				if (error instanceof ConnectionError) return;
				console.error(error);
			},
		},
	);
});
