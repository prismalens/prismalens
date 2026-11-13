// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The app loads the registry and the markdown renderer after a page's first content
// (#1101 category 12); a unit test renders in one pass, so it starts with both.
// The menus' Radix half too: warm in the module cache, a test's act sees its lazy load resolve.
import "@/components/kit/MenuImpl";
import "@/components/kit/SurfaceMenus";
import * as registry from "@/components/kit/registry";
import { primeRegistry } from "@/components/kit/registry-load";
import { primeMarkdown } from "@/lib/markdown-render";
import * as markdown from "@/lib/markdown-render-impl";

primeRegistry(registry);
primeMarkdown(markdown);
