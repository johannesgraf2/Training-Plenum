import React from 'react';

// Bundled artwork: works offline and follows light/dark mode through the --land-* tokens in theme.css.
export function HomeLandscape() {
  return <svg className="home-landscape" viewBox="0 0 1440 560" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
    <path d="M0 250 L120 190 L210 220 L330 150 L450 205 L560 170 L700 120 L820 180 L930 140 L1060 200 L1180 150 L1300 185 L1440 140 V560 H0 Z" style={{ fill: 'var(--land-far)' }} />
    <rect y="215" width="1440" height="60" style={{ fill: 'var(--paper)' }} opacity="0.55" />
    <path d="M0 320 L90 280 L200 300 L310 250 L420 295 L540 260 L660 300 L780 245 L900 290 L1010 262 L1130 305 L1250 270 L1440 300 V560 H0 Z" style={{ fill: 'var(--land-mid)' }} />
    <rect y="300" width="1440" height="70" style={{ fill: 'var(--paper)' }} opacity="0.5" />
    <path d="M0 400 L140 355 L260 380 L400 340 L560 385 L720 350 L880 390 L1040 355 L1200 392 L1440 360 V560 H0 Z" style={{ fill: 'var(--land-near)' }} />
    <g style={{ fill: 'var(--land-trees)' }}>
      <path d="M18 420 L34 350 L50 420 Z" /><path d="M44 430 L64 330 L84 430 Z" /><path d="M78 425 L92 370 L106 425 Z" />
      <path d="M1340 420 L1356 360 L1372 420 Z" /><path d="M1368 430 L1390 330 L1412 430 Z" /><path d="M1404 425 L1420 365 L1436 425 Z" />
    </g>
  </svg>;
}

// Stand-in for the race-goal photo: coast and cliffs at dusk, dark enough for white text.
export function GoalScene() {
  return <svg className="race-goal-scene" viewBox="0 0 356 150" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs>
      <linearGradient id="race-goal-sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7d8e98" /><stop offset="1" stopColor="#c4c0b6" /></linearGradient>
    </defs>
    <rect width="356" height="150" fill="url(#race-goal-sky)" />
    <path d="M0 100 H356 V150 H0 Z" fill="#4f6670" />
    <path d="M0 104 H356" stroke="#8ea2aa" strokeWidth="1" />
    <path d="M170 100 L200 70 L232 62 L262 40 L300 34 L330 46 L356 40 V150 H150 L162 118 Z" fill="#403e39" />
    <path d="M232 62 L262 40 L300 34 L300 150 L240 150 Z" fill="#33322e" />
    <path d="M150 150 L162 118 L184 108 L214 150 Z" fill="#5d584f" />
  </svg>;
}
