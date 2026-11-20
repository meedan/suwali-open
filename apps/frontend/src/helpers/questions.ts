import type { QuestionsByAnswered } from '@customTypes/statistics';

export const askedIn = (week: QuestionsByAnswered) => week.answered + week.unanswered;

// Pooled totals, for a period covering several buckets
export const rateOf = (unanswered: number, asked: number) => asked > 0 ? (unanswered / asked) * 100 : 0;

export const unansweredRate = (week: QuestionsByAnswered) => rateOf(week.unanswered, askedIn(week));
