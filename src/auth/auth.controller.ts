import { Body, Controller, Post } from '@nestjs/common';
import { Public } from './public.decorator';
import { AuthService } from './auth.service';
import { RequestOtpDto } from './dto/request-otp.dto';
import { AdminOtpSignupDto } from './dto/admin-otp-signup.dto';
import { AdminOtpLoginDto } from './dto/admin-otp-login.dto';
import { SuperadminOtpSignupDto } from './dto/superadmin-otp-signup.dto';
import { CustomerOtpSignupDto } from './dto/customer-otp-signup.dto';
import { CustomerOtpLoginDto } from './dto/customer-otp-login.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Mobile: request OTP to verify phone */
  @Public()
  @Post('otp/request')
  requestOtp(@Body() dto: RequestOtpDto) {
    return this.auth.requestOtp({ phone: dto.phone, countryCode: dto.countryCode });
  }

  /** Management mobile onboarding: phone + OTP + password -> admin session */
  @Public()
  @Post('admin/otp/signup')
  signupAdminWithOtp(@Body() dto: AdminOtpSignupDto) {
    return this.auth.signupAdminWithOtp({
      phone: dto.phone,
      countryCode: dto.countryCode,
      code: dto.code,
      fullName: dto.fullName ?? null,
      email: dto.email ?? null,
    });
  }

  /** Management login: phone + OTP only (no PIN/password). */
  @Public()
  @Post('admin/otp/login')
  loginAdminWithOtp(@Body() dto: AdminOtpLoginDto) {
    return this.auth.loginAdminWithOtp({
      phone: dto.phone,
      countryCode: dto.countryCode,
      code: dto.code,
    });
  }

  /**
   * Web-only onboarding: create the SINGLE superadmin user (phone + OTP + basic details).
   * (Server does not enforce "web-only" — clients should hide this on mobile.)
   */
  @Public()
  @Post('superadmin/otp/signup')
  signupSuperadminWithOtp(@Body() dto: SuperadminOtpSignupDto) {
    return this.auth.signupSuperadminWithOtp({
      phone: dto.phone,
      countryCode: dto.countryCode,
      code: dto.code,
      fullName: dto.fullName,
      email: dto.email,
    });
  }

  /** Customer mobile onboarding: phone + OTP + basic details -> customer session */
  @Public()
  @Post('customer/otp/signup')
  signupCustomerWithOtp(@Body() dto: CustomerOtpSignupDto) {
    return this.auth.signupCustomerWithOtp({
      phone: dto.phone,
      countryCode: dto.countryCode,
      code: dto.code,
      fullName: dto.fullName ?? null,
      email: dto.email ?? null,
    });
  }

  /** Customer login: phone + OTP only (no PIN/password). */
  @Public()
  @Post('customer/otp/login')
  loginCustomerWithOtp(@Body() dto: CustomerOtpLoginDto) {
    return this.auth.loginCustomerWithOtp({
      phone: dto.phone,
      countryCode: dto.countryCode,
      code: dto.code,
    });
  }
}
