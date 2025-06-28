import { TriggerContext } from "@devvit/public-api";
import { addDays, addMinutes, subMinutes } from "date-fns";
import { POINTS_STORE_KEY } from "./thanksPoints.js";
import { CronExpressionParser } from "cron-parser";
import { ADHOC_CLEANUP_JOB, CLEANUP_JOB_CRON } from "./constants.js";
import { logger } from "./logger.js";

const CLEANUP_LOG_KEY = "cleanupStore";
const DAYS_BETWEEN_CHECKS = 28;

export async function setCleanupForUsers(usernames: string[], context: TriggerContext) {
    if (usernames.length === 0) {
        logger.debug("No usernames passed to setCleanupForUsers.");
        return;
    }

    await context.redis.zAdd(
        CLEANUP_LOG_KEY,
        ...usernames.map(username => ({
            member: username,
            score: addDays(new Date(), DAYS_BETWEEN_CHECKS).getTime(),
        }))
    );

    logger.info(`Scheduled cleanup for ${usernames.length} users.`);
}

async function userActive(username: string, context: TriggerContext): Promise<boolean> {
    try {
        const user = await context.reddit.getUserByUsername(username);
        return !!user;
    } catch {
        logger.warn(`Failed to retrieve user: u/${username} — assuming deleted or suspended.`);
        return false;
    }
}

interface UserActive {
    username: string;
    isActive: boolean;
}

export async function cleanupDeletedAccounts(_: unknown, context: TriggerContext) {
    logger.info("Starting cleanupDeletedAccounts job...");

    const now = new Date().getTime();
    const items = await context.redis.zRange(CLEANUP_LOG_KEY, 0, now, { by: "score" });

    if (items.length === 0) {
        logger.info("No users scheduled for cleanup. Scheduling next adhoc check...");
        await scheduleAdhocCleanup(context);
        return;
    }

    await context.reddit.getAppUser(); // Ensure Reddit is reachable

    const itemsToCheck = 50;
    const usersToCheck = items.slice(0, itemsToCheck).map(item => item.member);

    logger.debug("Checking activity for users:", { usersToCheck });

    const userStatuses: UserActive[] = [];
    for (const username of usersToCheck) {
        const isActive = await userActive(username, context);
        userStatuses.push({ username, isActive });
    }

    const activeUsers = userStatuses.filter(u => u.isActive).map(u => u.username);
    const deletedUsers = userStatuses.filter(u => !u.isActive).map(u => u.username);

    logger.info("Cleanup results", {
        totalChecked: userStatuses.length,
        activeCount: activeUsers.length,
        deletedCount: deletedUsers.length,
    });

    if (activeUsers.length > 0) {
        await setCleanupForUsers(activeUsers, context);
    }

    if (deletedUsers.length > 0) {
        await context.redis.zRem(POINTS_STORE_KEY, deletedUsers);
        await context.redis.zRem(CLEANUP_LOG_KEY, deletedUsers);

        logger.info(`Removed ${deletedUsers.length} deleted users from Redis and leaderboard.`);

        await context.scheduler.runJob({
            name: "updateLeaderboard",
            runAt: new Date(),
            data: { reason: "One or more deleted accounts removed from database" },
        });
    }

    if (items.length > itemsToCheck) {
        logger.info("Backlog detected — scheduling next cleanup immediately.");
        await context.scheduler.runJob({
            name: "cleanupDeletedAccounts",
            runAt: new Date(),
        });
    } else {
        await scheduleAdhocCleanup(context);
    }
}

export async function populateCleanupLogAndScheduleCleanup(context: TriggerContext) {
    logger.info("Running populateCleanupLogAndScheduleCleanup...");

    const scoreUsers = (await context.redis.zRange(POINTS_STORE_KEY, 0, -1)).map(u => u.member);
    const cleanupUsers = (await context.redis.zRange(CLEANUP_LOG_KEY, 0, -1)).map(u => u.member);

    const toAdd = scoreUsers.filter(u => !cleanupUsers.includes(u));
    const toRemove = cleanupUsers.filter(u => !scoreUsers.includes(u));

    if (toAdd.length > 0) {
        await context.redis.zAdd(
            CLEANUP_LOG_KEY,
            ...toAdd.map(username => ({
                member: username,
                score: addMinutes(new Date(), Math.random() * 60 * 24 * DAYS_BETWEEN_CHECKS).getTime(),
            }))
        );
        logger.info(`Added ${toAdd.length} new users to cleanup log.`);
    }

    if (toRemove.length > 0) {
        await context.redis.zRem(CLEANUP_LOG_KEY, toRemove);
        logger.info(`Removed ${toRemove.length} obsolete users from cleanup log.`);
    }

    const redisKey = "prevTimeBetweenChecks";
    const prev = await context.redis.get(redisKey);
    const newValue = JSON.stringify(DAYS_BETWEEN_CHECKS);

    if (newValue !== prev && cleanupUsers.length > 0) {
        await context.redis.zAdd(
            CLEANUP_LOG_KEY,
            ...cleanupUsers.map(username => ({
                member: username,
                score: addMinutes(new Date(), Math.random() * 60 * 24 * DAYS_BETWEEN_CHECKS).getTime(),
            }))
        );
        logger.info(`Rescheduled ${cleanupUsers.length} users in cleanup log due to check interval change.`);
        await context.redis.set(redisKey, newValue);
    }

    const jobs = await context.scheduler.listJobs();
    const adhocJobs = jobs.filter(job => job.name === ADHOC_CLEANUP_JOB);
    await Promise.all(adhocJobs.map(job => context.scheduler.cancelJob(job.id)));

    logger.debug(`Cancelled ${adhocJobs.length} existing adhoc cleanup jobs.`);

    await scheduleAdhocCleanup(context);
}

export async function scheduleAdhocCleanup(context: TriggerContext) {
    const nextEntries = await context.redis.zRange(CLEANUP_LOG_KEY, 0, 0, { by: "rank" });

    if (nextEntries.length === 0) {
        logger.debug("No entries in cleanup log for scheduling adhoc cleanup.");
        return;
    }

    const nextCleanupTime = new Date(nextEntries[0].score);
    const nextAdhocTime = addMinutes(nextCleanupTime, 5);
    const nextScheduledTime = CronExpressionParser.parse(CLEANUP_JOB_CRON).next().toDate();

    if (nextAdhocTime < subMinutes(nextScheduledTime, 5)) {
        logger.info("Scheduling adhoc cleanup job.", {
            runAt: nextAdhocTime.toUTCString(),
        });
        await context.scheduler.runJob({
            name: ADHOC_CLEANUP_JOB,
            runAt: nextAdhocTime < new Date() ? new Date() : nextAdhocTime,
        });
    } else {
        logger.info("Adhoc cleanup not needed. Scheduled cleanup is soon.", {
            nextCleanupLogTime: nextCleanupTime.toUTCString(),
            nextScheduledTime: nextScheduledTime.toUTCString(),
        });
    }
}
