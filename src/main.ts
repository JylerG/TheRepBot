import { Devvit } from "@devvit/public-api";
import { handleThanksEvent } from "./thanksPoints.js";
import { appSettings, validateRegexJobHandler } from "./settings.js";
import { onAppFirstInstall, onAppInstallOrUpgrade } from "./installEvents.js";
import { updateLeaderboard } from "./leaderboard.js";
import { cleanupDeletedAccounts } from "./cleanupTasks.js";
import { ADHOC_CLEANUP_JOB, CLEANUP_JOB, UPDATE_LEADERBOARD_JOB, VALIDATE_REGEX_JOB } from "./constants.js";

Devvit.addSettings(appSettings);

Devvit.addTrigger({
    events: ["CommentSubmit", "CommentUpdate"],
    onEvent: async (event, context) => {
        await handleThanksEvent(event, context);
    },
});

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: async (event, context) => {
        await onAppFirstInstall(event, context);
    },
});

Devvit.addTrigger({
    events: ["AppInstall", "AppUpgrade"],
    onEvent: async (event, context) => {
        await onAppInstallOrUpgrade(event, context);
    },
});

Devvit.addSchedulerJob({
    name: UPDATE_LEADERBOARD_JOB,
    onRun: async (event, context) => {
        await updateLeaderboard(event, context);
    },
});

Devvit.addSchedulerJob({
    name: CLEANUP_JOB,
    onRun: async (event, context) => {
        await cleanupDeletedAccounts(event, context);
    },
});

Devvit.addSchedulerJob({
    name: ADHOC_CLEANUP_JOB,
    onRun: async (event, context) => {
        await cleanupDeletedAccounts(event, context);
    },
});

Devvit.addSchedulerJob({
    name: VALIDATE_REGEX_JOB,
    onRun: async (event, context) => {
        if (!event.data) {
            return;
        }
        await validateRegexJobHandler(event as typeof event & { data: NonNullable<typeof event.data> }, context);
    },
});

Devvit.configure({
    redditAPI: true,
    redis: true,
});

export default Devvit;
