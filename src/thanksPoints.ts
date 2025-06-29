import {
    Context,
    FormOnSubmitEvent,
    JSONObject,
    MenuItemOnPressEvent,
    SettingsValues,
    TriggerContext,
    User,
    ScheduledJobEvent,
    WikiPage,
    WikiPagePermissionLevel,
} from "@devvit/public-api";
import { manualSetPointsForm } from "./main.js";
import { CommentSubmit, CommentUpdate } from "@devvit/protos";
import { getSubredditName, isModerator, replaceAll } from "./utility.js";
import { addWeeks } from "date-fns";
import {
    ExistingFlairOverwriteHandling,
    ReplyOptions,
    TemplateDefaults,
    AppSetting,
    LeaderboardMode,
} from "./settings.js";
import markdownEscape from "markdown-escape";
import { setCleanupForUsers } from "./cleanupTasks.js";
import { isLinkId } from "@devvit/shared-types/tid.js";
import { format } from "date-fns";
import { logger } from "./logger.js"; // Assuming you have a logger module

export const POINTS_STORE_KEY = "thanksPointsStore";
const TIMEFRAMES = ["daily", "weekly", "monthly", "yearly", "alltime"] as const;

function formatMessage(
    template: string,
    placeholders: Record<string, string>
): string {
    let result = template;
    for (const [key, value] of Object.entries(placeholders)) {
        const regex = new RegExp(`{{${key}}}`, "g");
        result = result.replace(regex, value);
    }
    return result;
}

async function replyToUser(
    context: TriggerContext,
    replyMode: ReplyOptions,
    toUserName: string,
    messageBody: string,
    commentId: string
) {
    if (replyMode === ReplyOptions.NoReply) return;

    if (replyMode === ReplyOptions.ReplyByPM) {
        const subredditName = await getSubredditName(context);
        try {
            await context.reddit.sendPrivateMessage({
                subject: `Message from TheRepBot on ${subredditName}`,
                text: messageBody,
                to: toUserName,
            });
            logger.info(`${commentId}: PM sent to ${toUserName}.`);
        } catch {
            logger.warn(
                `${commentId}: Error sending PM notification to ${toUserName}. User may only allow PMs from whitelisted users.`
            );
        }
    } else if (replyMode === ReplyOptions.ReplyAsComment) {
        // Reply by comment
        const newComment = await context.reddit.submitComment({
            id: commentId,
            text: messageBody,
        });
        logger.info(
            `${commentId}: Public comment reply left in reply to ${toUserName}`
        );

        // Notify in chat (e.g., log or a UI notification)
        // Here I add a logger.info as a chat notification example:
        logger.info(
            `Notification: User ${toUserName} was notified with a public comment reply.`
        );

        // If you have a chat or UI context where you want to send an immediate notification,
        // you can also invoke that here.
    }
}

async function getCurrentScore(
    user: User,
    context: TriggerContext,
    settings: SettingsValues
): Promise<{ currentScore: number; flairScoreIsNaN: boolean }> {
    const subredditName = await getSubredditName(context);
    const userFlair = await user.getUserFlairBySubreddit(subredditName);

    let scoreFromRedis: number | undefined;
    try {
        scoreFromRedis =
            (await context.redis.zScore(POINTS_STORE_KEY, user.username)) ?? 0;
    } catch {
        scoreFromRedis = 0;
    }

    let scoreFromFlair: number;
    const numberRegex = /^\d+$/;

    if (!userFlair?.flairText || userFlair.flairText === "-") {
        scoreFromFlair = 0;
    } else if (!numberRegex.test(userFlair.flairText)) {
        scoreFromFlair = NaN;
    } else {
        scoreFromFlair = parseInt(userFlair.flairText);
    }

    const flairScoreIsNaN = isNaN(scoreFromFlair);

    if (settings[AppSetting.PrioritiseScoreFromFlair] && !flairScoreIsNaN) {
        return { currentScore: scoreFromFlair, flairScoreIsNaN };
    }

    return {
        currentScore:
            !flairScoreIsNaN && scoreFromFlair > scoreFromRedis
                ? scoreFromFlair
                : scoreFromRedis,
        flairScoreIsNaN,
    };
}

async function setUserScore(
    username: string,
    newScore: number,
    flairScoreIsNaN: boolean,
    context: TriggerContext,
    settings: SettingsValues
) {
    // Store the user's new score in Redis sorted set
    await context.redis.zAdd(POINTS_STORE_KEY, {
        member: username,
        score: newScore,
    });
    logger.info(`Score updated for ${username}: ${newScore}`);

    // Queue user for cleanup checks in 24 hours
    await setCleanupForUsers([username], context);

    // Queue a leaderboard update job
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: {
            reason: `Awarded a point to ${username}. New score: ${newScore}`,
        },
    });

    // Handle flair updating according to settings
    const existingFlairOverwriteHandling = ((settings[
        AppSetting.ExistingFlairHandling
    ] as string[] | undefined) ?? [
        ExistingFlairOverwriteHandling.OverwriteNumeric,
    ])[0] as ExistingFlairOverwriteHandling;

    const shouldSetUserFlair =
        existingFlairOverwriteHandling !==
            ExistingFlairOverwriteHandling.NeverSet &&
        (!flairScoreIsNaN ||
            existingFlairOverwriteHandling ===
                ExistingFlairOverwriteHandling.OverwriteAll);

    if (shouldSetUserFlair) {
        logger.info(`Setting flair for ${username} to ${newScore}`);

        let cssClass = settings[AppSetting.CSSClass] as string | undefined;
        if (!cssClass) cssClass = undefined;

        let flairTemplate = settings[AppSetting.FlairTemplate] as
            | string
            | undefined;
        if (!flairTemplate) flairTemplate = undefined;

        if (flairTemplate && cssClass) {
            // Prioritize flair template over CSS class
            cssClass = undefined;
        }

        const subredditName = await getSubredditName(context);

        await context.reddit.setUserFlair({
            subredditName,
            username,
            cssClass,
            flairTemplateId: flairTemplate,
            text: newScore.toString(),
        });
    } else {
        logger.info(
            `${username}: Flair not set due to settings or flair state.`
        );
    }
}

async function getUserIsSuperuser(
    username: string,
    context: TriggerContext
): Promise<boolean> {
    const settings = await context.settings.getAll();

    const superUserSetting =
        (settings[AppSetting.SuperUsers] as string | undefined) ?? "";
    const superUsers = superUserSetting
        .split(",")
        .map((user) => user.trim().toLowerCase());

    if (superUsers.includes(username.toLowerCase())) {
        return true;
    }

    const autoSuperuserThreshold =
        (settings[AppSetting.AutoSuperuserThreshold] as number | undefined) ??
        0;

    if (autoSuperuserThreshold) {
        let user: User | undefined;
        try {
            user = await context.reddit.getUserByUsername(username);
        } catch {
            return false;
        }
        if (!user) {
            return false;
        }
        const { currentScore } = await getCurrentScore(user, context, settings);
        return currentScore >= autoSuperuserThreshold;
    } else {
        return false;
    }
}

export async function handleThanksEvent(
    event: CommentSubmit | CommentUpdate,
    context: TriggerContext
) {
    if (!event.comment || !event.post || !event.author || !event.subreddit)
        return;

    if (isLinkId(event.comment.parentId)) return; // No top-level comment awarding
    if (
        event.author.name === context.appName ||
        event.author.name === "AutoModerator"
    )
        return;

    const settings = await context.settings.getAll();
    const userCommandVal = settings[AppSetting.PointTriggerWords] as
        | string
        | undefined;
    const userCommandList =
        userCommandVal?.split("\n").map((cmd) => cmd.toLowerCase().trim()) ??
        [];
    const modCommand = settings[AppSetting.ModAwardCommand] as
        | string
        | undefined;

    let containsUserCommand: boolean;
    if (settings[AppSetting.ThanksCommandUsesRegex]) {
        const regexes = userCommandList.map(
            (command) => new RegExp(command, "i")
        );
        containsUserCommand = regexes.some((regex) =>
            event.comment ? regex.test(event.comment.body) : false
        );
    } else {
        containsUserCommand = userCommandList.some((command) =>
            event.comment && event.comment.body.toLowerCase().includes(command)
        );
    }

    const containsModCommand =
        modCommand &&
        event.comment.body
            .toLowerCase()
            .includes(modCommand.toLowerCase().trim());

    if (!containsUserCommand && !containsModCommand) return;

    logger.info(
        `${event.comment.id}: Comment from ${event.author.name} contains a reputation points command.`
    );

    // Blocked flairs
    const postFlairTextToIgnoreSetting =
        (settings[AppSetting.PostFlairTextToIgnore] as string) ?? "";
    if (postFlairTextToIgnoreSetting && event.post.linkFlair) {
        const blockedFlairs = postFlairTextToIgnoreSetting
            .split(",")
            .map((f) => f.trim().toLowerCase());
        const postFlair = event.post.linkFlair.text.toLowerCase();
        if (blockedFlairs.includes(postFlair)) {
            logger.info(
                `${event.comment.id}: Cannot award points to post with flair '${postFlair}'`
            );
            return;
        }
    }

    // Check mod/superuser status
    const isMod = await isModerator(
        context,
        event.subreddit.name,
        event.author.name
    );

    if (containsUserCommand && event.author.id !== event.post.authorId) {
        const accessControl = settings[AppSetting.AccessControl];
        const isEveryone =
            accessControl === "everyone" ||
            (Array.isArray(accessControl) && accessControl[0] === "everyone");
        if (!isEveryone) {
            logger.info(
                `${event.comment.id}: points attempt made by ${event.author.name} who is not the OP and access control is not 'everyone'.`
            );
            return;
        }
    } else if (containsModCommand) {
        const userIsSuperuser = await getUserIsSuperuser(
            event.author.name,
            context
        );
        if (!isMod && !userIsSuperuser) {
            logger.info(
                `${event.comment.id}: mod points attempt by ${event.author.name} who is neither a mod nor a superuser`
            );
            return;
        }
    }

    // Users who can't award points
    const blockedAwardersRaw = settings[AppSetting.UsersWhoCannotAwardPoints];
    const blockedAwarders =
        typeof blockedAwardersRaw === "string" && blockedAwardersRaw.length > 0
            ? blockedAwardersRaw.split(",").map((u) => u.trim().toLowerCase())
            : [];

    if (blockedAwarders.includes(event.author.name.toLowerCase())) {
        logger.info(
            `${event.comment.id}: ${event.author.name} is not permitted to award points.`
        );

        const notifyRaw = settings[AppSetting.NotifyOnError];
        const notify =
            typeof notifyRaw === "string" && Object.values(ReplyOptions).includes(notifyRaw as ReplyOptions)
                ? (notifyRaw as ReplyOptions)
                : ReplyOptions.NoReply;

        if (notify !== ReplyOptions.NoReply) {
            const messageRaw = settings[AppSetting.UsersWhoCannotAwardPointsMessage];
            const message =
                typeof messageRaw === "string"
                    ? messageRaw
                    : "You do not have permission to award points.";

            await replyToUser(
                context,
                notify,
                event.author.name,
                message,
                event.comment.id
            );
        }
        return;
    }

    const parentComment = await context.reddit.getCommentById(
        event.comment.parentId
    );

    if (!parentComment || parentComment.authorName === event.author.name) {
        logger.info(`${event.comment.id}: Self-award or invalid parent comment.`);

        const notifyRaw = settings[AppSetting.NotifyOnError];
        const notify =
            typeof notifyRaw === "string" && Object.values(ReplyOptions).includes(notifyRaw as ReplyOptions)
                ? (notifyRaw as ReplyOptions)
                : ReplyOptions.NoReply;

        if (notify !== ReplyOptions.NoReply) {
            const msgRaw = settings[AppSetting.SelfAwardMessage];
            const msg = typeof msgRaw === "string" ? msgRaw : "You can't award yourself a {{name}}.";

            const pointNameRaw = settings[AppSetting.PointName];
            const pointName = typeof pointNameRaw === "string" ? pointNameRaw : "point";

            const message = replaceAll(msg, "{{name}}", markdownEscape(pointName));

            await replyToUser(context, notify, event.author.name, message, event.comment.id);
        }
        return;
    }

    if (["AutoModerator", context.appName].includes(parentComment.authorName)) {
        logger.info(`${event.comment.id}: Can't award points to bot user.`);

        // Get notify option and safely cast to ReplyOptions enum or default
        const notifyRaw = settings[AppSetting.NotifyOnError];
        const notify =
            typeof notifyRaw === "string" && Object.values(ReplyOptions).includes(notifyRaw as ReplyOptions)
                ? (notifyRaw as ReplyOptions)
                : ReplyOptions.NoReply;

        if (notify !== ReplyOptions.NoReply) {
            const messageRaw = settings[AppSetting.BotAwardMessage];
            const message =
                typeof messageRaw === "string"
                    ? messageRaw
                    : "You can't award the bot a {{name}}.";

            await replyToUser(context, notify, event.author.name, message, event.comment.id);
        }

        return;
    }

    const excludedUsersRaw = settings[AppSetting.UsersWhoCannotBeAwardedPoints];
    const excludedUsers = 
        typeof excludedUsersRaw === "string"
        ? excludedUsersRaw.split(",").map((u) => u.trim().toLowerCase())
        : [];

    if (excludedUsers.includes(parentComment.authorName.toLowerCase())) {
        logger.info(`${event.comment.id}: ${parentComment.authorName} is on the exclusion list.`);

        const notifyRaw = settings[AppSetting.NotifyOnError];
        const notify =
            typeof notifyRaw === "string" && Object.values(ReplyOptions).includes(notifyRaw as ReplyOptions)
                ? (notifyRaw as ReplyOptions)
                : ReplyOptions.NoReply;

        if (notify !== ReplyOptions.NoReply) {
            let messageRaw = settings[AppSetting.UsersWhoCannotBeAwardedPointsMessage];
            const message =
                typeof messageRaw === "string"
                ? messageRaw
                : "Sorry, you cannot award points to {{awardee}} as they are excluded from receiving points.";

            const replacedMessage = replaceAll(
                message,
                "{{awardee}}",
                markdownEscape(parentComment.authorName)
            );

            await replyToUser(context, notify, event.author.name, replacedMessage, event.comment.id);
        }
        return;
    }

    // Prevent double-awards
    const redisKey = `thanks-${parentComment.id}-${event.author.name}`;
    const alreadyThanked = await context.redis.get(redisKey);

    if (alreadyThanked) {
        logger.info(`${event.comment.id}: Already awarded.`);

        // Get notify option safely as ReplyOptions enum
        let notifyRaw = settings[AppSetting.NotifyOnError];
        const notify =
            typeof notifyRaw === "string" &&
            Object.values(ReplyOptions).includes(notifyRaw as ReplyOptions)
                ? (notifyRaw as ReplyOptions)
                : ReplyOptions.NoReply;

        if (notify !== ReplyOptions.NoReply) {
            let messageRaw = settings[AppSetting.DuplicateAwardMessage];
            const message =
                typeof messageRaw === "string"
                    ? messageRaw
                    : "This user has already been awarded for this comment.";

            const formattedMessage = formatMessage(message, {
                awardee: parentComment.authorName,
                name: String(settings[AppSetting.PointName] ?? "point"),
            });

            await replyToUser(
                context,
                notify,
                event.author.name,
                formattedMessage,
                event.comment.id
            );
        }
        return;
    }

    // Add point
    const parentUser = await parentComment.getAuthor();
    if (!parentUser) return;

    const { currentScore, flairScoreIsNaN } = await getCurrentScore(
        parentUser,
        context,
        settings
    );
    const newScore = currentScore + 1;
    await setUserScore(
        parentComment.authorName,
        newScore,
        flairScoreIsNaN,
        context,
        settings
    );
    logger.info(
        `${event.comment.id}: Score for ${parentComment.authorName} is now ${newScore}`
    );

    // Set flair if enabled
    if (settings[AppSetting.SetPostFlairOnThanks]) {
        const text =
            typeof settings[AppSetting.SetPostFlairText] === "string" &&
            settings[AppSetting.SetPostFlairText]?.trim() !== ""
                ? settings[AppSetting.SetPostFlairText]
                : undefined;

        const cssClass =
            typeof settings[AppSetting.SetPostFlairCSSClass] === "string" &&
            settings[AppSetting.SetPostFlairCSSClass]?.trim() !== ""
                ? settings[AppSetting.SetPostFlairCSSClass]
                : undefined;

        const flairTemplateId =
            typeof settings[AppSetting.SetPostFlairTemplate] === "string" &&
            settings[AppSetting.SetPostFlairTemplate]?.trim() !== ""
                ? settings[AppSetting.SetPostFlairTemplate]
                : undefined;

        await context.reddit.setPostFlair({
            postId: event.post.id,
            subredditName: event.subreddit.name,
            text,
            cssClass,
            flairTemplateId,
        });
    }

    // Set Redis thank key with 1-week expiration
    await context.redis.set(redisKey, Date.now().toString(), {
        expiration: addWeeks(new Date(), 1),
    });

    // Notify user of success
    const rawNotify = settings[AppSetting.NotifyOnSuccess];
    const notify: ReplyOptions = Object.values(ReplyOptions).includes(
        rawNotify as ReplyOptions
    )
        ? (rawNotify as ReplyOptions)
        : ReplyOptions.NoReply;

    if (notify !== ReplyOptions.NoReply) {
        let message = String(
            settings[AppSetting.SuccessMessage] ??
                "+1 {{name}} awarded to u/{{awardee}} by u/{{awarder}}. Total: {{total}}{{symbol}}. Scoreboard is located [here]({{scoreboard}})"
        );
        await replyToUser(
            context,
            notify,
            event.author.name,
            message,
            event.comment.id
        );
    }

    // ⬇️ Trigger leaderboard update immediately after awarding a point
    await updateLeaderboard(
        {
            name: "manual-update", // or appropriate event name string
            data: { reason: "Point awarded" },
        },
        context as unknown as Context
    );
}

function leaderboardKey(timeframe: string): string {
    return timeframe === "alltime"
        ? POINTS_STORE_KEY
        : `thanksPointsStore:${timeframe}`;
}

function expirationFor(timeframe: string): Date {
    const now = new Date();
    const utcNow = new Date(
        Date.UTC(
            now.getUTCFullYear(),
            now.getUTCMonth(),
            now.getUTCDate(),
            now.getUTCHours(),
            now.getUTCMinutes(),
            now.getUTCSeconds()
        )
    );

    switch (timeframe) {
        case "daily": {
            const tomorrow = new Date(utcNow);
            tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
            tomorrow.setUTCHours(0, 0, 0, 0);
            return tomorrow;
        }
        case "weekly": {
            const dayOfWeek = utcNow.getUTCDay();
            const daysUntilMonday = (8 - dayOfWeek) % 7 || 7;
            const nextMonday = new Date(utcNow);
            nextMonday.setUTCDate(nextMonday.getUTCDate() + daysUntilMonday);
            nextMonday.setUTCHours(0, 0, 0, 0);
            return nextMonday;
        }
        case "monthly": {
            return new Date(
                Date.UTC(utcNow.getUTCFullYear(), utcNow.getUTCMonth() + 1, 1)
            );
        }
        case "yearly": {
            return new Date(Date.UTC(utcNow.getUTCFullYear() + 1, 0, 1));
        }
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }
}

export async function updateLeaderboard(
    event: ScheduledJobEvent<JSONObject | undefined>,
    context: Context
) {
    logger.info("Leaderboard update job started.");

    const settings = await context.settings.getAll();
    logger.debug("Leaderboard: Settings loaded", settings);

    const leaderboardMode = settings[AppSetting.LeaderboardMode] as
        | string[]
        | undefined;
    if (!leaderboardMode || leaderboardMode[0] === LeaderboardMode.Off) {
        logger.info("Leaderboard mode is OFF. Exiting.");
        return;
    }

    const wikiPageName = settings[AppSetting.LeaderboardWikiPage] as
        | string
        | undefined;
    if (!wikiPageName) {
        logger.warn("No wiki page name configured. Exiting.");
        return;
    }

    const leaderboardSize =
        (settings[AppSetting.LeaderboardSize] as number) ?? 10;
    const pointName = (settings[AppSetting.PointName] as string) ?? "point";
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";

    const subredditName = await getSubredditName(context);
    if (!subredditName) {
        logger.error("Could not determine subreddit name.");
        return;
    }

    const now = new Date();
    const formattedDate = format(now, "MM/dd/yyyy HH:mm:ss");
    logger.debug("Updating leaderboard", { subredditName, formattedDate });

    let markdown = `# Leaderboards for r/${subredditName}\n`;

    const helpPage = settings[AppSetting.LeaderboardHelpPage] as
        | string
        | undefined;
    if (helpPage) {
        markdown += `*See [how the ${pointName}s system works](https://www.reddit.com/r/${subredditName}/wiki/${helpPage})*\n\n`;
    }

    async function getTopScores(key: string, leaderboardSize: number) {
        const zRangeResults = await context.redis.zRange(
            key,
            0,
            leaderboardSize - 1,
            {
                reverse: true,
                by: "rank",
                limit: {
                    offset: 0,
                    count: leaderboardSize,
                },
            }
        );

        const entries: { member: string; score: number }[] = [];
        for (const result of zRangeResults) {
            entries.push({ member: result.member, score: result.score });
        }

        return entries;
    }

    function formatLeaderboardSection(
        title: string,
        entries: { member: string; score: number }[]
    ) {
        let text = `## ${title}\n\n| Rank | User | ${pointName}${
            pointName.endsWith("s") ? "" : "s"
        } ${pointSymbol}|\n|:-|:-|:-:|\n`;
        entries.forEach((entry, i) => {
            const rank = i + 1;
            const userMarkdown = `u/${entry.member}`;
            text += `| ${rank} | ${userMarkdown} | ${entry.score} |\n`;
        });
        text += "\n";
        return text;
    }

    const allTimeEntries = await getTopScores(
        leaderboardKey("alltime"),
        leaderboardSize
    );
    markdown += formatLeaderboardSection(
        "All-Time Leaderboard",
        allTimeEntries
    );

    const dailyEntries = await getTopScores(
        leaderboardKey("daily"),
        leaderboardSize
    );
    markdown += formatLeaderboardSection("Daily Leaderboard", dailyEntries);

    const weeklyEntries = await getTopScores(
        leaderboardKey("weekly"),
        leaderboardSize
    );
    markdown += formatLeaderboardSection("Weekly Leaderboard", weeklyEntries);

    const monthlyEntries = await getTopScores(
        leaderboardKey("monthly"),
        leaderboardSize
    );
    markdown += formatLeaderboardSection("Monthly Leaderboard", monthlyEntries);

    const yearlyEntries = await getTopScores(
        leaderboardKey("yearly"),
        leaderboardSize
    );
    markdown += formatLeaderboardSection("Yearly Leaderboard", yearlyEntries);

    try {
        await context.reddit.updateWikiPage({
            subredditName,
            page: wikiPageName,
            content: markdown,
            reason: `Automated leaderboard update at ${formattedDate}`,
        });
        logger.info("Leaderboard updated successfully.");
    } catch (error) {
        logger.error("Failed to update leaderboard wiki page:", { error });
    }
}

export async function handleManualPointSetting(
    event: MenuItemOnPressEvent,
    context: Context
) {
    const comment = await context.reddit.getCommentById(event.targetId);
    let user: User | undefined;
    try {
        user = await context.reddit.getUserByUsername(comment.authorName);
    } catch {
        //
    }

    if (!user) {
        context.ui.showToast("Cannot set points. User may be shadowbanned.");
        return;
    }

    const settings = await context.settings.getAll();
    const { currentScore } = await getCurrentScore(user, context, settings);

    const fields = [
        {
            name: "newScore",
            type: "number",
            defaultValue: currentScore,
            label: `Enter a new score for ${comment.authorName}`,
            helpText:
                "Warning: This will overwrite the score that currently exists",
            multiSelect: false,
            required: true,
        },
    ];

    context.ui.showForm(manualSetPointsForm, { fields });
}

export async function manualSetPointsFormHandler(
    event: FormOnSubmitEvent<JSONObject>,
    context: Context
) {
    if (!context.commentId) {
        context.ui.showToast("An error occurred setting the user's score.");
        return;
    }

    const newScore = event.values.newScore as number | undefined;
    if (!newScore) {
        context.ui.showToast("You must enter a new score");
        return;
    }

    const comment = await context.reddit.getCommentById(context.commentId);

    let user: User | undefined;
    try {
        user = await context.reddit.getUserByUsername(comment.authorName);
    } catch {
        //
    }

    if (!user) {
        context.ui.showToast("Cannot set points. User may be shadowbanned.");
        return;
    }

    const settings = await context.settings.getAll();

    const { flairScoreIsNaN } = await getCurrentScore(user, context, settings);
    await setUserScore(
        comment.authorName,
        newScore,
        flairScoreIsNaN,
        context,
        settings
    );

    context.ui.showToast(`Score for ${comment.authorName} is now ${newScore}`);
}

