// One bucket of the answered/unanswered question series. The hub endpoint and the platform-admin
// endpoint both return this shape, so both feed the same chart.
export type QuestionsByAnswered = {
  date: string;
  answered: number;
  unanswered: number;
};

// One bucket of the contributions series. `new` counts contributions that were their end-user's
// first ever, so it is also the number of first-time contributors in the bucket.
export type ContributionsByContributor = {
  date: string;
  new: number;
  returning: number;
};
