import { add, body, editorState, grow, layout, move, remove, setTaper, shrink } from './planEditor';

// 15 weeks from 19.10.2026; the A event lies in plan week 13. Week 1 runs.
const weeks = Array.from({ length: 15 }, (_, i) => ({ startDate: new Date(Date.UTC(2026, 9, 19 + 7 * i)).toISOString().slice(0, 10), state: i === 0 ? 'current' : 'future' }));
const phase = (id, blockType, start, length) => ({ id, blockType, startDate: weeks[start].startDate, weeks: length });
const overview = {
  weeks, taperWeeks: null,
  phases: [phase('g', 'grundlage', 0, 6), phase('v', 'vo2max', 6, 3), phase('w', 'wettkampfspezifisch', 9, 3), phase('t', 'taper', 12, 1), phase('u', 'uebergang', 13, 2)],
  events: [{ id: 'a', title: 'Rennen', priority: 'A', planWeek: 13 }],
};
const lengths = state => state.items.map(item => `${item.blockType}:${item.weeks}`);

test('the block before the event is fixed to it and the running block keeps its past', () => {
  const state = editorState(overview);
  expect(state.items.map(item => [item.blockType, item.anchor, item.locked, item.minWeeks])).toEqual([
    ['grundlage', null, false, 1], ['vo2max', null, false, 1], ['wettkampfspezifisch', null, false, 1], ['taper', 12, false, 1], ['uebergang', null, false, 1]]);
  expect(layout(state.items, state.total)).toMatchObject({ free: 0, over: 0 });
  expect(body(state).phases.map(p => p.id)).toEqual(['g', 'v', 'w', 't', 'u']);
});

test('lengthening needs free weeks before the taper and moves the following blocks', () => {
  let state = editorState(overview);
  const full = grow(state, 0);
  expect(full.conflict).toBe(true);
  expect(full.message).toContain('Kein Platz bis zum Taper');
  state = shrink(state, 1);
  expect(layout(state.items, state.total).free).toBe(1);
  expect(body(state)).toBeNull();
  state = grow(state, 0);
  expect(lengths(state)).toEqual(['grundlage:7', 'vo2max:2', 'wettkampfspezifisch:3', 'taper:1', 'uebergang:2']);
  expect(layout(state.items, state.total).starts).toEqual([0, 7, 9, 12, 13]);
  expect(state.conflict).toBe(false);
});

test('own blocks fill free weeks; blocks move and leave', () => {
  let state = shrink(shrink(editorState(overview), 0), 0);
  expect(add(editorState(overview), 'vo2max', 4).message).toContain('Kein Platz');
  // The new block takes the free weeks in front of the taper and can then move.
  state = add(state, 'schwelle', 4);
  expect(lengths(state)).toEqual(['grundlage:4', 'vo2max:3', 'wettkampfspezifisch:3', 'schwelle:2', 'taper:1', 'uebergang:2']);
  expect(layout(state.items, state.total)).toMatchObject({ free: 0, over: 0 });
  state = move(state, 3, -1);
  expect(lengths(state).slice(0, 3)).toEqual(['grundlage:4', 'vo2max:3', 'schwelle:2']);
  expect(move(state, 4, -1).conflict).toBe(true);  // The taper stays at the event.
  state = remove(state, 2);
  expect(layout(state.items, state.total).free).toBe(2);
  expect(body({ ...state, items: state.items })).toBeNull();
});

test('the taper length moves the block before it, also when there was no taper', () => {
  let state = setTaper(editorState(overview), 2);
  expect(lengths(state)).toEqual(['grundlage:6', 'vo2max:3', 'wettkampfspezifisch:2', 'taper:2', 'uebergang:2']);
  expect(body(state).taperWeeks).toBe(2);
  const withoutTaper = { ...overview, phases: [phase('g', 'grundlage', 0, 6), phase('v', 'vo2max', 6, 3), phase('w', 'wettkampfspezifisch', 9, 4), phase('u', 'uebergang', 13, 2)] };
  state = setTaper(editorState(withoutTaper), 1);
  expect(lengths(state)).toEqual(['grundlage:6', 'vo2max:3', 'wettkampfspezifisch:3', 'taper:1', 'uebergang:2']);
  expect(state.items[3]).toMatchObject({ id: null, anchor: 12, event: 'Rennen' });
  expect(layout(state.items, state.total)).toMatchObject({ free: 0, over: 0 });
});

test('past blocks stay and the running block keeps its elapsed weeks', () => {
  const later = { ...overview, weeks: weeks.map((w, i) => ({ ...w, state: i < 7 ? 'past' : i === 7 ? 'current' : 'future' })) };
  const state = editorState(later);
  expect(state.items[0].locked).toBe(true);
  expect(state.items[1].minWeeks).toBe(1);
  expect(grow(state, 0).message).toContain('Vergangene Blöcke');
  expect(remove(state, 0).conflict).toBe(true);
});
