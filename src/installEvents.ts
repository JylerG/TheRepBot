import { TriggerContext, Devvit } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { populateCleanupLogAndScheduleCleanup } from "./cleanupTasks.js";
import { CLEANUP_JOB, CLEANUP_JOB_CRON } from "./constants.js";
import { AppSetting } from "./settings.js";
import { logger } from "./logger.js";
import { TIMEFRAMES } from "./leaderboard.js"; // assumes you export ["daily", "weekly", "monthly", "yearly"]

// Handle first-time installation
export async function onAppFirstInstall(
    _: AppInstall,
    context: TriggerContext
) {
    await context.redis.set("InstallDate", new Date().getTime().toString());
    await onAppInstallOrSettingsUpdate(context);
}

// Register leaderboard reset jobs for each timeframe
for (const timeframe of TIMEFRAMES) {
    Devvit.addSchedulerJob({
        name: `reset_${timeframe}_leaderboard`,
        onRun: async (_, context) => {
            await context.redis.zRemRangeByRank(
                `thanksPointsStore:${timeframe}`,
                0,
                -1
            );
        },
    });
}

// Main setup logic on install/upgrade/settings change
export async function onAppInstallOrSettingsUpdate(context: TriggerContext) {
    const settings = await context.settings.getAll();
    const scoreboardWikiPage =
        (settings[AppSetting.ScoreboardLink] as string) ?? "leaderboards";

    await context.redis.set(AppSetting.ScoreboardLink, scoreboardWikiPage);
    logger.info(`✅ Scoreboard link set to: ${scoreboardWikiPage}`);

    // Schedule leaderboard resets
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        cron: "0 0 * * *", // Every day at 00:00 UTC
    });

    await Promise.all(
        TIMEFRAMES.map((timeframe: string) => {
            let cron: string | undefined;

            switch (timeframe) {
                case "daily":
                    cron = "0 0 * * *";
                    break;
                case "weekly":
                    cron = "0 0 * * 0";
                    break;
                case "monthly":
                    cron = "0 0 1 * *";
                    break;
                case "yearly":
                    cron = "0 0 1 1 *";
                    break;
                default:
                    return; // skip unknown timeframes
            }

            return context.scheduler.runJob({
                name: `reset_${timeframe}_leaderboard`,
                cron,
            });
        }).filter(Boolean) // filter out undefined from `.map()` if any
    );
}

// Called on install or upgrade
export async function onAppInstallOrUpgrade(
    _: AppInstall | AppUpgrade,
    context: TriggerContext
) {
    const currentJobs = await context.scheduler.listJobs();

    // Cancel old jobs
    await Promise.all(
        currentJobs.map((job) => context.scheduler.cancelJob(job.id))
    );

    // Reconfigure scheduling
    await onAppInstallOrSettingsUpdate(context);

    // Schedule cleanup job
    await context.scheduler.runJob({
        name: CLEANUP_JOB,
        cron: CLEANUP_JOB_CRON,
    });

    // Run cleanup logic now
    await populateCleanupLogAndScheduleCleanup(context);

    // Trigger an immediate leaderboard update
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: { reason: "TheRepBot was installed or upgraded." },
    });
}
