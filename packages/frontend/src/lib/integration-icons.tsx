// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Link2 } from "lucide-react";
import { GithubIcon } from "@/components/icons/github-icon";

export function getIntegrationIcon(templateId: string, className = "h-5 w-5") {
	if (templateId.startsWith("github"))
		return <GithubIcon className={className} />;
	return <Link2 className={className} />;
}
