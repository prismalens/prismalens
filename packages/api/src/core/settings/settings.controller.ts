import {
  Controller,
  Get,
  Put,
  Delete,
  Body,
  Param,
  UseGuards,
  HttpStatus,
  HttpCode,
} from '@nestjs/common';
import { SettingsService } from './settings.service.js';
import { UpdateLlmDto, SetActiveProviderDto } from './dto/update-llm.dto.js';

@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get('llm')
  async getAllLlmConfigs() {
    return this.settingsService.getAllLlmConfigs();
  }

  // NOTE: This route MUST come before 'llm/:provider' to avoid route shadowing
  @Put('llm/active')
  async setActiveProvider(@Body() dto: SetActiveProviderDto) {
    return this.settingsService.setActiveProvider(dto.provider);
  }

  @Get('llm/:provider')
  async getLlmConfig(@Param('provider') provider: string) {
    return this.settingsService.getLlmConfig(provider);
  }

  @Put('llm/:provider')
  async updateLlmConfig(
    @Param('provider') provider: string,
    @Body() dto: UpdateLlmDto,
  ) {
    return this.settingsService.updateLlmConfig(provider, dto);
  }

  @Delete('llm/:provider')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteLlmConfig(@Param('provider') provider: string) {
    return this.settingsService.deleteLlmConfig(provider);
  }
}
