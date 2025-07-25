import { TriggerContext } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { populateCleanupLogAndScheduleCleanup } from "./cleanupTasks.js";
import { CLEANUP_JOB, CLEANUP_JOB_CRON } from "./constants.js";
import { leaderboardKey, TIMEFRAMES } from "./leaderboard.js";
import { logger } from "./logger.js";

export async function onAppFirstInstall (_: AppInstall, context: TriggerContext) {
    await context.redis.set("InstallDate", new Date().getTime().toString());
}

export async function onAppInstallOrUpgrade (_: AppInstall | AppUpgrade, context: TriggerContext) {
    const currentJobs = await context.scheduler.listJobs();
    await Promise.all(currentJobs.map(job => context.scheduler.cancelJob(job.id)));

    await context.scheduler.runJob({
        name: CLEANUP_JOB,
        cron: CLEANUP_JOB_CRON,
    });

    await populateCleanupLogAndScheduleCleanup(context);

    const subredditName = await context.reddit.getCurrentSubreddit().then((s) => s.name);

    // 👀 Check if any leaderboard ZSET has data
    const keysToCheck = TIMEFRAMES.map((tf) => leaderboardKey(tf, subredditName));

    let hasLeaderboardData = false;

    for (const key of keysToCheck) {
        const count = await context.redis.zCard(key);
        if (count > 0) {
            hasLeaderboardData = true;
            break;
        }
    }

    if (hasLeaderboardData) {
        logger.info("📈 Leaderboard contains data — skipping updateLeaderboard job.");
        
    } else {
        logger.info("📉 No leaderboard data found — running updateLeaderboard job.");
        await context.scheduler.runJob({
            name: "updateLeaderboard",
            runAt: new Date(),
            data: { reason: "TheRepBot has been installed or upgraded." },
        });
        
    }
}