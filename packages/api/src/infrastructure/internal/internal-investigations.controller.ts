import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Public } from '../../core/auth/public.decorator.js';
import { InvestigationsService } from '../../modules/investigations/investigations.service.js';
import {
  InternalInvestigationResultDto,
  UpdateInvestigationStatusDto,
} from './dto/index.js';
import { InternalGuard } from './guards/internal.guard.js';

/**
 * Internal API for investigation operations.
 * Used by the Python worker to update investigation status and write results.
 * Protected by InternalGuard (requires X-Internal-Secret header).
 * @Public() skips AuthGuard — InternalGuard handles auth via X-Internal-Secret.
 */
@Public()
@ApiExcludeController()
@Controller('internal/investigations')
@UseGuards(InternalGuard)
export class InternalInvestigationsController {
  constructor(
    private readonly investigationsService: InvestigationsService,
  ) { }

  /**
   * Update investigation status (real-time updates during execution)
   * Called when job starts (running), fails, or is cancelled
   */
  @Patch(':id/status')
  @HttpCode(HttpStatus.OK)
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateInvestigationStatusDto,
  ) {
    const investigation = await this.investigationsService.updateStatusInternal(
      id,
      dto.status,
      dto.startedAt ? new Date(dto.startedAt) : undefined,
      dto.error,
      dto.langGraphThreadId,
    );

    if (!investigation) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }

    return investigation;
  }

  /**
   * Write full investigation result (atomic write of all data)
   * Called when worker completes analysis - writes investigation, agents, tools, recommendations
   */
  @Post(':id/result')
  @HttpCode(HttpStatus.OK)
  async writeResult(
    @Param('id') id: string,
    @Body() dto: InternalInvestigationResultDto,
  ) {
    const investigation = await this.investigationsService.writeResultWithRelations(
      id,
      dto,
    );

    if (!investigation) {
      throw new NotFoundException(`Investigation ${id} not found`);
    }

    return investigation;
  }
}
