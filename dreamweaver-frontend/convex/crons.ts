import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

crons.daily(
  "purge-expired-trashed-storyboards",
  {
    hourUTC: 3,
    minuteUTC: 30,
  },
  internal.storyboards.purgeExpiredTrashedStoryboardsInternal,
  { limit: 200 },
);

export default crons;

