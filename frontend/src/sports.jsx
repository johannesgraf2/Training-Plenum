import React from 'react';

// Sports are marked with a colored dot and a word, never an emoji; the colors come from theme.css.
export const sportLabels = { run: 'Laufen', ride: 'Radfahren', swim: 'Schwimmen', multisport: 'Multisport', walking: 'Gehen', hiking: 'Wandern' };
export const sportColors = { run: 'var(--sport-run)', ride: 'var(--sport-ride)', swim: 'var(--sport-swim)' };
export const sportColor = sport => sportColors[sport] || 'var(--sport-other)';

export function SportMark({ sport, suffix, className = '' }) {
  return <span className={`sport-mark ${className}`.trim()}>
    <i aria-hidden="true" style={{ background: sportColor(sport) }} />
    {sportLabels[sport] || sport || 'Training'}{suffix ? ` · ${suffix}` : ''}
  </span>;
}
