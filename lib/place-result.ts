/**
 * Where the result card lands on screen (owner rule, 2026-09-16).
 *
 * The result is the moment of value, so the upgrade button has to be on
 * screen the moment the result appears — never below the tool's long report.
 * After the visitor's own action, the page scrolls the SHORTEST distance that
 * shows the card from its top through the Pro band's footnote. The control
 * they just used stays in view above it, so the page reads as sliding up to
 * the answer rather than jumping somewhere new.
 *
 * `placementDelta` is the pure rule (unit-tested in tests/place-result.test.ts);
 * `placeResultCard` measures the DOM and scrolls.
 */

export type PlaceReason = 'scrolled' | 'in-view' | 'hidden' | 'on-load' | 'own-scroll';

export interface PlaceInput {
  /** Bottom edge of the sticky site header, px from the viewport top (0 if none). */
  headerBottom: number;
  /** The visible viewport height (visualViewport when there is one). */
  viewportHeight: number;
  /** The whole card: header strip to the end of the card. */
  card: { top: number; bottom: number };
  /** Top of the result section (the figure and headline), just under the frame's header strip. */
  resultTop: number;
  /** Bottom of the Pro band's footnote: the end of the region that must be on screen. */
  askBottom: number;
  /** Bottom of the upgrade button itself: the last thing given up when nothing else fits. */
  buttonBottom: number;
  /** The text field the visitor is typing in, which must stay in view. */
  typing?: { top: number } | null;
  /** The Pro band is hidden (a Pro subscriber inside the app): nothing to bring into view. */
  bandHidden?: boolean;
}

/** Space kept clear under the header and above the bottom edge. */
export const PLACE_MARGIN = 12;

export function placementDelta(i: PlaceInput): { delta: number; reason: PlaceReason } {
  if (i.bandHidden) return { delta: 0, reason: 'hidden' };
  const top = i.headerBottom + PLACE_MARGIN;
  const bottom = i.viewportHeight - PLACE_MARGIN;
  const room = bottom - top;
  const anchorTop = i.typing ? Math.min(i.card.top, i.typing.top) : i.card.top;

  // Everything from the anchor to the footnote, if it fits. Otherwise give
  // things up in this order until it does: the footnote while the visitor is
  // typing (their field stays), the frame's header strip and the typing field,
  // the footnote, and last the top of the result. The upgrade button itself
  // is never given up (owner rule: it is on screen when the result appears).
  const buttonEnd = Math.min(i.askBottom, i.buttonBottom + 8);
  const resultTop = Math.min(i.resultTop, i.askBottom);
  const tries: Array<[number, number]> = [
    [anchorTop, i.askBottom],
    ...(i.typing ? [[anchorTop, buttonEnd] as [number, number]] : []),
    [resultTop, i.askBottom],
    [resultTop, buttonEnd],
  ];
  const [keepTop, regionBottom] = tries.find(([t, b]) => b - t <= room) ?? [buttonEnd - room, buttonEnd];

  if (keepTop >= top && regionBottom <= bottom) return { delta: 0, reason: 'in-view' };
  // Below the fold: scroll up until the region's end meets the bottom edge.
  // Above (under the header): scroll back until its top clears the header.
  // Either way, never push the region's top under the header.
  let delta = regionBottom > bottom ? regionBottom - bottom : keepTop - top;
  delta = Math.min(delta, keepTop - top);
  return { delta: Math.round(delta), reason: delta === 0 ? 'in-view' : 'scrolled' };
}

/** The sticky site header's bottom edge, measured, so a different header (or none, in the app) still works. */
function headerBottom(): number {
  const h = document.querySelector('body > header, header.sticky, [data-site-header]');
  if (!h) return 0;
  const r = h.getBoundingClientRect();
  const pos = getComputedStyle(h).position;
  return (pos === 'sticky' || pos === 'fixed') && r.bottom > 0 ? r.bottom : 0;
}

/** Measure the card and scroll it into place. Returns what it did. */
export function placeResultCard(card: HTMLElement, typingField?: HTMLElement | null): { delta: number; reason: PlaceReason } {
  const band = card.querySelector<HTMLElement>('[data-result-cta]');
  const bandHidden = !band || band.offsetParent === null;
  const rect = (el: Element | null | undefined) => el?.getBoundingClientRect();
  const c = card.getBoundingClientRect();
  const result = rect(card.querySelector('.rc-result')) ?? c;
  const foot = rect(card.querySelector('.rc-foot')) ?? rect(band) ?? c;
  const button = rect(card.querySelector('[data-result-cta] .btn-pro')) ?? foot;
  const { delta, reason } = placementDelta({
    headerBottom: headerBottom(),
    viewportHeight: window.visualViewport?.height ?? window.innerHeight,
    card: { top: c.top, bottom: c.bottom },
    resultTop: result.top,
    askBottom: foot.bottom,
    buttonBottom: button.bottom,
    typing: typingField ? { top: typingField.getBoundingClientRect().top } : null,
    bandHidden,
  });
  if (reason === 'scrolled') {
    const reduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    window.scrollBy({ top: delta, behavior: reduced ? 'instant' : 'smooth' });
  }
  return { delta, reason };
}
