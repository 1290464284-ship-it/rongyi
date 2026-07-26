import { SetMetadata } from '@nestjs/common';

export const RESOURCE_OWNER_KEY = 'resourceOwner';

export interface ResourceOwnerConfig {
  resourceType: string;
  idParam?: string;
  ownerField?: string;
}

export const ResourceOwner = (config: ResourceOwnerConfig) =>
  SetMetadata(RESOURCE_OWNER_KEY, config);
