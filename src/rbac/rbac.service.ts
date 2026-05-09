import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Permission } from './entities/permission.entity';
import { Role } from './entities/role.entity';

@Injectable()
export class RbacService {
  constructor(
    @InjectRepository(Role) private readonly rolesRepo: Repository<Role>,
    @InjectRepository(Permission)
    private readonly permsRepo: Repository<Permission>,
  ) {}

  async getRoleByName(name: string): Promise<Role | null> {
    return this.rolesRepo.findOne({
      where: { name },
      relations: { permissions: true },
    });
  }

  async listRoles(): Promise<Role[]> {
    return this.rolesRepo.find({ relations: { permissions: true } });
  }

  async listPermissions(): Promise<Permission[]> {
    return this.permsRepo.find();
  }

  async upsertPermission(
    key: string,
    description?: string | null,
  ): Promise<Permission> {
    const existing = await this.permsRepo.findOne({ where: { key } });
    if (existing) {
      existing.description = description ?? existing.description ?? null;
      return this.permsRepo.save(existing);
    }
    return this.permsRepo.save(
      this.permsRepo.create({ key, description: description ?? null }),
    );
  }

  async upsertRole(params: {
    name: string;
    description?: string | null;
    permissionKeys?: string[];
  }): Promise<Role> {
    const permissions = params.permissionKeys?.length
      ? await this.permsRepo.find({ where: { key: In(params.permissionKeys) } })
      : [];

    const existing = await this.rolesRepo.findOne({
      where: { name: params.name },
    });
    if (existing) {
      existing.description = params.description ?? existing.description ?? null;
      if (params.permissionKeys) existing.permissions = permissions;
      return this.rolesRepo.save(existing);
    }

    return this.rolesRepo.save(
      this.rolesRepo.create({
        name: params.name,
        description: params.description ?? null,
        permissions,
      }),
    );
  }

  async setRolePermissions(
    roleName: string,
    permissionKeys: string[],
  ): Promise<Role> {
    const role = await this.rolesRepo.findOne({
      where: { name: roleName },
      relations: { permissions: true },
    });
    if (!role) throw new NotFoundException('Role not found');
    const permissions = await this.permsRepo.find({
      where: { key: In(permissionKeys) },
    });
    role.permissions = permissions;
    return this.rolesRepo.save(role);
  }
}
