#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The published `prismalens` npm package's bin (#717); `pl --launcher-help` says what it does.
import { main } from "./launcher.mjs";

await main();
