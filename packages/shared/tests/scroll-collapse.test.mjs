import { test } from "node:test";
import assert from "node:assert/strict";

const { createScrollCollapse, SCROLL_COLLAPSE } = await import("../src/scroll-collapse.ts");

/** A scroll as iOS reports it: one event a frame (~16.7ms), from `from`, at `speed` points per second (negative: back). */
function* moving({ from, speed, distance, start = 0, frame = 1000 / 60 }) {
  const steps = Math.max(1, Math.round(Math.abs(distance) / (Math.abs(speed) * (frame / 1000))));
  for (let i = 1; i <= steps; i++) yield { fromTop: from + (distance * i) / steps, time: start + i * frame };
}
/** Momentum after a flick: the speed falls off as UIKit's deceleration does, from `speed` to a stop. */
function* coasting({ from, speed, start, frame = 1000 / 60, rate = 0.998 }) {
  let y = from;
  let v = speed;
  let t = start;
  while (Math.abs(v) > 20) {
    t += frame;
    v *= rate ** frame;
    y += (v * frame) / 1000;
    yield { fromTop: y, time: t };
  }
}
/** Feeds every event, returns the changes in order with the position each came at. */
function run(collapse, ...streams) {
  const changes = [];
  for (const stream of streams) for (const s of stream) {
    const change = collapse.sample(s);
    if (change) changes.push({ change, at: Math.round(s.fromTop) });
  }
  return changes;
}
const lastOf = (gen) => [...gen].at(-1);

test("slow scrolling never collapses the bar, however far it goes", () => {
  const c = createScrollCollapse();
  assert.deepEqual(run(c, moving({ from: 100, speed: 300, distance: 2400 })), []);
  assert.deepEqual(run(c, moving({ from: 2500, speed: 450, distance: 1500, start: 9000 })), []);
  assert.equal(c.collapsed, false);
});

test("moderate scrolling below the speed keeps the whole bar too", () => {
  const c = createScrollCollapse();
  assert.deepEqual(run(c, moving({ from: 100, speed: SCROLL_COLLAPSE.collapseSpeed * 0.85, distance: 1200 })), []);
});

test("a fast flick collapses the bar once, after the minimum travel, and its momentum changes nothing", () => {
  const c = createScrollCollapse();
  const drag = [...moving({ from: 200, speed: 1400, distance: 90 })];
  const changes = run(c, drag, coasting({ from: 290, speed: 1400, start: drag.at(-1).time }));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].change, "collapse");
  assert.ok(changes[0].at >= 200 + SCROLL_COLLAPSE.collapseTravel, `collapsed only after the minimum travel (at ${changes[0].at})`);
  assert.equal(c.collapsed, true);
});

test("a flick whose drag is short still collapses through its momentum", () => {
  const c = createScrollCollapse();
  const drag = [...moving({ from: 300, speed: 1600, distance: 20 })];
  assert.deepEqual(run(c, drag), [], "20 points is under the minimum travel");
  assert.deepEqual(run(c, coasting({ from: 320, speed: 1600, start: drag.at(-1).time })).map((x) => x.change), ["collapse"]);
});

test("a quick nudge too short to travel far never collapses the bar", () => {
  const c = createScrollCollapse();
  const nudge = [...moving({ from: 400, speed: 1500, distance: 18 })];
  assert.deepEqual(run(c, nudge, coasting({ from: 418, speed: 300, start: nudge.at(-1).time })), []);
});

test("scrolling back brings the whole bar back after the expand distance, and a small turn does not", () => {
  const c = createScrollCollapse();
  run(c, moving({ from: 200, speed: 1500, distance: 300 }));
  assert.equal(c.collapsed, true);
  const t = 2000;
  assert.deepEqual(run(c, moving({ from: 500, speed: -200, distance: -(SCROLL_COLLAPSE.expandTravel - 6), start: t })), [], "a small turn back");
  // Slowly, as a person reading back up does: any speed brings it back.
  const back = run(c, moving({ from: 482, speed: -150, distance: -40, start: t + 120 }));
  assert.deepEqual(back.map((x) => x.change), ["expand"]);
  assert.equal(c.collapsed, false);
});

test("jitter in the middle of a flick never flickers the bar", () => {
  const c = createScrollCollapse();
  const events = [...moving({ from: 200, speed: 1500, distance: 120 })];
  let { fromTop: y, time: t } = events.at(-1);
  // A finger wobbling a few points either way, frame after frame.
  for (let i = 0; i < 30; i++) {
    t += 1000 / 60;
    y += i % 2 ? 4 : -5;
    events.push({ fromTop: y, time: t });
  }
  assert.deepEqual(run(c, events).map((x) => x.change), ["collapse"]);
});

test("a turn back right after collapsing restores the bar at once, past the expand distance", () => {
  const c = createScrollCollapse();
  const flick = [...moving({ from: 200, speed: 1500, distance: 100 })];
  assert.deepEqual(run(c, flick).map((x) => x.change), ["collapse"]);
  const end = flick.at(-1);
  const back = run(c, moving({ from: end.fromTop, speed: -2000, distance: -120, start: end.time }));
  assert.deepEqual(back.map((x) => x.change), ["expand"]);
  assert.ok(back[0].at <= end.fromTop - SCROLL_COLLAPSE.expandTravel);
});

test("a flick on right after the bar came back waits out the hold", () => {
  const c = createScrollCollapse();
  const flick = [...moving({ from: 200, speed: 1500, distance: 100 })];
  run(c, flick);
  let { fromTop: y, time: t } = flick.at(-1);
  const back = [...moving({ from: y, speed: -1500, distance: -60, start: t })];
  assert.deepEqual(run(c, back).map((x) => x.change), ["expand"]);
  ({ fromTop: y, time: t } = back.at(-1));
  const again = [...moving({ from: y, speed: 1500, distance: 600, start: t })];
  const changes = [];
  for (const s of again) if (c.sample(s) === "collapse") changes.push(s.time - t);
  assert.equal(changes.length, 1);
  assert.ok(changes[0] >= SCROLL_COLLAPSE.holdMs - 60, `held for a moment (${Math.round(changes[0])}ms after the turn)`);
});

test("the top of the list always shows the whole bar", () => {
  const c = createScrollCollapse();
  run(c, moving({ from: 100, speed: 1500, distance: 300 }));
  assert.equal(c.collapsed, true);
  assert.equal(c.sample({ fromTop: 10, time: 5000 }), "expand");
  assert.equal(c.collapsed, false);
  assert.deepEqual(run(c, moving({ from: 0, speed: 2000, distance: 20, start: 6000 })), [], "never collapses within reach of the top");
});

test("a bounce past the end of the list is not a scroll back", () => {
  const c = createScrollCollapse();
  const flick = [...moving({ from: 900, speed: 1500, distance: 100 })];
  run(c, flick);
  assert.equal(c.collapsed, true);
  let t = flick.at(-1).time;
  // Past the end, then springing back to it.
  for (const y of [1010, 1030, 1040, 1030, 1010, 1000]) {
    t += 1000 / 60;
    assert.equal(c.sample({ fromTop: y, time: t, pastEnd: y > 1000 }), null);
  }
  assert.equal(c.collapsed, true);
});

test("a pause starts the movement over: slow steps with rests never add up to a flick", () => {
  const c = createScrollCollapse();
  let y = 100;
  let t = 0;
  for (let step = 0; step < 20; step++) {
    for (const s of moving({ from: y, speed: 900, distance: 20, start: t })) assert.equal(c.sample(s), null);
    y += 20;
    t += 600;
  }
  assert.equal(c.collapsed, false);
});

test("two events bunched together cannot fake a flick", () => {
  const c = createScrollCollapse();
  run(c, moving({ from: 100, speed: 300, distance: 60 }));
  // A late delivery: two events a millisecond apart, 40 points apart.
  assert.equal(c.sample({ fromTop: 200, time: 1000 }), null);
  assert.equal(c.sample({ fromTop: 240, time: 1001 }), null);
  assert.equal(c.collapsed, false);
});

test("a tap that brings the bar back lets the next flick collapse it again", () => {
  const c = createScrollCollapse();
  run(c, moving({ from: 100, speed: 1500, distance: 200 }));
  assert.equal(c.collapsed, true);
  c.assume(false);
  assert.equal(c.collapsed, false);
  assert.deepEqual(run(c, moving({ from: 300, speed: 1500, distance: 100, start: 3000 })).map((x) => x.change), ["collapse"]);
});

test("reset starts over with the whole bar", () => {
  const c = createScrollCollapse();
  run(c, moving({ from: 100, speed: 1500, distance: 200 }));
  c.reset();
  assert.equal(c.collapsed, false);
});

test("the thresholds can be tuned", () => {
  const c = createScrollCollapse({ ...SCROLL_COLLAPSE, collapseSpeed: 400 });
  assert.deepEqual(run(c, moving({ from: 100, speed: 500, distance: 200 })).map((x) => x.change), ["collapse"]);
});
