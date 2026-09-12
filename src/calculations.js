export const AFTER_2030 = 'after2030';

export function numberOrNull(value) {
  if (value === '' || value === null || value === undefined) return null;
  const n = Number(String(value).replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function isAfter2030Period(period) {
  return period === AFTER_2030;
}

function sectionBranchTimes(section) {
  const existingLength = numberOrNull(section.existingLengthKm);
  const newLength = numberOrNull(section.newLengthKm);
  const beforeBad = numberOrNull(section.speedBeforeBadKmh);
  const beforeNormal = numberOrNull(section.speedBeforeNormalKmh);
  const afterBad = numberOrNull(section.speedAfterBadKmh ?? section.speedAfterKmh);
  const afterNormal = numberOrNull(section.speedAfterNormalKmh ?? section.speedAfterKmh);

  const values = [existingLength, newLength, beforeBad, beforeNormal, afterBad, afterNormal];
  if (values.some((v) => v === null) || values.some((v) => v <= 0)) {
    return null;
  }

  return {
    beforeBad: 60 * existingLength / beforeBad,
    beforeNormal: 60 * existingLength / beforeNormal,
    afterBad: 60 * newLength / afterBad,
    afterNormal: 60 * newLength / afterNormal,
  };
}

export function sectionEffectByCondition(section) {
  const times = sectionBranchTimes(section);
  if (!times) return { normal: 0, bad: 0 };
  return {
    normal: Math.max(0, times.beforeNormal - times.afterNormal),
    bad: Math.max(0, times.beforeBad - times.afterBad),
  };
}

export function sectionEffectRange(section) {
  const effect = sectionEffectByCondition(section);
  return {
    min: Math.min(effect.normal, effect.bad),
    max: Math.max(effect.normal, effect.bad),
  };
}

// Compatibility helper: returns the upper bound of the effect range.
export function sectionEffectMinutes(section) {
  return sectionEffectRange(section).max;
}

export function effectStartYear(section) {
  const explicit = numberOrNull(section.effectStartYear);
  if (explicit !== null) return Math.trunc(explicit);
  const commission = numberOrNull(section.commissionYear);
  return commission === null ? null : Math.trunc(commission) + 1;
}

export function isSectionActiveForPeriod(section, period) {
  if (isAfter2030Period(period)) return Boolean(section.includeAfter2030 ?? true);
  if (!section.includeInCalculations) return false;
  const year = numberOrNull(period);
  const start = effectStartYear(section);
  return year !== null && start !== null && year >= start;
}

export function isSectionActiveForYear(section, year) {
  return isSectionActiveForPeriod(section, year);
}

export function routeSectionWeight(route, sectionId, period) {
  if (isAfter2030Period(period)) {
    const explicit = numberOrNull(route.post2030Weights?.[sectionId]);
    if (explicit !== null) return Math.max(0, explicit);
  }
  return route.sectionFlags?.[sectionId] ? 1 : 0;
}

// Weight used to define the current-condition range. It reflects every modelled
// section that lies on the correspondence, including sections whose project is
// only considered in the "after 2030" scenario.
export function routeBaselineSectionWeight(route, sectionId) {
  const explicit = numberOrNull(route.post2030Weights?.[sectionId]);
  if (explicit !== null) return Math.max(0, explicit);
  return route.sectionFlags?.[sectionId] ? 1 : 0;
}

export function routeCurrentTimeRangeExact(route, sections) {
  const midpoint = numberOrNull(route.currentTimeMinutes);
  if (midpoint === null) return { min: null, max: null };

  const spread = sections.reduce((sum, section) => {
    const weight = routeBaselineSectionWeight(route, section.id);
    if (weight <= 0) return sum;
    const times = sectionBranchTimes(section);
    if (!times) return sum;
    return sum + Math.max(0, times.beforeBad - times.beforeNormal) * weight;
  }, 0);

  return {
    min: Math.max(0, midpoint - spread / 2), // normal conditions
    max: Math.max(0, midpoint + spread / 2), // adverse conditions
  };
}

export function routeCurrentTimeRange(route, sections) {
  const exact = routeCurrentTimeRangeExact(route, sections);
  if (exact.min === null || exact.max === null) return exact;
  return { min: Math.round(exact.min), max: Math.round(exact.max) };
}

export function routeEffectByCondition(route, sections, period) {
  return sections.reduce((sum, section) => {
    const weight = routeSectionWeight(route, section.id, period);
    if (weight <= 0 || !isSectionActiveForPeriod(section, period)) return sum;
    const effect = sectionEffectByCondition(section);
    return {
      normal: sum.normal + effect.normal * weight,
      bad: sum.bad + effect.bad * weight,
    };
  }, { normal: 0, bad: 0 });
}

export function routeEffectRange(route, sections, period) {
  const effect = routeEffectByCondition(route, sections, period);
  return {
    min: Math.min(effect.normal, effect.bad),
    max: Math.max(effect.normal, effect.bad),
  };
}

// Compatibility helper: upper bound of the route effect range.
export function routeEffectMinutes(route, sections, period) {
  return routeEffectRange(route, sections, period).max;
}

export function routeTimeRangeExact(route, sections, period) {
  const current = routeCurrentTimeRangeExact(route, sections);
  if (current.min === null || current.max === null) return { min: null, max: null };
  const effect = routeEffectByCondition(route, sections, period);

  const normalTime = Math.max(0, current.min - effect.normal);
  const badTime = Math.max(0, current.max - effect.bad);

  return {
    min: Math.min(normalTime, badTime),
    max: Math.max(normalTime, badTime),
  };
}

export function routeTimeRange(route, sections, period) {
  const exact = routeTimeRangeExact(route, sections, period);
  if (exact.min === null || exact.max === null) return exact;
  return { min: Math.round(exact.min), max: Math.round(exact.max) };
}

export function routeTimeMinutes(route, sections, period) {
  return routeTimeRange(route, sections, period).min;
}

export function displayedRouteEffectRange(route, sections, period) {
  const current = routeCurrentTimeRange(route, sections);
  const time = routeTimeRange(route, sections, period);
  if (current.min === null || current.max === null || time.min === null || time.max === null) {
    return { min: 0, max: 0 };
  }

  // Keep the displayed savings consistent with the two displayed condition
  // branches after rounding: normal-to-normal and adverse-to-adverse.
  const normalSaving = Math.max(0, current.min - time.min);
  const badSaving = Math.max(0, current.max - time.max);
  return {
    min: Math.min(normalSaving, badSaving),
    max: Math.max(normalSaving, badSaving),
  };
}

export function displayedRouteEffectMinutes(route, sections, period) {
  return displayedRouteEffectRange(route, sections, period).max;
}

export function sectionsIncludedForPeriod(sections, period) {
  if (isAfter2030Period(period)) return sections.filter((s) => s.includeAfter2030 ?? true);
  return sections.filter((s) => s.includeInCalculations);
}

export function includedLengthKm(sections, period = null) {
  const selected = period === null ? sections.filter((s) => s.includeInCalculations) : sectionsIncludedForPeriod(sections, period);
  return selected.reduce((sum, s) => sum + (numberOrNull(s.newLengthKm) ?? 0), 0);
}

export function formatEffectRange(range, options = {}) {
  const min = Math.max(0, Math.round(Number(range?.min ?? 0)));
  const max = Math.max(0, Math.round(Number(range?.max ?? 0)));
  const prefix = options.prefix ?? '';
  const suffix = options.suffix ?? ' мин';
  if (min === max) return `${prefix}${max}${suffix}`;
  return `${prefix}${min}–${max}${suffix}`;
}

export function formatTimeRange(range) {
  if (!range || range.min === null || range.max === null) return '—';
  if (range.min === range.max) return formatClock(range.min);
  return `${formatClock(range.min)}–${formatClock(range.max)}`;
}

export function formatMinutes(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(Number(totalMinutes))) return '—';
  const rounded = Math.round(Number(totalMinutes));
  const h = Math.floor(rounded / 60);
  const m = Math.abs(rounded % 60);
  if (h <= 0) return `${m} мин`;
  return `${h} ч ${String(m).padStart(2, '0')} мин`;
}

export function formatClock(totalMinutes) {
  if (totalMinutes === null || totalMinutes === undefined || !Number.isFinite(Number(totalMinutes))) return '—';
  const rounded = Math.round(Number(totalMinutes));
  const h = Math.floor(rounded / 60);
  const m = Math.abs(rounded % 60);
  return `${h}:${String(m).padStart(2, '0')}`;
}

export function parseClock(value) {
  const text = String(value ?? '').trim();
  const m = text.match(/^(\d{1,2})\s*[:.]\s*(\d{1,2})$/);
  if (!m) return null;
  const hours = Number(m[1]);
  const minutes = Number(m[2]);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes) || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export function normalizeCommissionYear(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const n = Number(text);
  return Number.isFinite(n) ? Math.trunc(n) : text;
}
