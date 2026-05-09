import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { RequirePermissions } from '../auth/require-permissions.decorator';
import { CreatePermissionDto } from './dto/create-permission.dto';
import { CreateRoleDto } from './dto/create-role.dto';
import { SetRolePermissionsDto } from './dto/set-role-permissions.dto';

@Controller('rbac')
export class RbacController {
  constructor(private readonly rbac: RbacService) {}

  @Get('roles')
  @RequirePermissions('rbac.manage')
  listRoles() {
    return this.rbac.listRoles();
  }

  @Get('permissions')
  @RequirePermissions('rbac.manage')
  listPermissions() {
    return this.rbac.listPermissions();
  }

  @Post('permissions')
  @RequirePermissions('rbac.manage')
  createPermission(@Body() dto: CreatePermissionDto) {
    return this.rbac.upsertPermission(dto.key, dto.description ?? null);
  }

  @Post('roles')
  @RequirePermissions('rbac.manage')
  createRole(@Body() dto: CreateRoleDto) {
    return this.rbac.upsertRole({
      name: dto.name,
      description: dto.description ?? null,
      permissionKeys: dto.permissionKeys,
    });
  }

  @Put('roles/:name/permissions')
  @RequirePermissions('rbac.manage')
  setRolePermissions(
    @Param('name') name: string,
    @Body() dto: SetRolePermissionsDto,
  ) {
    return this.rbac.setRolePermissions(name, dto.permissionKeys);
  }
}
