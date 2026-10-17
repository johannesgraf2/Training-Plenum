// Editing the phases of a running plan by hand, with fixed rules (the server checks the result the same way).
// Blocks lie one after the other from the plan start. The block that ends in an A-event week stays fixed to the event
// (the taper, or race-specific without one), so the plan is built backwards from the event. Lengthening a block moves the
// following blocks up to that fixed block; without free weeks there it is a conflict. Shortening or removing frees weeks,
// which must be filled again before saving.

const FINAL = ['wettkampfspezifisch', 'taper'];
let keys = 0;
const nextKey = () => `phase-${(keys += 1)}`;

/** Editor state from the plan overview: the phases with what may change, the A events and the plan length. */
export function editorState(overview) {
  const weeks = overview.weeks;
  const total = weeks.length;
  const index = date => weeks.findIndex(w => w.startDate === date);
  const running = weeks.findIndex(w => w.state === 'current');
  const current = running >= 0 ? running : weeks.findIndex(w => w.state === 'future') >= 0 ? weeks.findIndex(w => w.state === 'future') : total;
  const events = (overview.events || []).filter(e => e.priority === 'A' && e.planWeek >= 1 && e.planWeek <= total)
    .map(e => ({ title: e.title, week: e.planWeek - 1 }));
  const items = overview.phases.map(phase => {
    const start = index(phase.startDate);
    const end = start + phase.weeks - 1;
    const event = events.find(e => e.week === end && FINAL.includes(phase.blockType));
    return { key: nextKey(), id: phase.id, blockType: phase.blockType, weeks: phase.weeks, anchor: event ? event.week : null,
      event: event?.title || null, locked: end < current, minWeeks: Math.max(1, current - start) };
  });
  return { items, total, current, events, taperWeeks: overview.taperWeeks ?? null };
}

/** Start week per item and the free (positive) or doubly used (negative) weeks before each fixed block and at the end. */
export function layout(items, total) {
  let cursor = 0;
  const starts = [], gaps = [];
  items.forEach((item, i) => {
    if (item.anchor != null) {
      const start = item.anchor - item.weeks + 1;
      gaps.push({ before: i, weeks: start - cursor });
      starts.push(start);
      cursor = item.anchor + 1;
    } else {
      starts.push(cursor);
      cursor += item.weeks;
    }
  });
  gaps.push({ before: items.length, weeks: total - cursor });
  return { starts, gaps, free: gaps.reduce((sum, g) => sum + Math.max(0, g.weeks), 0), over: gaps.reduce((sum, g) => sum + Math.max(0, -g.weeks), 0) };
}

// The gap a block can grow into: before itself when it is fixed to an event, else before the next fixed block or at the end.
function roomIndex(items, i) {
  if (items[i].anchor != null) return i;
  const next = items.findIndex((item, k) => k > i && item.anchor != null);
  return next < 0 ? items.length : next;
}
const gapAt = (state, before) => layout(state.items, state.total).gaps.find(g => g.before === before)?.weeks ?? 0;
const replace = (state, items, message = null) => ({ ...state, items, message, conflict: false });
const conflict = (state, message) => ({ ...state, message, conflict: true });

export function grow(state, i) {
  const item = state.items[i];
  if (item.locked) return conflict(state, 'Vergangene Blöcke bleiben, wie sie waren.');
  if (gapAt(state, roomIndex(state.items, i)) <= 0) {
    return conflict(state, item.anchor != null || state.items.some((other, k) => k > i && other.anchor != null)
      ? 'Kein Platz bis zum Taper: Das Event bleibt an seinem Datum. Verkürze oder entferne zuerst einen anderen Block.'
      : 'Kein Platz bis zum Planende. Verkürze oder entferne zuerst einen anderen Block.');
  }
  return replace(state, state.items.map((other, k) => k === i ? { ...other, weeks: other.weeks + 1 } : other));
}

export function shrink(state, i) {
  const item = state.items[i];
  if (item.locked) return conflict(state, 'Vergangene Blöcke bleiben, wie sie waren.');
  if (item.weeks - 1 < item.minWeeks) {
    return conflict(state, item.minWeeks > 1 ? 'Bereits vergangene Wochen dieses Blocks bleiben.' : 'Ein Block dauert mindestens eine Woche. Entferne ihn sonst.');
  }
  return replace(state, state.items.map((other, k) => k === i ? { ...other, weeks: other.weeks - 1 } : other));
}

const movable = item => item && !item.locked && item.anchor == null && item.minWeeks <= 1;

/** Swaps a block with its neighbour; both must be ahead and free of an event. */
export function move(state, i, direction) {
  const j = i + direction;
  if (!movable(state.items[i]) || !movable(state.items[j])) {
    return conflict(state, 'Verschieben geht nur zwischen Blöcken, die noch vor dir liegen und nicht am Event hängen.');
  }
  const items = [...state.items];
  [items[i], items[j]] = [items[j], items[i]];
  return replace(state, items);
}

export function remove(state, i) {
  if (!movable(state.items[i])) return conflict(state, 'Dieser Block bleibt: Er liegt schon teilweise hinter dir oder hängt am Event.');
  return replace(state, state.items.filter((_, k) => k !== i));
}

/** A new block in the first free weeks, as long as its usual length or the free weeks allow. */
export function add(state, blockType, defaultWeeks = 4) {
  const { gaps } = layout(state.items, state.total);
  const gap = gaps.find(g => g.weeks > 0);
  if (!gap) return conflict(state, 'Kein Platz für einen neuen Block. Verkürze oder entferne zuerst einen anderen Block.');
  if (FINAL.includes(blockType)) return conflict(state, 'Wettkampfspezifisch und Taper legt der Plan direkt vor das A-Event.');
  const item = { key: nextKey(), id: null, blockType, weeks: Math.min(defaultWeeks || 4, gap.weeks), anchor: null, event: null, locked: false, minWeeks: 1 };
  const items = [...state.items];
  items.splice(gap.before, 0, item);
  return replace(state, items);
}

/** The taper before every A event in the plan: it ends in the event week, the block before it gives or takes the weeks. */
export function setTaper(state, weeks) {
  let items = [...state.items];
  for (const event of state.events) {
    const i = items.findIndex(item => item.anchor === event.week);
    if (i < 0) continue;
    const anchor = items[i];
    if (anchor.locked) return conflict(state, `Der Taper vor „${event.title}“ liegt schon hinter dir.`);
    if (anchor.blockType === 'taper') {
      const delta = weeks - anchor.weeks;
      const before = items[i - 1];
      if (delta && before && before.anchor == null && !before.locked && before.weeks - delta >= Math.max(1, before.minWeeks)) {
        items[i - 1] = { ...before, weeks: before.weeks - delta };
      } else if (delta > 0 && gapAt({ ...state, items }, i) < delta) {
        return conflict(state, `Für ${weeks} Taperwochen vor „${event.title}“ ist der Block davor zu kurz.`);
      }
      items[i] = { ...anchor, weeks };
    } else {
      // Race-specific up to the event: the taper takes its last weeks.
      if (anchor.weeks - weeks < 1) return conflict(state, `Für ${weeks} Taperwochen vor „${event.title}“ ist „Wettkampfspezifisch“ zu kurz.`);
      const taper = { key: nextKey(), id: null, blockType: 'taper', weeks, anchor: event.week, event: event.title, locked: false, minWeeks: 1 };
      items = [...items.slice(0, i), { ...anchor, weeks: anchor.weeks - weeks, anchor: null, event: null }, taper, ...items.slice(i + 1)];
    }
  }
  return { ...replace(state, items), taperWeeks: weeks };
}

/** What the server gets; null when weeks are missing or used twice. */
export function body(state) {
  const { free, over } = layout(state.items, state.total);
  if (free || over) return null;
  return { phases: state.items.map(({ id, blockType, weeks }) => ({ id, blockType, weeks })), taperWeeks: state.taperWeeks };
}
