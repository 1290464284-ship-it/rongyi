import { describe, expect, it } from 'vitest';
import {
  analyticsHubTabs,
  clinicalHubTabs,
  communicationHubTabs,
  financeHubTabs,
  hrHubTabs,
  inventoryHubTabs,
  patientHubTabs,
  systemHubTabs,
} from './hub-tabs';
import { resourceRegistry } from '../../domain/resources';

const allTabs = [
  ...analyticsHubTabs,
  ...clinicalHubTabs,
  ...communicationHubTabs,
  ...financeHubTabs,
  ...hrHubTabs,
  ...inventoryHubTabs,
  ...patientHubTabs,
  ...systemHubTabs,
];

describe('hub tab configuration', () => {
  it('uses only registered resource names', () => {
    for (const tab of allTabs) {
      if (tab.kind === 'resource') {
        expect(resourceRegistry.get(tab.resource), tab.resource).toBeDefined();
      }
    }
  });

  it('uses the canonical satisfaction resource name', () => {
    const satisfaction = analyticsHubTabs.find((tab) => tab.id === 'satisfaction');
    expect(satisfaction?.kind === 'resource' && satisfaction.resource).toBe('satisfactionSurveys');
  });
});
