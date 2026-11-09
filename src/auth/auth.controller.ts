import { Body, Controller, Get, HttpStatus, Logger, Post, Query, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { passwordByteLength } from '../common/helpers/password.js';
import { toRecord } from '../common/helpers/record.js';
import { SessionService } from '../common/session/session.service.js';
import { FormValidationService } from '../common/validation/form-validation.service.js';
import { AuthService, EmailAlreadyRegisteredError } from './auth.service.js';
import { LoginDto } from './dto/login.dto.js';
import { RegisterDto } from './dto/register.dto.js';

interface LoginFormState {
  errors: Record<string, string>;
  values: { email: string };
  formError: string | null;
  notice: string | null;
}

interface RegisterFormState {
  errors: Record<string, string>;
  values: { name: string; email: string; businessName: string };
  formError: string | null;
}

@Controller()
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private readonly authService: AuthService,
    private readonly sessionService: SessionService,
    private readonly formValidation: FormValidationService,
  ) {}

  @Get('login')
  showLogin(
    @Req() request: Request,
    @Res() response: Response,
    @Query('status') status?: string,
  ): void {
    if (this.sessionService.isAuthenticated(request)) {
      response.redirect(HttpStatus.SEE_OTHER, '/dashboard');
      return;
    }

    this.renderLogin(response, HttpStatus.OK, {
      errors: {},
      values: { email: '' },
      formError: null,
      notice: status === 'logged-out' ? 'Anda telah keluar dari akun ini.' : null,
    });
  }

  @Post('login')
  async login(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.formValidation.validate(LoginDto, toRecord(body));

    if (!result.valid) {
      this.renderLogin(response, HttpStatus.UNPROCESSABLE_ENTITY, {
        errors: result.errors,
        values: { email: result.data.email },
        formError: null,
        notice: null,
      });
      return;
    }

    if (passwordByteLength(result.data.password) > 72) {
      this.renderLogin(response, HttpStatus.UNPROCESSABLE_ENTITY, {
        errors: {
          password: 'Kata sandi terlalu panjang. Maksimal 72 byte UTF-8, bukan 72 karakter.',
        },
        values: { email: result.data.email },
        formError: null,
        notice: null,
      });
      return;
    }

    const login = await this.authService.authenticate(result.data.email, result.data.password);

    switch (login.status) {
      case 'invalid':
        this.logger.warn(`Login gagal: kredensial tidak valid (ip=${request.ip ?? '-'})`);
        this.renderLogin(response, HttpStatus.UNPROCESSABLE_ENTITY, {
          errors: {},
          values: { email: result.data.email },
          formError: 'Email atau kata sandi salah.',
          notice: null,
        });
        return;
      case 'inactive':
        this.logger.warn(`Login gagal: akun tidak aktif (ip=${request.ip ?? '-'})`);
        this.renderLogin(response, HttpStatus.FORBIDDEN, {
          errors: {},
          values: { email: result.data.email },
          formError: 'Akun Anda tidak aktif. Hubungi administrator.',
          notice: null,
        });
        return;
      case 'no-business':
        this.logger.warn(`Login gagal: akun tanpa bisnis (ip=${request.ip ?? '-'})`);
        this.renderLogin(response, HttpStatus.FORBIDDEN, {
          errors: {},
          values: { email: result.data.email },
          formError: 'Akun Anda belum terhubung ke bisnis. Hubungi administrator.',
          notice: null,
        });
        return;
      case 'success':
        await this.sessionService.establish(request, login.userId, login.businessId);
        response.redirect(HttpStatus.SEE_OTHER, '/dashboard');
        return;
    }
  }

  @Get('register')
  showRegister(@Req() request: Request, @Res() response: Response): void {
    if (this.sessionService.isAuthenticated(request)) {
      response.redirect(HttpStatus.SEE_OTHER, '/dashboard');
      return;
    }

    this.renderRegister(response, HttpStatus.OK, {
      errors: {},
      values: { name: '', email: '', businessName: '' },
      formError: null,
    });
  }

  @Post('register')
  async register(
    @Body() body: unknown,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const result = await this.formValidation.validate(RegisterDto, toRecord(body));
    const password = typeof result.data.password === 'string' ? result.data.password : '';
    const confirmation =
      typeof result.data.confirmPassword === 'string' ? result.data.confirmPassword : '';

    if (password.length > 0 && confirmation.length > 0 && password !== confirmation) {
      result.errors.confirmPassword = 'Konfirmasi kata sandi tidak cocok.';
    }

    if (Object.keys(result.errors).length > 0) {
      this.renderRegister(response, HttpStatus.UNPROCESSABLE_ENTITY, {
        errors: result.errors,
        values: {
          name: result.data.name,
          email: result.data.email,
          businessName: result.data.businessName,
        },
        formError: null,
      });
      return;
    }

    if (passwordByteLength(password) > 72 || passwordByteLength(confirmation) > 72) {
      this.renderRegister(response, HttpStatus.UNPROCESSABLE_ENTITY, {
        errors: {
          password: 'Kata sandi terlalu panjang. Maksimal 72 byte UTF-8, bukan 72 karakter.',
        },
        values: {
          name: result.data.name,
          email: result.data.email,
          businessName: result.data.businessName,
        },
        formError: null,
      });
      return;
    }

    try {
      const created = await this.authService.register({
        name: result.data.name,
        email: result.data.email,
        password: result.data.password,
        businessName: result.data.businessName,
      });

      await this.sessionService.establish(request, created.userId, created.businessId);
      this.sessionService.setFlash(
        request,
        'success',
        'Akun dan bisnis berhasil dibuat. Selamat datang di Rental Reminder.',
      );
      await this.sessionService.save(request);

      response.redirect(HttpStatus.SEE_OTHER, '/dashboard');
    } catch (error) {
      if (error instanceof EmailAlreadyRegisteredError) {
        this.renderRegister(response, HttpStatus.UNPROCESSABLE_ENTITY, {
          errors: { email: 'Email sudah terdaftar. Silakan masuk dengan email tersebut.' },
          values: {
            name: result.data.name,
            email: result.data.email,
            businessName: result.data.businessName,
          },
          formError: null,
        });
        return;
      }
      throw error;
    }
  }

  @Post('logout')
  async logout(@Req() request: Request, @Res() response: Response): Promise<void> {
    await this.sessionService.terminate(request, response);
    response.redirect(HttpStatus.SEE_OTHER, '/login?status=logged-out');
  }

  private renderLogin(response: Response, status: number, state: LoginFormState): void {
    response.status(status).render('auth/login', {
      pageTitle: 'Masuk',
      pageSubtitle: 'Masuk ke akun Rental Reminder Anda',
      activeNav: '',
      ...state,
    });
  }

  private renderRegister(response: Response, status: number, state: RegisterFormState): void {
    response.status(status).render('auth/register', {
      pageTitle: 'Daftar',
      pageSubtitle: 'Buat akun dan bisnis penyewaan Anda',
      activeNav: '',
      ...state,
    });
  }
}
