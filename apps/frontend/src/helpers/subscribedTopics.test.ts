import { describe, expect, it } from "vitest";

import { ABSOLUTE_MIN_SUBSCRIBERS, audienceMin, hasEligibleAudience, selectStaleTopic, silentWeeks } from "@helpers/subscribedTopics";

import type { SubscribedTopic } from "@services/HubService";

const topic = (name: string, subscribers: number, documents: number[]): SubscribedTopic => ({
  id: name.length,
  name,
  subscribers,
  documents: Object.fromEntries(documents.map((count, week) => [`2026-06-${String(week + 1).padStart(2, '0')}`, count])),
});

const weeks = (silent: number, covered = 12 - silent) =>
  [...Array(covered).fill(1), ...Array(silent).fill(0)];

describe("silentWeeks", () => {
  it("counts the trailing weeks with no document", () => {
    expect(silentWeeks(topic("Quiet", 100, weeks(5)))).toBe(5);
    expect(silentWeeks(topic("Busy", 100, weeks(0)))).toBe(0);
  });

  it("reports the whole window when nothing was ever added", () => {
    expect(silentWeeks(topic("Empty", 100, Array(12).fill(0)))).toBe(12);
  });

  it("ignores gaps that are not at the end", () => {
    expect(silentWeeks(topic("Patchy", 100, [1, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0]))).toBe(2);
  });
});

describe("audienceMin", () => {
  it("never drops below the absolute floor, however small the audiences are", () => {
    expect(audienceMin([topic("A", 0, weeks(0)), topic("B", 1, weeks(0))])).toBe(ABSOLUTE_MIN_SUBSCRIBERS);
  });

  it("rises to the bottom quartile once audiences are bigger than the floor", () => {
    const topics = [100, 200, 300, 400, 500].map((count, index) => topic(`T${index}`, count, weeks(0)));

    expect(audienceMin(topics)).toBe(200);
  });
});

describe("selectStaleTopic", () => {
  it("picks the biggest audience among the topics that have gone quiet", () => {
    const chosen = selectStaleTopic([
      topic("Vaccine access", 480, weeks(5)),
      topic("Press freedom", 360, weeks(11)),
      topic("Elections", 900, weeks(0)),
    ]);

    expect(chosen?.name).toBe("Vaccine access");
  });

  it("breaks ties on the longest silence", () => {
    const chosen = selectStaleTopic([
      topic("Shorter", 480, weeks(3)),
      topic("Longer", 480, weeks(7)),
    ]);

    expect(chosen?.name).toBe("Longer");
  });

  it("ignores a topic quiet for less than the minimum streak", () => {
    expect(selectStaleTopic([topic("Vaccine access", 480, weeks(1))])).toBeUndefined();
  });

  it("ignores a topic that received nothing all quarter, however big its audience", () => {
    expect(selectStaleTopic([topic("Retired", 5000, Array(12).fill(0))])).toBeUndefined();
  });

  it("ignores a topic whose audience is below the floor", () => {
    expect(selectStaleTopic([topic("Vaccine access", ABSOLUTE_MIN_SUBSCRIBERS - 1, weeks(5))])).toBeUndefined();
  });

  it("ignores a topic below the hub's own quartile even when it clears the floor", () => {
    const chosen = selectStaleTopic([
      topic("Small but quiet", 30, weeks(9)),
      ...[400, 500, 600, 700].map((count, index) => topic(`Big ${index}`, count, weeks(0))),
    ]);

    expect(chosen).toBeUndefined();
  });
});

describe("hasEligibleAudience", () => {
  it("is false while every topic sits below the floor", () => {
    expect(hasEligibleAudience([topic("A", 0, weeks(5)), topic("B", ABSOLUTE_MIN_SUBSCRIBERS - 1, weeks(5))])).toBe(false);
  });

  it("is true once a topic reaches the floor, even if it is up to date", () => {
    expect(hasEligibleAudience([topic("A", ABSOLUTE_MIN_SUBSCRIBERS, weeks(0))])).toBe(true);
  });

  it("is false with no topics at all", () => {
    expect(hasEligibleAudience([])).toBe(false);
  });
});
