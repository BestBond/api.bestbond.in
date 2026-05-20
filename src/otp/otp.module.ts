import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule } from '@nestjs/config';
import { UsersModule } from '../users/users.module';
import { RbacModule } from '../rbac/rbac.module';
import { createJwtRegisterAsync } from '../auth/jwt-module.factory';
import { Msg91Service } from './msg91.service';
import { OtpService } from './otp.service';
import { OtpController } from './otp.controller';

@Module({
  imports: [
    ConfigModule,
    UsersModule,
    RbacModule,
    JwtModule.registerAsync(createJwtRegisterAsync()),
  ],
  controllers: [OtpController],
  providers: [Msg91Service, OtpService],
  exports: [OtpService, Msg91Service],
})
export class OtpModule {}
