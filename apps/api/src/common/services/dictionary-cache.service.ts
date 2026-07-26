import { Injectable } from '@nestjs/common';
import { CacheService } from './cache.service';
import { CACHE_PREFIXES } from '../constants/cache-keys';
import {
  DEPARTMENT_CACHE_TTL_MS,
  TITLE_CACHE_TTL_MS,
  DRUG_CATALOG_CACHE_TTL_MS,
  PAYMENT_METHOD_CACHE_TTL_MS,
  MEMBER_CARD_TYPE_CACHE_TTL_MS,
} from '../../config/constants';

export interface DictionaryItem {
  id: string;
  name: string;
  code?: string;
  sortOrder?: number;
  [key: string]: unknown;
}

@Injectable()
export class DictionaryCacheService {
  constructor(private cache: CacheService) {}

  buildClinicKey(clinicId: string, key: string): string {
    return `${key}:${clinicId}`;
  }

  async getDepartments(clinicId: string): Promise<DictionaryItem[] | undefined> {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.DEPARTMENT);
    return this.cache.get<DictionaryItem[]>(cacheKey);
  }

  setDepartments(clinicId: string, items: DictionaryItem[]) {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.DEPARTMENT);
    this.cache.set(cacheKey, items, DEPARTMENT_CACHE_TTL_MS);
  }

  invalidateDepartments(clinicId?: string): void {
    if (clinicId) {
      const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.DEPARTMENT);
      this.cache.del(cacheKey);
    } else {
      this.cache.delPattern(CACHE_PREFIXES.DEPARTMENT);
    }
  }

  async getTitles(clinicId: string): Promise<DictionaryItem[] | undefined> {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.TITLE);
    return this.cache.get<DictionaryItem[]>(cacheKey);
  }

  setTitles(clinicId: string, items: DictionaryItem[]) {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.TITLE);
    this.cache.set(cacheKey, items, TITLE_CACHE_TTL_MS);
  }

  invalidateTitles(clinicId?: string): void {
    if (clinicId) {
      const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.TITLE);
      this.cache.del(cacheKey);
    } else {
      this.cache.delPattern(CACHE_PREFIXES.TITLE);
    }
  }

  async getDrugCatalog(clinicId: string): Promise<DictionaryItem[] | undefined> {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.DRUG_CATALOG);
    return this.cache.get<DictionaryItem[]>(cacheKey);
  }

  setDrugCatalog(clinicId: string, items: DictionaryItem[]) {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.DRUG_CATALOG);
    this.cache.set(cacheKey, items, DRUG_CATALOG_CACHE_TTL_MS);
  }

  invalidateDrugCatalog(clinicId?: string): void {
    if (clinicId) {
      const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.DRUG_CATALOG);
      this.cache.del(cacheKey);
    } else {
      this.cache.delPattern(CACHE_PREFIXES.DRUG_CATALOG);
    }
  }

  async getPaymentMethods(clinicId: string): Promise<DictionaryItem[] | undefined> {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.PAYMENT_METHOD);
    return this.cache.get<DictionaryItem[]>(cacheKey);
  }

  setPaymentMethods(clinicId: string, items: DictionaryItem[]) {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.PAYMENT_METHOD);
    this.cache.set(cacheKey, items, PAYMENT_METHOD_CACHE_TTL_MS);
  }

  invalidatePaymentMethods(clinicId?: string): void {
    if (clinicId) {
      const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.PAYMENT_METHOD);
      this.cache.del(cacheKey);
    } else {
      this.cache.delPattern(CACHE_PREFIXES.PAYMENT_METHOD);
    }
  }

  async getMemberCardTypes(clinicId: string): Promise<DictionaryItem[] | undefined> {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.MEMBER_CARD_TYPE);
    return this.cache.get<DictionaryItem[]>(cacheKey);
  }

  setMemberCardTypes(clinicId: string, items: DictionaryItem[]) {
    const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.MEMBER_CARD_TYPE);
    this.cache.set(cacheKey, items, MEMBER_CARD_TYPE_CACHE_TTL_MS);
  }

  invalidateMemberCardTypes(clinicId?: string): void {
    if (clinicId) {
      const cacheKey = this.buildClinicKey(clinicId, CACHE_PREFIXES.MEMBER_CARD_TYPE);
      this.cache.del(cacheKey);
    } else {
      this.cache.delPattern(CACHE_PREFIXES.MEMBER_CARD_TYPE);
    }
  }

  invalidateAllDictionaryCache(clinicId?: string): void {
    this.invalidateDepartments(clinicId);
    this.invalidateTitles(clinicId);
    this.invalidateDrugCatalog(clinicId);
    this.invalidatePaymentMethods(clinicId);
    this.invalidateMemberCardTypes(clinicId);
  }
}