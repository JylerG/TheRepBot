import { Devvit, FormField } from "@devvit/public-api";
import { handleManualPointSetting, handleThanksEvent, manualSetPointsFormHandler } from "./thanksPoints.js";
import { appSettings, validateRegexJobHandler } from "./settings.js";
import { onAppFirstInstall, onAppInstallOrUpgrade } from "./installEvents.js";
import { updateLeaderboard } from "./leaderboard.js";
import { cleanupDeletedAccounts } from "./cleanupTasks.js";
import { backupAllScores, restoreForm, restoreFormHandler, showRestoreForm } from "./backupAndRestore.js";
import { leaderboardCustomPost, createCustomPostMenuHandler, customPostForm, createCustomPostFormHandler } from "./customPost/index.js";
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

// Devvit.addMenuItem({
//     label: "Backup TheRepBot Scores",
//     forUserType: "moderator",
//     location: "subreddit",
//     onPress: async (event, context) => {
//         await backupAllScores(event, context);
//     },
// });

// Devvit.addMenuItem({
//     label: "Restore TheRepBot Scores",
//     forUserType: "moderator",
//     location: "subreddit",
//     onPress: async (event, context) => {
//         await showRestoreForm(event, context);
//     },
// });

export const manualSetPointsForm = Devvit.createForm(
    (data) => ({ fields: data.fields as FormField[] }),
    async (event, context) => {
        await manualSetPointsFormHandler(event, context);
    }
);

Devvit.addMenuItem({
    label: "Set TheRepBot score manually",
    forUserType: "moderator",
    location: "comment",
    onPress: async (event, context) => {
        await handleManualPointSetting(event, context);
    },
});

export const restoreFormKey = Devvit.createForm(restoreForm, async (event, context) => {
    await restoreFormHandler(event, context);
});

Devvit.addCustomPostType(leaderboardCustomPost);

//TODO: Uncomment if custom post functionality becomes possible
// Devvit.addMenuItem({
//     label: "Submit Leaderboard Post",
//     forUserType: "moderator",
//     location: "subreddit",
//     onPress: async (event, context) => {
//         await createCustomPostMenuHandler(event, context);
//     },
// });

export const customPostFormKey = Devvit.createForm(customPostForm, createCustomPostFormHandler);

Devvit.configure({
    redditAPI: true,
    redis: true,
});

export default Devvit;
