import type { JwtModuleAsyncOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';

/** Shared JWT module registration for AuthModule, OtpModule, and any future issuers. */
export function createJwtRegisterAsync(): JwtModuleAsyncOptions {
  return {
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const rawExpiresIn = String(config.get('JWT_EXPIRES_IN') ?? '1h');
      const expiresIn: number | StringValue = /^\d+$/.test(rawExpiresIn)
        ? Number(rawExpiresIn)
        : (rawExpiresIn as StringValue);

      const secret = String(config.get('JWT_SECRET') ?? 'dev-secret');

      return {
        secret,
        signOptions: { expiresIn },
      };
    },
  };
}
