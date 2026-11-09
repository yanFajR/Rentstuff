import { Body, Controller, Get, HttpStatus, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthenticationContext } from '../common/auth/authenticated-request.js';
import { CurrentAuth } from '../common/auth/current-auth.decorator.js';
import { TenantAuthGuard } from '../common/auth/tenant-auth.guard.js';
import { toRecord } from '../common/helpers/record.js';
import { SessionService } from '../common/session/session.service.js';
import { FormValidationService } from '../common/validation/form-validation.service.js';
import { BusinessService } from './business.service.js';
import { UpdateBusinessDto } from './dto/update-business.dto.js';

interface BusinessFormValues {
  businessName: string;
  ownerName: string;
  whatsappNumber: string;
  address: string;
  description: string;
}

function toFormValues(auth: AuthenticationContext): BusinessFormValues {
  return {
    businessName: auth.business.name,
    ownerName: auth.user.name,
    whatsappNumber: auth.business.whatsappNumber ?? '',
    address: auth.business.address ?? '',
    description: auth.business.description ?? '',
  };
}

@Controller('settings')
@UseGuards(TenantAuthGuard)
export class BusinessController {
  constructor(
    private readonly businessService: BusinessService,
    private readonly formValidation: FormValidationService,
    private readonly sessionService: SessionService,
  ) {}

  @Get()
  showSettings(@CurrentAuth() auth: AuthenticationContext, @Res() response: Response): void {
    response.render('settings/index', {
      pageTitle: 'Pengaturan',
      pageSubtitle: 'Profil bisnis dan informasi akun',
      activeNav: 'settings',
      business: auth.business,
      account: { name: auth.user.name, email: auth.user.email, role: auth.role },
      errors: {},
      values: toFormValues(auth),
    });
  }

  @Post('business')
  async updateBusiness(
    @Body() body: unknown,
    @CurrentAuth() auth: AuthenticationContext,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.formValidation.validate(UpdateBusinessDto, toRecord(body));

    if (!result.valid) {
      this.renderSettings(response, auth, HttpStatus.UNPROCESSABLE_ENTITY, result.errors, {
        businessName: result.data.businessName,
        ownerName: result.data.ownerName,
        whatsappNumber: result.data.whatsappNumber ?? '',
        address: result.data.address ?? '',
        description: result.data.description ?? '',
      });
      return;
    }

    await this.businessService.updateProfile({
      businessId: auth.businessId,
      userId: auth.userId,
      businessName: result.data.businessName,
      ownerName: result.data.ownerName,
      whatsappNumber: result.data.whatsappNumber,
      address: result.data.address,
      description: result.data.description,
    });

    this.sessionService.setFlash(request, 'success', 'Profil bisnis berhasil disimpan.');
    await this.sessionService.save(request);

    response.redirect(HttpStatus.SEE_OTHER, '/settings');
  }

  private renderSettings(
    response: Response,
    auth: AuthenticationContext,
    status: number,
    errors: Record<string, string>,
    values: BusinessFormValues,
  ): void {
    response.status(status).render('settings/index', {
      pageTitle: 'Pengaturan',
      pageSubtitle: 'Profil bisnis dan informasi akun',
      activeNav: 'settings',
      business: auth.business,
      account: { name: auth.user.name, email: auth.user.email, role: auth.role },
      errors,
      values,
    });
  }
}
