// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 Sumit Patel

import { Module } from "@nestjs/common";
import { LiveController } from "./live.controller.js";

@Module({ controllers: [LiveController] })
export class LiveModule {}
