import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ActivityDetail, { duration, chartGeometry } from './ActivityDetail';

test('timer precision and missing values', () => {
  expect(duration(4154)).toBe('01:09:14');
  expect(duration(7630.202)).toBe('02:07:10');
  expect(duration(null)).toBe('—');
  expect(duration(0)).toBe('00:00:00');
});

test('charts use elapsed timestamps, keep zero, break missing readings and pauses', () => {
  const chart = chartGeometry([{ time: 0, power: 0 }, { time: 10 }, { time: 20, power: 100 }, { time: 25, power: 50 }, { time: 90, power: 40 }], 'power');
  expect(chart.min).toBe(0);
  expect(chart.x({ time: 90 })).toBe(760);
  expect(chart.x({ time: 0 })).toBe(40);
  expect(chart.path.match(/M/g)).toHaveLength(3);
  expect(chart.path.match(/L/g)).toHaveLength(1);
  expect(chartGeometry([{ time: 1 }], 'power')).toBeNull();
  expect(chartGeometry([{ time: 1, power: 0 }], 'power').path).not.toMatch(/NaN|Infinity/);
});

test('activity page renders real metadata, zero power and missing distance', () => {
  const page = renderToStaticMarkup(<ActivityDetail activity={{ date: '2026-03-01T13:31:54Z', sport: 'ride', title: 'Test ride', source: '.fit', power: 0, distance: null, fitDetails: { timerSeconds: 4154, elapsedSeconds: 4331, recordCount: 4154, measurements: ['hr'], sessions: [{}], laps: [] } }} onBack={() => {}} apiBase="" />);
  expect(page).toContain('01:09:14');
  expect(page).toContain('01:12:11');
  expect(page).toContain('0 <small>W</small>');
  expect(page).not.toContain('0 <small>km</small>');
});
