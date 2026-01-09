import { Controller, Get, UseGuards } from "@nestjs/common";
import { ApiExcludeController } from "@nestjs/swagger";
import { SettingsService } from "../../core/settings/settings.service.js";
import { InternalGuard } from "./guards/internal.guard.js";

@ApiExcludeController()
@Controller("internal/settings")
@UseGuards(InternalGuard)
export class InternalSettingsController {
	constructor(private readonly settingsService: SettingsService) {}

	@Get("llm-config")
	async getActiveLlmConfig() {
		return this.settingsService.getActiveLlmConfigInternal();
	}
}
