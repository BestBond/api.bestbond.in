import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  IS_PUBLIC_KEY,
  REQUIRED_ANY_PERMISSIONS_KEY,
  REQUIRED_PERMISSIONS_KEY,
} from './constants';
import type { AuthUser } from './auth-user';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<{ user?: AuthUser }>();
    const user = req.user;
    const userPerms = new Set(user?.permissions ?? []);

    const requiredAny = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (requiredAny && requiredAny.length > 0) {
      const ok = requiredAny.some((p) => userPerms.has(p));
      if (!ok) throw new ForbiddenException('Missing required permissions');
      return true;
    }

    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required || required.length === 0) return true;

    const okAll = required.every((p) => userPerms.has(p));
    if (!okAll) throw new ForbiddenException('Missing required permissions');
    return true;
  }
}
