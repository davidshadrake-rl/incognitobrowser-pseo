/**
 * Where the result card lands (lib/place-result.ts placementDelta), owner
 * rule 2026-09-16: the upgrade button is on screen the moment the result
 * appears, by the shortest scroll, and nothing the visitor needs (the
 * result, the field they are typing in) is pushed under the sticky header.
 *
 * The cases are a 1280x800 or 390x844 screen under a 64px header unless they
 * say otherwise, so what must show sits between 76px (header + margin) and
 * 12px above the bottom edge.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { PLACE_MARGIN, placementDelta, type PlaceInput } from '../lib/place-result';

const HEADER = 64;
const TOP = HEADER + PLACE_MARGIN;

/** A card whose header strip is 40px tall, with its result, button and footnote at the given offsets from its top. */
function card(top: number, { askBottom = 400, buttonBottom = askBottom - 70, viewportHeight = 800 }: { askBottom?: number; buttonBottom?: number; viewportHeight?: number } = {}): PlaceInput {
  return {
    headerBottom: HEADER,
    viewportHeight,
    card: { top, bottom: top + askBottom + 60 },
    resultTop: top + 40,
    askBottom: top + askBottom,
    buttonBottom: top + buttonBottom,
  };
}

/** Where a y position ends up after scrolling by delta. */
const after = (y: number, delta: number) => y - delta;

describe('placementDelta', () => {
  it('leaves a card that is already on screen where it is', () => {
    expect(placementDelta(card(100))).toEqual({ delta: 0, reason: 'in-view' });
    // Exactly at the edges still counts as in view.
    expect(placementDelta(card(TOP, { askBottom: 800 - PLACE_MARGIN - TOP }))).toEqual({ delta: 0, reason: 'in-view' });
  });

  it('scrolls a card below the fold up just far enough to show its footnote', () => {
    const i = card(600);
    const { delta, reason } = placementDelta(i);
    expect(reason).toBe('scrolled');
    expect(delta).toBe(i.askBottom - (800 - PLACE_MARGIN));
    expect(after(i.askBottom, delta)).toBe(800 - PLACE_MARGIN);
    expect(after(i.card.top, delta)).toBeGreaterThanOrEqual(TOP);
  });

  it('scrolls back down to a card that sits under the header', () => {
    const i = card(20);
    const { delta, reason } = placementDelta(i);
    expect(reason).toBe('scrolled');
    expect(delta).toBe(20 - TOP);
    expect(after(i.card.top, delta)).toBe(TOP);
  });

  it('lets the header strip slide under the site header when the whole card is taller than the room', () => {
    // 740px from the card's top to the footnote, in 712px of room; 700px from the result.
    const i = card(300, { askBottom: 740 });
    const { delta, reason } = placementDelta(i);
    expect(reason).toBe('scrolled');
    expect(after(i.askBottom, delta)).toBe(800 - PLACE_MARGIN);
    expect(after(i.resultTop, delta)).toBeGreaterThanOrEqual(TOP);
    expect(after(i.card.top, delta)).toBeLessThan(TOP);
  });

  it('keeps only the button in view when even the result to the footnote is too tall', () => {
    // A phone: 844px tall, the footnote 900px under the card's top.
    const i = card(300, { askBottom: 900, buttonBottom: 700, viewportHeight: 844 });
    const { delta, reason } = placementDelta(i);
    expect(reason).toBe('scrolled');
    expect(after(i.buttonBottom + 8, delta)).toBe(844 - PLACE_MARGIN);
    expect(after(i.resultTop, delta)).toBeGreaterThanOrEqual(TOP);
    expect(after(i.askBottom, delta)).toBeGreaterThan(844 - PLACE_MARGIN);

    // A button further down than the room allows: the button still wins, and the top of the result slides under the header.
    const tall = card(300, { askBottom: 1300, buttonBottom: 1200 });
    const kept = placementDelta(tall);
    expect(after(tall.buttonBottom + 8, kept.delta)).toBe(800 - PLACE_MARGIN);
    expect(after(tall.resultTop, kept.delta)).toBeLessThan(TOP);
  });

  it('keeps the field the visitor is typing in on screen', () => {
    const i = { ...card(400, { askBottom: 800, buttonBottom: 500 }), typing: { top: 250 } };
    const { delta, reason } = placementDelta(i);
    expect(reason).toBe('scrolled');
    expect(after(i.buttonBottom + 8, delta)).toBe(800 - PLACE_MARGIN);
    expect(after(i.typing.top, delta)).toBeGreaterThanOrEqual(TOP);

    // When the button can't fit under the field, the button wins (owner rule): the field scrolls up out of view.
    const far = { ...card(400, { askBottom: 900, buttonBottom: 850 }), typing: { top: 100 } };
    const kept = placementDelta(far);
    expect(after(far.buttonBottom + 8, kept.delta)).toBe(800 - PLACE_MARGIN);
    expect(after(far.typing.top, kept.delta)).toBeLessThan(TOP);
  });

  it('does nothing when the Pro band is hidden (a Pro subscriber inside the app)', () => {
    expect(placementDelta({ ...card(900), bandHidden: true })).toEqual({ delta: 0, reason: 'hidden' });
  });

  it('works with no sticky header at all (inside the app)', () => {
    const i = { ...card(700), headerBottom: 0 };
    const { delta } = placementDelta(i);
    expect(after(i.askBottom, delta)).toBe(800 - PLACE_MARGIN);
  });
});

/**
 * Owner rule: every red or amber result offers a free step the visitor can
 * take now. The free row used to sit inside the element `ib-upgrade` hides
 * (app/globals.css: html[data-ib-pro] .ib-upgrade { display: none }), so a Pro
 * subscriber reading a red result inside the app — the one reader guaranteed
 * to be shown a problem — was shown the problem and no way to fix it, and the
 * card was never scrolled on screen either. Found 2026-09-17.
 */
describe('the free step survives a hidden upgrade ask', () => {
  const read = (f: string) => fs.readFileSync(path.join(__dirname, '..', f), 'utf-8');
  const card_ = read('components/tools/ResultCard.tsx');

  it('the free row renders outside the wrapper ib-upgrade hides', () => {
    expect(card_, 'ib-upgrade must not wrap the whole band').not.toMatch(/className="rc-pro ib-upgrade"/);
    const free = card_.indexOf('rc-rows-free');
    const hidden = card_.indexOf('className="ib-upgrade"');
    expect(free, 'the free row must exist').toBeGreaterThan(-1);
    expect(hidden, 'the hidden wrapper must exist').toBeGreaterThan(-1);
    expect(free, 'the free row renders before the hidden wrapper opens').toBeLessThan(hidden);
  });

  it('data-result-cta rides that wrapper, so hiding the ask hides only the ask', () => {
    const wrapper = card_.match(/<div className="ib-upgrade"[^>]*>/)?.[0] ?? '';
    expect(wrapper).toContain('data-result-cta');
  });

  it('.rc-rows-free comes after .rc-rows — same specificity, so order decides', () => {
    // Both selectors are (0,1,0). A later .rc-rows margin would silently win.
    const css = read('app/globals.css').split('\n');
    const rows = css.map((l, n) => [l, n] as const).filter(([l]) => /^\s*\.rc-rows \{/.test(l)).map(([, n]) => n);
    const frees = css.map((l, n) => [l, n] as const).filter(([l]) => /^\s*\.rc-rows-free \{/.test(l)).map(([, n]) => n);
    expect(frees.length, 'one override per .rc-rows declaration').toBe(rows.length);
    for (let k = 0; k < rows.length; k++) expect(frees[k], `override ${k}`).toBeGreaterThan(rows[k]);
  });

  it('only a card with no ask AND no free step has nothing to bring into view', () => {
    expect(placementDelta({ ...card(900), bandHidden: true })).toEqual({ delta: 0, reason: 'hidden' });
    // Ask hidden, free step showing: askBottom/buttonBottom now end at the free
    // row, and the card is still scrolled up to it.
    const subscriber = placementDelta(card(900, { askBottom: 200, buttonBottom: 200 }));
    expect(subscriber.reason).toBe('scrolled');
    expect(subscriber.delta).toBeGreaterThan(0);
  });
});
