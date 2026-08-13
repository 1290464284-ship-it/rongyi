// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { registerModalLayer } from './modal-a11y';

describe('modal-a11y', () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it('marks background inert and keeps only the top layer interactive', () => {
    const app = document.createElement('div');
    app.id = 'app';
    const background = document.createElement('button');
    background.type = 'button';
    background.textContent = 'background';
    app.append(background);
    for (let index = 0; index < 2; index += 1) {
      const backdrop = document.createElement('div');
      backdrop.className = 'modal-backdrop';
      const modal = document.createElement('div');
      modal.className = 'modal';
      backdrop.append(modal);
      app.append(backdrop);
    }
    document.body.append(app);
    const layers = Array.from(app.querySelectorAll<HTMLElement>('.modal'));
    const backdrops = Array.from(app.querySelectorAll<HTMLElement>('.modal-backdrop'));

    const unregisterFirst = registerModalLayer(layers[0]);
    expect(background.hasAttribute('inert')).toBe(true);
    expect(backdrops[0].hasAttribute('inert')).toBe(false);

    const unregisterSecond = registerModalLayer(layers[1]);
    expect(background.hasAttribute('inert')).toBe(true);
    expect(backdrops[0].hasAttribute('inert')).toBe(true);
    expect(backdrops[1].hasAttribute('inert')).toBe(false);

    unregisterSecond();
    expect(backdrops[0].hasAttribute('inert')).toBe(false);
    expect(background.hasAttribute('inert')).toBe(true);

    unregisterFirst();
    expect(background.hasAttribute('inert')).toBe(false);
  });

  it('inerts whole app branches that do not contain the top layer', () => {
    const root = document.createElement('div');
    root.id = 'root';
    const sidebar = document.createElement('button');
    sidebar.type = 'button';
    const page = document.createElement('div');
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    modal.className = 'modal';
    backdrop.append(modal);
    page.append(backdrop);
    root.append(sidebar, page);
    document.body.append(root);

    const unregister = registerModalLayer(modal);
    expect(sidebar.hasAttribute('inert')).toBe(true);
    expect(page.hasAttribute('inert')).toBe(false);
    unregister();
    expect(sidebar.hasAttribute('inert')).toBe(false);
  });

  it('skips head/script children and deduplicates repeated layer registration', () => {
    const root = document.createElement('div');
    root.id = 'root';
    const script = document.createElement('script');
    const button = document.createElement('button');
    root.append(script, button);
    const backdrop = document.createElement('div');
    backdrop.className = 'modal-backdrop';
    const modal = document.createElement('div');
    backdrop.append(modal);
    root.append(backdrop);
    document.body.append(root);

    const unregister = registerModalLayer(modal);
    const unregisterAgain = registerModalLayer(modal);
    expect(script.hasAttribute('inert')).toBe(false);
    expect(button.hasAttribute('inert')).toBe(true);

    unregisterAgain();
    expect(button.hasAttribute('inert')).toBe(false);
    unregister();
    expect(button.hasAttribute('inert')).toBe(false);
  });
});
