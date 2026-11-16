// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

// The thread page's runtime schemas, in a chunk of their own: zod is ~40 KB of a first paint
// the page does not need them for. Load through `loadThreadSchemas` (#1130).
export {
	CommitFrameSchema,
	DoneFrameSchema,
	LiveFrameSchema,
	ModelReportSchema,
	ResetFrameSchema,
} from "@prismalens/contracts";
