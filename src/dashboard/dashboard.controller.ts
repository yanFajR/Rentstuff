import { Controller, Get, HttpStatus, Redirect, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';

import type { AuthenticationContext } from '../common/auth/authenticated-request.js';
import { CurrentAuth } from '../common/auth/current-auth.decorator.js';
import { TenantAuthGuard } from '../common/auth/tenant-auth.guard.js';
import { DashboardService } from './dashboard.service.js';

@Controller()
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get()
  @Redirect('/dashboard', HttpStatus.FOUND)
  redirectToDashboard(): void {}

  @Get('dashboard')
  @UseGuards(TenantAuthGuard)
  async showDashboard(
    @CurrentAuth() auth: AuthenticationContext,
    @Res() response: Response,
  ): Promise<void> {
    const overview = await this.dashboardService.getOverview(auth.businessId);

    response.render('dashboard/index', {
      pageTitle: 'Ringkasan',
      pageSubtitle: 'Ringkasan operasional bisnis penyewaan Anda',
      activeNav: 'dashboard',
      overview,
    });
  }
}
