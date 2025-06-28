import { TriggerContext } from "@devvit/public-api";
import { AppInstall, AppUpgrade } from "@devvit/protos";
import { populateCleanupLogAndScheduleCleanup } from "./cleanupTasks.js";
import { CLEANUP_JOB, CLEANUP_JOB_CRON } from "./constants.js";
import { AppSetting } from "./settings.js";

export async function onAppFirstInstall (_: AppInstall, context: TriggerContext) {
    await context.redis.set("InstallDate", new Date().getTime().toString());
    onAppInstallOrSettingsUpdate(context);
}

// Example: On app install or settings update
export async function onAppInstallOrSettingsUpdate(context: TriggerContext) {
  const settings = await context.settings.getAll();

  const subredditName = context.subredditId ?? "defaultSubreddit";
  const leaderboardWikiPage =
    (settings[AppSetting.LeaderboardWikiPage] as string) ?? "leaderboard";

  const scoreboardLink = `https://www.reddit.com/r/${subredditName}/wiki/${leaderboardWikiPage}`;

  await context.redis.set(AppSetting.ScoreboardLink, scoreboardLink);

  console.log("Scoreboard link set to:", scoreboardLink);
}

export async function onAppInstallOrUpgrade (_: AppInstall | AppUpgrade, context: TriggerContext) {
    const currentJobs = await context.scheduler.listJobs();
    onAppInstallOrSettingsUpdate(context);
    await Promise.all(currentJobs.map(job => context.scheduler.cancelJob(job.id)));

    await context.scheduler.runJob({
        name: CLEANUP_JOB,
        cron: CLEANUP_JOB_CRON,
    });

    await populateCleanupLogAndScheduleCleanup(context);

    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: { reason: "TheRepBot has been installed or upgraded." },
    });
}
