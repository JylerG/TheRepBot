import {
    Context,
    FormOnSubmitEvent,
    JSONObject,
    MenuItemOnPressEvent,
    ScheduledJobEvent,
    SettingsValues,
    TriggerContext,
    User,
    WikiPagePermissionLevel,
} from "@devvit/public-api";
import { CommentSubmit, CommentUpdate } from "@devvit/protos";
import { getSubredditName, isModerator, replaceAll } from "./utility.js";
import {
    addWeeks,
    format,
    startOfWeek,
    startOfMonth,
    startOfYear,
} from "date-fns";
import {
    ExistingFlairOverwriteHandling,
    AppSetting,
    PointAwardedReplyOptions,
    NotifyOnErrorReplyOptions,
    TemplateDefaults,
    NotifyUsersWhoCannotAwardPointsReplyOptions,
} from "./settings.js";
import { setCleanupForUsers } from "./cleanupTasks.js";
import { isLinkId } from "@devvit/shared-types/tid.js";
import { manualSetPointsForm } from "./main.js";
import { LeaderboardMode } from "./settings.js";
import { logger } from "./logger.js";

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

    const footer =
        "\n\n---\n\n^(I am a bot - please contact the mods with any questions)";
    if (
        !result
            .trim()
            .endsWith(
                "^(I am a bot - please contact the mods with any questions)"
            )
    ) {
        result = result.trim() + footer;
    }

    return result;
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
    // ✅ Store score in Redis
    await context.redis.zAdd(POINTS_STORE_KEY, {
        member: username,
        score: newScore,
    });

    // ✅ Schedule cleanup
    await setCleanupForUsers([username], context);

    // ✅ Schedule leaderboard job
    await context.scheduler.runJob({
        name: "updateLeaderboard",
        runAt: new Date(),
        data: {
            reason: `Awarded a point to ${username}. New score: ${newScore}`,
        },
    });

    // ✅ Flair handling settings
    const flairSetting = ((settings[AppSetting.ExistingFlairHandling] as
        | string[]
        | undefined) ?? [
        ExistingFlairOverwriteHandling.OverwriteNumeric,
    ])[0] as ExistingFlairOverwriteHandling;

    const shouldSetUserFlair =
        flairSetting !== ExistingFlairOverwriteHandling.NeverSet &&
        (!flairScoreIsNaN ||
            flairSetting === ExistingFlairOverwriteHandling.OverwriteAll);

    if (!shouldSetUserFlair) return;

    // ✅ Read flair styling preferences
    let cssClass = settings[AppSetting.CSSClass] as string | undefined;
    let flairTemplate = settings[AppSetting.FlairTemplate] as
        | string
        | undefined;

    if (!cssClass) cssClass = undefined;
    if (!flairTemplate) flairTemplate = undefined;
    if (cssClass && flairTemplate) cssClass = undefined; // Template takes priority

    // ✅ Apply symbol if OverwriteNumericSymbol is selected
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
    const flairText =
        flairSetting === ExistingFlairOverwriteHandling.OverwriteNumericSymbol
            ? `${newScore}${pointSymbol}`
            : `${newScore}`;

    const subredditName = await getSubredditName(context);

    await context.reddit.setUserFlair({
        subredditName,
        username,
        cssClass,
        flairTemplateId: flairTemplate,
        text: flairText,
    });
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
    logger.debug("✅ Event triggered", {
        commentId: event.comment?.id,
        postId: event.post?.id,
        author: event.author?.name,
        subreddit: event.subreddit?.name,
    });

    if (!event.comment || !event.post || !event.author || !event.subreddit) {
        logger.warn("❌ Missing comment, post, author, or subreddit");
        return;
    }

    if (isLinkId(event.comment.parentId)) {
        logger.debug("❌ Parent ID is a link — ignoring.");
        return;
    }

    const settings = await context.settings.getAll();

    // ✅ Disallowed user check
    const notifySetting =
        (
            settings[AppSetting.NotifyUsersWhoCannotAwardPoints] as
                | string[]
                | undefined
        )?.[0] ?? NotifyUsersWhoCannotAwardPointsReplyOptions.NoReply;

    const cannotAwardMessage =
        (settings[AppSetting.UsersWhoCannotAwardPointsMessage] as
            | string
            | undefined) ?? TemplateDefaults.UsersWhoCannotAwardPointsMessage;

    let disallowedUsersRaw = settings[AppSetting.UsersWhoCannotAwardPoints];

    let disallowedUsers: string[] = [];

    if (Array.isArray(disallowedUsersRaw)) {
        disallowedUsers = disallowedUsersRaw;
    } else if (typeof disallowedUsersRaw === "string") {
        // If it's a string, split by newlines and trim
        disallowedUsers = disallowedUsersRaw
            .split("\n")
            .map((u) => u.trim())
            .filter(Boolean);
    } else {
        // fallback empty array if undefined or unexpected type
        disallowedUsers = [];
    }

    const authorName = event.author.name.toLowerCase();
    const userCannotAwardPoints = disallowedUsers
        .map((u) => u.toLowerCase())
        .includes(authorName);

    if (userCannotAwardPoints) {
        logger.warn("❌ Author is disallowed from awarding points", {
            authorName,
        });

        try {
            const template =
                (settings[
                    AppSetting.NotifyUsersWhoCannotAwardPoints
                ] as string) ??
                TemplateDefaults.UsersWhoCannotBeAwardedPointsMessage;
            const cannotAwardMessage = formatMessage(template, {});
            switch (notifySetting) {
                case NotifyUsersWhoCannotAwardPointsReplyOptions.ReplyAsComment:
                    await context.reddit.submitComment({
                        id: event.comment.id,
                        text: cannotAwardMessage,
                    });
                    logger.info("⚠️ Disallowed comment reply sent");
                    break;
                case NotifyUsersWhoCannotAwardPointsReplyOptions.ReplyByPM:
                    await context.reddit.sendPrivateMessage({
                        to: event.author.name,
                        subject: `You cannot award points`,
                        text: cannotAwardMessage,
                    });
                    logger.info("⚠️ Disallowed PM sent");
                    break;
            }
        } catch (err) {
            logger.error("❌ Failed to notify disallowed user", { err });
        }

        return;
    }

    // Continue with your original logic
    const userCommandVal = settings[AppSetting.PointTriggerWords] as string;
    const userCommandList =
        userCommandVal?.split("\n").map((cmd) => cmd.toLowerCase().trim()) ??
        [];
    const modCommand = settings[AppSetting.ModAwardCommand] as
        | string
        | undefined;

    const allCommands = [...userCommandList];
    if (modCommand) allCommands.push(modCommand.toLowerCase().trim());

    const commentBody = event.comment?.body.toLowerCase() ?? "";

    const isSystemAuthor =
        event.author.name === context.appName ||
        event.author.name === "AutoModerator";

    const commentContainsCommand = allCommands.some((cmd) =>
        commentBody.includes(cmd)
    );

    if (isSystemAuthor && commentContainsCommand) {
        logger.debug("❌ System user attempted a command", {
            author: event.author.name,
        });
        return;
    }

    const accessControl =
        ((settings[AppSetting.AccessControl] as string[]) ?? [])[0] ??
        "moderators-only";

    const isMod = await isModerator(
        context,
        event.subreddit.name,
        event.author.name
    );
    const approvedUsers = ((settings[AppSetting.SuperUsers] as string) ?? "")
        .split("\n")
        .map((u) => u.trim().toLowerCase())
        .filter(Boolean);
    const isApprovedUser = approvedUsers.includes(authorName);
    const isOP = event.author.id === event.post.authorId;

    let hasPermission = false;
    switch (accessControl) {
        case "everyone":
            hasPermission = true;
            break;
        case "moderators-only":
            hasPermission = isMod;
            break;
        case "moderators-and-approved-users":
            hasPermission = isMod || isApprovedUser;
            break;
        case "moderators-approved-and-op":
            hasPermission = isMod || isApprovedUser || isOP;
            break;
    }

    logger.debug("✅ Permission Check", {
        accessControl,
        isMod,
        isApprovedUser,
        isOP,
        hasPermission,
    });

    if (!hasPermission) {
        logger.warn("❌ Author does not have permission");
        return;
    }

    let containsUserCommand = false;
    if (settings[AppSetting.ThanksCommandUsesRegex]) {
        const regexes = userCommandList.map((cmd) => new RegExp(cmd, "i"));
        containsUserCommand = regexes.some((regex) =>
            regex.test(event.comment!.body)
        );
    } else {
        containsUserCommand = userCommandList.some((cmd) =>
            commentBody.includes(cmd)
        );
    }

    const containsModCommand =
        modCommand && commentBody.includes(modCommand.toLowerCase().trim());

    if (!containsUserCommand && !containsModCommand) return;

    logger.info("✅ Awarded Comment", {
        commentBody: event.comment.body,
    });

    const parentComment = await context.reddit.getCommentById(
        event.comment.parentId
    );
    if (!parentComment) {
        logger.warn("❌ Could not fetch parent comment");
        return;
    }

    if (parentComment.authorName === event.author.name) {
        logger.warn("❌ Author is trying to award themselves");

        const notifyOnError =
            ((settings[AppSetting.NotifyOnError] as string[]) ?? [])[0] ??
            NotifyOnErrorReplyOptions.NoReply;

        const pointName = (settings[AppSetting.PointName] as string) ?? "point";
        const template =
            (settings[AppSetting.SelfAwardMessage] as string) ??
            TemplateDefaults.NotifyOnSelfAwardTemplate;
        const message = formatMessage(template, {
            awarder: event.author.name,
            name: pointName,
        });

        if (notifyOnError === NotifyOnErrorReplyOptions.ReplyByPM) {
            await context.reddit.sendPrivateMessage({
                to: event.author.name,
                subject: `Cannot Award ${pointName}`,
                text: message,
            });
        } else if (notifyOnError === NotifyOnErrorReplyOptions.ReplyAsComment) {
            await context.reddit.submitComment({
                id: event.comment.id,
                text: message,
            });
        }

        return;
    }

    const redisKey = `thanks-${parentComment.id}-${event.author.name}`;
    const alreadyAwarded = await context.redis.exists(redisKey);
    if (alreadyAwarded) {
        logger.info("❌ Awarder already awarded this comment");

        const notify =
            ((settings[AppSetting.NotifyOnError] as string[]) ?? [])[0] ??
            NotifyOnErrorReplyOptions.NoReply;
        const template =
            (settings[AppSetting.PointAlreadyAwardedMessage] as string) ??
            TemplateDefaults.NotifyOnPointAlreadyAwardedTemplate;
        const alreadyAwardedMessage = formatMessage(template, {
            name: settings[AppSetting.PointName] as string,
        });

        if (notify === NotifyOnErrorReplyOptions.ReplyByPM) {
            await context.reddit.sendPrivateMessage({
                to: event.author.name,
                subject: `Point Already Awarded in r/${event.subreddit.name}`,
                text: alreadyAwardedMessage,
            });
        } else if (notify === NotifyOnErrorReplyOptions.ReplyAsComment) {
            await context.reddit.submitComment({
                id: event.comment.id,
                text: alreadyAwardedMessage,
            });
        }

        return;
    }

    const parentUser = await parentComment.getAuthor();
    if (!parentUser) {
        logger.warn("❌ Could not fetch parent user");
        return;
    }

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

    await context.redis.set(redisKey, Date.now().toString(), {
        expiration: addWeeks(new Date(), 1),
    });

    const rawNotifySuccess =
        ((settings[AppSetting.NotifyOnSuccess] as string[]) ?? [])[0] ?? "none";
    const notifyAwarded: PointAwardedReplyOptions = Object.values(
        PointAwardedReplyOptions
    ).includes(rawNotifySuccess as PointAwardedReplyOptions)
        ? (rawNotifySuccess as PointAwardedReplyOptions)
        : PointAwardedReplyOptions.NoReply;

    if (notifyAwarded !== PointAwardedReplyOptions.NoReply) {
        const pointName = (settings[AppSetting.PointName] as string) ?? "point";
        const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
        const successTemplate =
            (settings[AppSetting.SuccessMessage] as string) ??
            TemplateDefaults.NotifyOnSuccessTemplate;
        const scoreboard = `https://reddit.com/r/${event.subreddit.name}/wiki/${
            settings[AppSetting.ScoreboardLink] ?? "leaderboard"
        }`;

        const message = formatMessage(successTemplate, {
            awardee: parentComment.authorName,
            awarder: event.author.name,
            total: newScore.toString(),
            name: pointName,
            symbol: pointSymbol,
            scoreboard,
        });

        try {
            if (notifyAwarded === PointAwardedReplyOptions.ReplyByPM) {
                await context.reddit.sendPrivateMessage({
                    to: event.author.name,
                    subject: `Point Awarded in r/${event.subreddit.name}`,
                    text: message,
                });
            } else if (
                notifyAwarded === PointAwardedReplyOptions.ReplyAsComment
            ) {
                await context.reddit.submitComment({
                    id: event.comment.id,
                    text: message,
                });
            }
        } catch (err) {
            logger.error("❌ Failed to notify awarder", { err });
        }
    }

    await updateLeaderboard(
        {
            name: "manual-update",
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

function expirationFor(timeframe: string): Date | undefined {
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
        case "alltime": {
            return undefined;
        }
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

function markdownEscape(input: string): string {
    return input.replace(/([\\`*_{}\[\]()#+\-.!])/g, "\\$1");
}

export async function updateLeaderboard(
    event: ScheduledJobEvent<JSONObject | undefined>,
    context: Context
) {
    const settings = await context.settings.getAll();
    const leaderboardMode = settings[AppSetting.LeaderboardMode] as
        | string[]
        | undefined;
    if (!leaderboardMode || leaderboardMode[0] === LeaderboardMode.Off) return;

    const onlyShowAllTime =
        (
            settings[AppSetting.OnlyShowAllTimeScoreboard] as
                | string[]
                | undefined
        )?.[0] === "true";

    const wikiPageName =
        (settings[AppSetting.ScoreboardLink] as string) ?? "leaderboards";
    if (!wikiPageName.trim()) return;

    const leaderboardSize =
        (settings[AppSetting.LeaderboardSize] as number) ?? 10;
    const pointName = (settings[AppSetting.PointName] as string) ?? "point";
    const pointSymbol = (settings[AppSetting.PointSymbol] as string) ?? "";
    const subredditName = await getSubredditName(context);
    if (!subredditName) return;

    const formattedDate = format(new Date(), "MM/dd/yyyy HH:mm:ss");
    let markdown = `# ${capitalize(pointName)}boards for r/${subredditName}\n`;

    const helpPage = settings[AppSetting.LeaderboardHelpPage] as
        | string
        | undefined;
    const helpMessageTemplate =
        TemplateDefaults.LeaderboardHelpPageMessage as string;
    if (helpPage?.trim()) {
        markdown += `${helpMessageTemplate.replace("{{help}}", helpPage)}\n\n`;
    }

    const correctPermissionLevel =
        leaderboardMode[0] === LeaderboardMode.Public
            ? WikiPagePermissionLevel.SUBREDDIT_PERMISSIONS
            : WikiPagePermissionLevel.MODS_ONLY;

    const allScores: { member: string; score: number }[] = [];

    if (onlyShowAllTime) {
        const redisKey = leaderboardKey("alltime");
        const { markdown: tableMarkdown, scores } =
            await buildOrUpdateAllTimeLeaderboard(
                context,
                subredditName,
                redisKey,
                pointName,
                pointSymbol,
                leaderboardSize
            );

        markdown += `\n\n${tableMarkdown}`;
        allScores.push(...scores);

        const expiry = expirationFor("alltime");
        if (expiry) {
            const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
            if (ttl > 0) {
                await context.redis.expire(redisKey, ttl);
            }
        }
    } else {
        for (const timeframe of TIMEFRAMES) {
            const { markdown: sectionMarkdown, scores } =
                await buildOrUpdateLeaderboardForAllTimeframes(
                    context,
                    subredditName,
                    timeframe,
                    pointName,
                    pointSymbol,
                    leaderboardSize
                );

            markdown += `\n\n## ${capitalize(timeframe)}\n${sectionMarkdown}`;
            allScores.push(...scores);

            const redisKey = leaderboardKey(timeframe);
            const expiry = expirationFor(timeframe);
            if (expiry) {
                const ttl = Math.floor((expiry.getTime() - Date.now()) / 1000);
                if (ttl > 0) {
                    await context.redis.expire(redisKey, ttl);
                }
            }
        }
    }

    // Build user pages once per unique user
    const uniqueUsers = new Map<string, number>();
    for (const { member, score } of allScores) {
        if (
            !uniqueUsers.has(member) ||
            score > (uniqueUsers.get(member) ?? 0)
        ) {
            uniqueUsers.set(member, score);
        }
    }

    for (const [member, score] of uniqueUsers.entries()) {
        await buildOrUpdateUserPage(context, {
            member,
            score,
            subredditName,
            pointName,
            pointSymbol,
            formattedDate,
            correctPermissionLevel,
        });
    }

    try {
        const wikiPage = await context.reddit.getWikiPage(
            subredditName,
            wikiPageName
        );
        if (wikiPage.content !== markdown) {
            await context.reddit.updateWikiPage({
                subredditName,
                page: wikiPageName,
                content: markdown,
                reason: `Updated ${formattedDate}`,
            });
        }

        const wikiSettings = await wikiPage.getSettings();
        if (wikiSettings.permLevel !== correctPermissionLevel) {
            await context.reddit.updateWikiPageSettings({
                subredditName,
                page: wikiPageName,
                listed: true,
                permLevel: correctPermissionLevel,
            });
        }
    } catch {
        await context.reddit.createWikiPage({
            subredditName,
            page: wikiPageName,
            content: markdown,
            reason: `Initial setup`,
        });
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: wikiPageName,
            listed: true,
            permLevel: correctPermissionLevel,
        });
    }
}

async function buildOrUpdateUserPage(
    context: Context,
    {
        member,
        score,
        subredditName,
        pointName,
        pointSymbol,
        formattedDate,
        correctPermissionLevel,
    }: {
        member: string;
        score: number;
        subredditName: string;
        pointName: string;
        pointSymbol: string;
        formattedDate: string;
        correctPermissionLevel: WikiPagePermissionLevel;
    }
) {
    const userPage = `user/${encodeURIComponent(member)}`;
    const userAwardsKey = `user_awards:${member}`;
    let awardedPosts: Array<{ date: number; title: string; link: string }> = [];

    try {
        const rawPosts = await context.redis.zRange(userAwardsKey, 0, 9);
        awardedPosts = rawPosts
            .map((entry) => {
                try {
                    return JSON.parse(
                        typeof entry === "string" ? entry : entry.member
                    );
                } catch {
                    return null;
                }
            })
            .filter(Boolean) as Array<{
            date: number;
            title: string;
            link: string;
        }>;
    } catch {
        awardedPosts = [];
    }

    let userPageContent = `# ${capitalize(
        pointName
    )}s for u/${member}\n\n**Total:** ${score}${pointSymbol}\n\n`;

    if (awardedPosts.length > 0) {
        userPageContent += `# Snipe History for u/${member}\n\n| Date | Submission |\n|------|------------|\n`;
        for (const award of awardedPosts) {
            const dateStr = format(
                new Date(award.date * 1000),
                "MM/dd/yyyy HH:mm:ss"
            );
            const safeTitle = markdownEscape(award.title);
            userPageContent += `| ${dateStr} | [${safeTitle}](${award.link}) |\n`;
        }
    } else {
        userPageContent += `| – | No data yet | – |\n`;
    }

    userPageContent += `\nLast updated: ${formattedDate} UTC`;

    try {
        const userWikiPage = await context.reddit.getWikiPage(
            subredditName,
            userPage
        );
        if (userWikiPage.content !== userPageContent.trim()) {
            await context.reddit.updateWikiPage({
                subredditName,
                page: userPage,
                content: userPageContent.trim(),
                reason: `Update user score data for ${member}`,
            });
        }

        const userWikiSettings = await userWikiPage.getSettings();
        if (
            userWikiSettings.permLevel !== correctPermissionLevel ||
            userWikiSettings.listed !== true
        ) {
            await context.reddit.updateWikiPageSettings({
                subredditName,
                page: userPage,
                listed: true,
                permLevel: correctPermissionLevel,
            });
        }
    } catch {
        await context.reddit.createWikiPage({
            subredditName,
            page: userPage,
            content: userPageContent.trim(),
            reason: "Created user score data page",
        });
        await context.reddit.updateWikiPageSettings({
            subredditName,
            page: userPage,
            listed: true,
            permLevel: correctPermissionLevel,
        });
    }
}

function getRedisKey(subredditName: string, timeframe: string): string {
    const now = new Date();
    let dateSuffix = "";

    switch (timeframe) {
        case "daily":
            dateSuffix = format(now, "yyyy-MM-dd");
            break;
        case "weekly":
            dateSuffix = format(
                startOfWeek(now, { weekStartsOn: 0 }),
                "yyyy-MM-dd"
            ); // Sunday UTC
            break;
        case "monthly":
            dateSuffix = format(startOfMonth(now), "yyyy-MM");
            break;
        case "yearly":
            dateSuffix = format(startOfYear(now), "yyyy");
            break;
        case "alltime":
            return `leaderboard:${subredditName}:alltime`;
        default:
            throw new Error(`Invalid timeframe: ${timeframe}`);
    }

    return `leaderboard:${subredditName}:${timeframe}:${dateSuffix}`;
}

export async function buildOrUpdateLeaderboardForAllTimeframes(
    context: Context,
    subredditName: string,
    timeframe: "daily" | "weekly" | "monthly" | "yearly" | "alltime",
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
    const redisKey = getRedisKey(subredditName, timeframe);

    const scores = await context.redis.zRange(
        redisKey,
        0,
        leaderboardSize - 1,
        {
            by: "score",
            reverse: true,
        }
    );

    let markdown = `| Rank | User | ${capitalize(pointName)}${
        pointName.endsWith("s") ? "" : "s"
    } |\n|------|------|---------|\n`;

    if (scores.length === 0) {
        markdown += `| – | No data yet | – |\n`;
    } else {
        for (let i = 0; i < scores.length; i++) {
            const { member, score } = scores[i];
            const safeMember = markdownEscape(member);
            const userWikiLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(
                member
            )}`;
            markdown += `| ${
                i + 1
            } | [${safeMember}](${userWikiLink}) | ${score}${pointSymbol} |\n`;
        }
    }

    return { markdown, scores };
}

export async function buildOrUpdateAllTimeLeaderboard(
    context: Context,
    subredditName: string,
    redisKey: string,
    pointName: string,
    pointSymbol: string,
    leaderboardSize: number
): Promise<{ markdown: string; scores: { member: string; score: number }[] }> {
    // Get top scores descending
    const scores = await context.redis.zRange(
        redisKey,
        0,
        leaderboardSize - 1,
        {
            by: "score",
            reverse: true, // highest score first
        }
    );

    let markdown = `| Rank | User | ${capitalize(pointName)}${
        pointName.endsWith("s") ? "" : "s"
    } |\n|------|------|---------|\n`;

    if (scores.length === 0) {
        markdown += `| – | No data yet | – |\n`;
    } else {
        for (let i = 0; i < scores.length; i++) {
            const { member, score } = scores[i];
            const safeMember = markdownEscape(member);
            const userWikiLink = `/r/${subredditName}/wiki/user/${encodeURIComponent(
                member
            )}`;
            markdown += `| ${
                i + 1
            } | [${safeMember}](${userWikiLink}) | ${score}${pointSymbol} |\n`;
        }
    }

    return { markdown, scores };
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
