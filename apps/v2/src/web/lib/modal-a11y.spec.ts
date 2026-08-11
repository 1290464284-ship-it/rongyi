// @vitest-environment jsdom

import { afterEach, describe, expect, it } from 'vitest';
import { registerModalLayer } from './modal-a11y';

describe('modal-a11y', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('marks background inert and keeps only the top layer interactive', () => {
    document.body.innerHTML = `
      <div id="app">
        <button type="button">background</button>
        <div class="modal-backdrop"><div class="modal"></div></div>
        <div class="modal-backdrop"><div class="modal"></div></div>
      </div>`;
    const layers = Array.from(document.querySelectorAll<HTMLElement>('.modal'));
    const backdrops = Array.from(document.querySelectorAll<HTMLElement>('.modal-backdrop'));
    const background = document.querySelector<HTMLElement>('button')!;

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
});
