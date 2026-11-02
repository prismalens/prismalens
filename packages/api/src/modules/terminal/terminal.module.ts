// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { TerminalController } from "./terminal.controller.js";
import { TerminalService } from "./terminal.service.js";

/** The integrated terminal (#931): host-only shells over one socket. */
@Module({
	controllers: [TerminalController],
	providers: [TerminalService],
	exports: [TerminalService],
})
export class TerminalModule {}
