import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../auth/public.decorator';
import { ok } from '../common/http/standard-response';
import { OtpService } from './otp.service';
import { SendOtpDto } from './dto/send-otp.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';

@Controller('otp')
@Public()
export class OtpController {
  constructor(private readonly otp: OtpService) {}

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('send')
  async send(@Body() dto: SendOtpDto) {
    const data = await this.otp.sendOtp(dto.mobile);
    return ok(data);
  }

  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('verify')
  async verify(@Body() dto: VerifyOtpDto) {
    const data = await this.otp.verifyAndSignIn(dto.mobile, dto.otp.trim());
    return ok(data);
  }
}
