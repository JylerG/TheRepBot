import { TriggerContext } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { populateCleanupLogAndScheduleCleanup } from "./cleanupTasks.js";
import { CLEANUP_JOB, CLEANUP_JOB_CRON } from "./constants.js";
import { AppSetting } from "./settings.js";
import { logger } from "./logger.js";
import { Devvit } from "@devvit/public-api";

export async function onAppFirstInstall(
    _: AppInstall,
    context: TriggerContext
) {
    await context.redis.set("InstallDate", new Date().getTime().toString());
    await onAppInstallOrSettingsUpdate(context);
}

// Define the scheduled jobs for resetting each leaderboard
Devvit.addSchedulerJob({
    name: "reset_daily_leaderboard",
    onRun: async (_, context) => {
        await context.redis.zRemRangeByRank("thanksPointsStore:daily", 0, -1);
    },
});
Devvit.addSchedulerJob({
    name: "reset_weekly_leaderboard",
    onRun: async (_, context) => {
        await context.redis.zRemRangeByRank("thanksPointsStore:weekly", 0, -1);
    },
});
Devvit.addSchedulerJob({
    name: "reset_monthly_leaderboard",
    onRun: async (_, context) => {
        await context.redis.zRemRangeByRank("thanksPointsStore:monthly", 0, -1);
    },
});
Devvit.addSchedulerJob({
    name: "reset_yearly_leaderboard",
    onRun: async (_, context) => {
        await context.redis.zRemRangeByRank("thanksPointsStore:yearly", 0, -1);
    },
});

// Schedule the jobs on app install or settings update
export async function onAppInstallOrSettingsUpdate(context: TriggerContext) {
    const settings = await context.settings.getAll();

    const subredditName = context.subredditId ?? "defaultSubreddit";
    const scoreboardWikiPage =
        (settings[AppSetting.ScoreboardLink] as string) ?? "leaderboards";

    const scoreboardLink = `${scoreboardWikiPage}`;

    await context.redis.set(AppSetting.ScoreboardLink, scoreboardLink);
    logger.info(`Scoreboard link set to: ${scoreboardLink}`);

    // Schedule leaderboard resets
    await context.scheduler.runJob({
        name: "reset_daily_leaderboard",
        cron: "0 0 * * *", // Every day at midnight UTC
    });

    await context.scheduler.runJob({
        name: "reset_weekly_leaderboard",
        cron: "0 0 * * 0", // Every Sunday at midnight UTC (day of week = 0)
    });

    await context.scheduler.runJob({
        name: "reset_monthly_leaderboard",
        cron: "0 0 1 * *", // First day of the month at midnight UTC
    });

    await context.scheduler.runJob({
        name: "reset_yearly_leaderboard",
        cron: "0 0 1 1 *", // January 1st at midnight UTC
    });
}

export async function onAppInstallOrUpgrade(
    _: AppInstall | AppUpgrade,
    context: TriggerContext
) {
    const currentJobs = await context.scheduler.listJobs();
    await onAppInstallOrSettingsUpdate(context);

    // Cancel all existing scheduled jobs
    await Promise.all(
        currentJobs.map((job) => context.scheduler.cancelJob(job.id))
    );

    // Schedule the cleanup job as before
    await context.scheduler.runJob({
        name: CLEANUP_JOB,
        cron: CLEANUP_JOB_CRON,
    });

    // Schedule the leaderboard update job daily at 00:00 UTC
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        cron: "0 0 * * *", // every day at midnight UTC
    });

    await populateCleanupLogAndScheduleCleanup(context);

    // Run leaderboard update once immediately after install/upgrade
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: { reason: "TheRepBot has been installed or upgraded." },
    });
}
