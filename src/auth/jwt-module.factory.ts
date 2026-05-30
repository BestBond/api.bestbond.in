import type { JwtModuleAsyncOptions } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import type { StringValue } from 'ms';

/** Max JWT lifetime — users stay signed in until manual logout or this limit. */
const MAX_JWT_SECONDS = 24 * 60 * 60;

function jwtExpiresIn(config: ConfigService): number | StringValue {
  const raw = String(config.get('JWT_EXPIRES_IN') ?? '24h').trim();

  if (/^\d+$/.test(raw)) {
    return Math.min(Number(raw), MAX_JWT_SECONDS);
  }

  const match = raw.match(/^(\d+(?:\.\d+)?)([smhdw])$/i);
  if (match) {
    const n = Number(match[1]);
    const unit = match[2].toLowerCase();
    const unitSeconds =
      unit === 's'
        ? 1
        : unit === 'm'
          ? 60
          : unit === 'h'
            ? 3600
            : unit === 'd'
              ? 86400
              : 604800;
    const seconds = Math.floor(n * unitSeconds);
    if (seconds > MAX_JWT_SECONDS) return MAX_JWT_SECONDS;
    return raw as StringValue;
  }

  return '24h';
}

/** Shared JWT module registration for AuthModule and any future issuers. */
export function createJwtRegisterAsync(): JwtModuleAsyncOptions {
  return {
    inject: [ConfigService],
    useFactory: (config: ConfigService) => {
      const secret = String(config.get('JWT_SECRET') ?? 'dev-secret');

      return {
        secret,
        signOptions: { expiresIn: jwtExpiresIn(config) },
      };
    },
  };
}
