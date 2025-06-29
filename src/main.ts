import { Devvit, FormField } from "@devvit/public-api";
import { handleManualPointSetting, handleThanksEvent, manualSetPointsFormHandler } from "./thanksPoints.js";
import { appSettings, validateRegexJobHandler } from "./settings.js";
import { onAppFirstInstall, onAppInstallOrUpgrade } from "./installEvents.js";
import { updateLeaderboard } from "./leaderboard.js";
import { cleanupDeletedAccounts } from "./cleanupTasks.js";
import { backupAllScores, restoreForm, restoreFormHandler, showRestoreForm } from "./backupAndRestore.js";
import { leaderboardCustomPost, createCustomPostMenuHandler, customPostForm, createCustomPostFormHandler } from "./customPost/index.js";
import { ADHOC_CLEANUP_JOB, CLEANUP_JOB, UPDATE_LEADERBOARD_JOB, VALIDATE_REGEX_JOB } from "./constants.js";
import { logger } from "./logger.js";

logger.info("Bootstrapping TheRepBot main.ts...");

Devvit.addSettings(appSettings);
logger.info("Settings registered.");

Devvit.addTrigger({
    events: ["CommentSubmit", "CommentUpdate"],
    onEvent: async (event, context) => {
        logger.debug("Trigger: Comment event received", { event });
        await handleThanksEvent(event, context);
    },
});

Devvit.addTrigger({
    event: "AppInstall",
    onEvent: async (event, context) => {
        logger.info("Trigger: AppInstall");
        await onAppFirstInstall(event, context);
    },
});

Devvit.addTrigger({
    events: ["AppInstall", "AppUpgrade"],
    onEvent: async (event, context) => {
        logger.info("Trigger: AppInstall or AppUpgrade");
        await onAppInstallOrUpgrade(event, context);
    },
});

Devvit.addSchedulerJob({
    name: UPDATE_LEADERBOARD_JOB,
    onRun: async (event, context) => {
        logger.info("Job: Updating leaderboard", { event });
        await updateLeaderboard(event, context);
    },
});

Devvit.addSchedulerJob({
    name: CLEANUP_JOB,
    onRun: async (event, context) => {
        logger.info("Job: Cleanup deleted accounts", { event });
        await cleanupDeletedAccounts(event, context);
    },
});

Devvit.addSchedulerJob({
    name: ADHOC_CLEANUP_JOB,
    onRun: async (event, context) => {
        logger.info("Job: Adhoc cleanup run", { event });
        await cleanupDeletedAccounts(event, context);
    },
});

Devvit.addSchedulerJob({
    name: VALIDATE_REGEX_JOB,
    onRun: async (event, context) => {
        logger.info("Job: Validate regex patterns", { event });
        if (!event.data) {
            logger.error("Job: Validate regex patterns - event.data is undefined");
            return;
        }
        await validateRegexJobHandler(event as typeof event & { data: NonNullable<typeof event.data> }, context);
    },
});

Devvit.addMenuItem({
    label: "Backup TheRepBot Scores",
    forUserType: "moderator",
    location: "subreddit",
    onPress: async (event, context) => {
        logger.info("Menu: Backup scores clicked", { context });
        await backupAllScores(event, context);
    },
});

Devvit.addMenuItem({
    label: "Restore TheRepBot Scores",
    forUserType: "moderator",
    location: "subreddit",
    onPress: async (event, context) => {
        logger.info("Menu: Restore scores clicked", { context });
        await showRestoreForm(event, context);
    },
});

export const manualSetPointsForm = Devvit.createForm(
    (data) => ({ fields: data.fields as FormField[] }),
    async (event, context) => {
        logger.info("Form: Manual set points submitted");
        await manualSetPointsFormHandler(event, context);
    }
);

Devvit.addMenuItem({
    label: "Set TheRepBot score manually",
    forUserType: "moderator",
    location: "comment",
    onPress: async (event, context) => {
        logger.info("Menu: Manual point setting opened");
        await handleManualPointSetting(event, context);
    },
});

export const restoreFormKey = Devvit.createForm(restoreForm, async (event, context) => {
    logger.info("Form: Restore submitted");
    await restoreFormHandler(event, context);
});

Devvit.addCustomPostType(leaderboardCustomPost);

Devvit.addMenuItem({
    label: "Submit Leaderboard Post",
    forUserType: "moderator",
    location: "subreddit",
    onPress: async (event, context) => {
        logger.info("Menu: Submit leaderboard post");
        await createCustomPostMenuHandler(event, context);
    },
});

export const customPostFormKey = Devvit.createForm(customPostForm, createCustomPostFormHandler);

Devvit.configure({
    redditAPI: true,
    redis: true,
});

logger.info("TheRepBot successfully configured.");
export default Devvit;
