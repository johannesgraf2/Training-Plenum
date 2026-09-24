import React from 'react';

// Line icons drawn with currentColor, so they follow the surrounding text color and theme.
const PATHS = {
  ride: <><circle cx="5.5" cy="16.5" r="3.5" /><circle cx="18.5" cy="16.5" r="3.5" /><path d="M5.5 16.5 9 9h6l3.5 7.5M9 9l3 7.5h1M15 9l-1-3h-2" /></>,
  run: <><circle cx="14" cy="4.5" r="1.8" /><path d="M7 21l3-5 3 2v3M5 12l3-3 4 1 2 3 3 1M10 16l2-6" /></>,
  swim: <><circle cx="16" cy="6" r="1.8" /><path d="M3 18c2 1.5 4 1.5 6 0s4-1.5 6 0 4 1.5 6 0M6 14l5-4 3 3M11 10l-2-3" /></>,
  activity: <path d="M3 12h4l3-7 4 14 3-7h4" />,
  moon: <><path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5Z" /><path d="M18 3.5v3M16.5 5h3" /></>,
  pin: <><path d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21Z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  check: <><circle cx="12" cy="12" r="9" /><path d="m8 12.5 2.5 2.5L16 9.5" /></>,
  flame: <path d="M12 3c1 4 5 6 5 11a5 5 0 0 1-10 0c0-3 2-4 2-7 2 1 3 3 3 5" />,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
  chevron: <path d="m9 6 6 6-6 6" />,
  plus: <path d="M12 5v14M5 12h14" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4Z" /><circle cx="12" cy="13" r="3.5" /></>,
  trash: <path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  unlock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 7.5-2" /></>,
};

export function Icon({ name, size = 18, label, className }) {
  return <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" role={label ? 'img' : undefined}
    aria-label={label} aria-hidden={label ? undefined : 'true'}>{PATHS[name]}</svg>;
}

export const sportIcon = sport => (PATHS[sport] ? sport : 'activity');
