import { describe, expect, it } from 'vitest';
import {
  analyticsHubTabs,
  clinicalHubTabs,
  communicationHubTabs,
  financeHubTabs,
  frontDeskHubTabs,
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
  ...frontDeskHubTabs,
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
    const satisfaction = allTabs.find((tab) => tab.id === 'satisfaction');
    expect(satisfaction?.kind === 'resource' && satisfaction.resource).toBe('satisfactionSurveys');
  });

  it('keeps doctor-anomalies in the HR hub instead of analytics', () => {
    expect(hrHubTabs.some((tab) => tab.id === 'anomalies')).toBe(true);
    expect(analyticsHubTabs.some((tab) => tab.id === 'anomalies')).toBe(false);
  });

  it('removes the duplicated workbench tab from analytics', () => {
    expect(analyticsHubTabs.some((tab) => tab.id === 'workbench')).toBe(false);
  });
});
