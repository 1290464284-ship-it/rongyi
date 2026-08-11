// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import { proposedEntries } from './format';
import type { MedicalRecordRow } from './types';

describe('medical-records/format', () => {
  it('returns proposed entries from an object or parsed JSON', () => {
    expect(proposedEntries({ id: 'mr-1', proposedContent: { chiefComplaint: '牙痛', diagnosis: '龋齿' } } as MedicalRecordRow)).toEqual([
      ['chiefComplaint', '牙痛'],
      ['diagnosis', '龋齿'],
    ]);
    expect(
      proposedEntries({ id: 'mr-2', proposedContent: null, proposedContentJson: '{"status":"DRAFT"}' } as MedicalRecordRow),
    ).toEqual([['status', 'DRAFT']]);
  });

  it('handles invalid, empty and non-object content', () => {
    expect(proposedEntries({ id: 'mr-3', proposedContent: null, proposedContentJson: '{broken' } as MedicalRecordRow)).toEqual([]);
    expect(proposedEntries({ id: 'mr-4', proposedContent: null, proposedContentJson: 'null' } as MedicalRecordRow)).toEqual([]);
    expect(proposedEntries({ id: 'mr-5', proposedContent: null, proposedContentJson: '[1,2]' } as MedicalRecordRow)).toEqual([]);
    expect(proposedEntries(undefined)).toEqual([]);
    expect(proposedEntries({ id: 'mr-6', proposedContent: [], proposedContentJson: null } as unknown as MedicalRecordRow)).toEqual([]);
  });

  it('prefers object content over JSON and tolerates scalar JSON', () => {
    expect(
      proposedEntries({
        id: 'mr-7',
        proposedContent: { diagnosis: '龋齿' },
        proposedContentJson: '{"status":"DRAFT"}',
      } as MedicalRecordRow),
    ).toEqual([['diagnosis', '龋齿']]);
    expect(
      proposedEntries({
        id: 'mr-8',
        proposedContent: '',
        proposedContentJson: '{"status":"DRAFT"}',
      } as unknown as MedicalRecordRow),
    ).toEqual([['status', 'DRAFT']]);
    expect(proposedEntries({ id: 'mr-9', proposedContent: null, proposedContentJson: '42' } as MedicalRecordRow)).toEqual([]);
  });
});
