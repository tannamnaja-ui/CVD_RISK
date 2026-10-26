import { clamp, type RiskCategory } from './engines';

/** Visual span given to an open-ended last category (e.g. "≥ 40%"). */
export function lastBandSpan(categories: RiskCategory[]): number {
  const last = categories[categories.length - 1];
  const prev = categories[categories.length - 2];
  const prevSpan = prev ? prev.max - prev.min : last.min;
  return Math.max(prevSpan, last.min * 0.5);
}

/**
 * Map a risk % to a 0–100 position on a meter where every category gets an equal-width band.
 * Values beyond the visual span of the last band are pinned at the end.
 */
export function riskToMeterPosition(risk: number, categories: RiskCategory[]): number {
  const width = 100 / categories.length;
  const index = Math.max(
    0,
    categories.findIndex((c) => risk >= c.min && risk < c.max),
  );
  const cat = categories[index];
  const span = Number.isFinite(cat.max) ? cat.max - cat.min : lastBandSpan(categories);
  return clamp(index * width + clamp((risk - cat.min) / span, 0, 1) * width, 0, 100);
}
