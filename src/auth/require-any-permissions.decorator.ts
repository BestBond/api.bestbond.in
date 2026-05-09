import { SetMetadata } from '@nestjs/common';
import { REQUIRED_ANY_PERMISSIONS_KEY } from './constants';

export const RequireAnyPermissions = (...permissions: string[]) =>
  SetMetadata(REQUIRED_ANY_PERMISSIONS_KEY, permissions);
