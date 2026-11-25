// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { runAppCommand } from "@/lib/app-commands";

/** `/search` is not a page: it goes Home and opens the Search palette there. */
export function SearchAddress() {
	const navigate = useNavigate();
	useEffect(() => {
		void navigate({ to: "/", replace: true }).then(() =>
			runAppCommand("search"),
		);
	}, [navigate]);
	return null;
}
