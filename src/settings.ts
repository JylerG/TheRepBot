import {
    JSONObject,
    ScheduledJobEvent,
    SettingsFormField,
    SettingsFormFieldValidatorEvent,
    TriggerContext,
} from "@devvit/public-api";
import { VALIDATE_REGEX_JOB } from "./constants.js";

export enum ExistingFlairOverwriteHandling {
    OverwriteNumericSymbol = "overwritenumericsymbol",
    OverwriteNumeric = "overwritenumeric",
    OverwriteAll = "overwriteall",
    NeverSet = "neverset",
}

export enum LeaderboardMode {
    Off = "off",
    ModOnly = "modonly",
    Public = "public",
}

export enum AppSetting {
    NotifyUsersWhenAPointIsAwarded = "notifyUsersWhenAPointIsAwarded",
    UsersWhoCannotAwardPointsMessage = "usersWhoCannotAwardPointsMessage",
    UsersWhoCannotBeAwardedPointsMessage = "usersWhoCannotBeAwardedPointsMessage",
    ThanksCommandUsesRegex = "thanksCommandUsesRegex",
    ModAwardCommand = "approveCommand",
    SuperUsers = "superUsers",
    AutoSuperuserThreshold = "autoSuperuserThreshold",
    NotifyOnAutoSuperuser = "notifyOnAutoSuperuser",
    NotifyOnAutoSuperuserTemplate = "notifyOnAutoSuperuserTemplate",
    UsersWhoCannotBeAwardedPoints = "excludedUsers",
    NotifyUsersWhoCannotAwardPoints = "notifyUsersWhoCannotAwardPoints",
    UsersWhoCannotAwardPoints = "usersWhoCantAwardPoints",
    ExistingFlairHandling = "existingFlairHandling",
    ExistingFlairCosmeticHandling = "existingFlairCosmeticHandling",
    CSSClass = "thanksCSSClass",
    FlairTemplate = "thanksFlairTemplate",
    NotifyOnError = "notifyOnError",
    NotifyOnSuccess = "notifyOnSuccess",
    NotifyOnSuccessTemplate = "notifyOnSuccessTemplate",
    NotifyAwardedUser = "notifyAwardedUser",
    NotifyAwardedUserTemplate = "notifyAwardedUserTemplate",
    SetPostFlairOnThanks = "setPostFlairOnThanks",
    SetPostFlairText = "setPostFlairOnThanksText",
    SetPostFlairCSSClass = "setPostFlairOnThanksCSSClass",
    SetPostFlairTemplate = "setPostFlairOnThanksTemplate",
    LeaderboardMode = "leaderboardMode",
    ScoreboardLink = "scoreboardLink",
    LeaderboardSize = "leaderboardSize",
    LeaderboardHelpPage = "leaderboardHelpPage",
    PostFlairTextToIgnore = "postFlairTextToIgnore",
    EnableBackup = "enableBackup",
    EnableRestore = "enableRestore",
    PrioritiseScoreFromFlair = "prioritiseScoreFromFlair",
    PointTriggerWords = "pointTriggerWords",
    SuccessMessage = "successMessage",
    SelfAwardMessage = "selfAwardMessage",
    DuplicateAwardMessage = "duplicateAwardMessage",
    BotAwardMessage = "botAwardMessage",
    PointName = "pointName",
    DisallowedFlairs = "disallowedFlairs",
    DisallowedFlairMessage = "disallowedFlairMessage",
    InvalidPostMessage = "invalidPostMessage",
    ApproveMessage = "approveMessage",
    DenyCommand = "denyCommand",
    DenyMessage = "denyMessage",
    PointSymbol = "pointSymbol",
    AccessControl = "accessControl",
    ModOnlyDisallowedMessage = "modOnlyDisallowedMessage",
    ApprovedOnlyDisallowedMessage = "approvedOnlyDisallowedMessage",
    AllowUnflairedPosts = "allowUnflairedPosts",
    UnflairedPostMessage = "unflairedPostMessage",
    OPOnlyDisallowedMessage = "opOnlyDisallowedMessage",
    PointAlreadyAwardedMessage = "pointAlreadyAwardedMessage",
    OnlyShowAllTimeScoreboard = "onlyShowAllTimeScoreboard",
}

export enum TemplateDefaults {
    NotifyOnPointAlreadyAwardedTemplate = "You have already awarded this comment a {{name}}.",
    LeaderboardHelpPageMessage = "[How to award points with RepBot.]({{help}})",
    DisallowedFlairMessage = "Points cannot be awarded on posts with this flair. Please choose another post.",
    UsersWhoCannotAwardPointsMessage = "You do not have permission to award points.",
    ModOnlyDisallowedMessage = "Only moderators are allowed to award points.",
    ApprovedOnlyDisallowedMessage = "Only moderators and approved users can award points.",
    DuplicateAwardMessage = "This user has already been awarded for this comment.",
    SelfAwardMessage = "You can't award yourself a {name}.",
    BotAwardMessage = "You can't award the bot a {name}.",
    UsersWhoCannotBeAwardedPointsMessage = "The user you are trying to award {{name}}s to is not allowed to be awarded points. Please contact the moderators if you have any questions.",
    InvalidPostMessage = "Points cannot be awarded on this post because the recipient is suspended or shadowbanned.",
    NotifyOnSelfAwardTemplate = "Hello {{awarder}}, you cannot award a {{name}} to yourself.",
    NotifyOnSuccessTemplate = "+1 {point} to u/{{awardee}}.\n\n---\n\n^(I am a bot - please contact the mods with any questions)",
    NotifyAwardedUserTemplate = "Hello {{awardee}},\n\nYou have been awarded a point for your contribution! New score: {{score}}",
    NotifyOnSuperuserTemplate = 'Hello {{awardee}},\n\nNow that you have reached {{threshold}} points you can now award points yourself, even if normal users do not have permission to. Please use the command "{{command}}" if you\'d like to do this.',
}

export enum AutoSuperuserReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnErrorReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnSuccessReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum PointAwardedReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyUsersWhoCannotAwardPointsReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

const NotifyOnErrorReplyOptionChoices = [
    { label: "No Notification", value: NotifyOnErrorReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: NotifyOnErrorReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnErrorReplyOptions.ReplyAsComment,
    },
];

const NotifyOnSuccessReplyOptionsChoices = [
    { label: "No Notification", value: NotifyOnSuccessReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: NotifyOnSuccessReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnSuccessReplyOptions.ReplyAsComment,
    },
];

const PointAwardedReplyOptionChoices = [
    { label: "No Notification", value: PointAwardedReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: PointAwardedReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: PointAwardedReplyOptions.ReplyAsComment,
    },
];

const AutoSuperuserReplyOptionChoices = [
    { label: "No Notification", value: AutoSuperuserReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: AutoSuperuserReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: AutoSuperuserReplyOptions.ReplyAsComment,
    },
];

export const appSettings: SettingsFormField[] = [
    // === POINT SYSTEM ===
    {
        type: "group",
        label: "Point System Settings",
        fields: [
            //todo: figure out how to properly implement this
            {
                type: "select",
                name: AppSetting.OnlyShowAllTimeScoreboard,
                label: "Only Show All Time Leaderboard?",
                helpText: "Choose whether to show daily, weekly, monthly, yearly, and all time leaderboards. Setting this to false is not recommended as it will not work and is a placeholder currently.",
                options: [
                    {
                        label: "True",
                        value: "true",
                    },
                    {
                        label: "False",
                        value: "false",
                    },
                ],
                defaultValue: ["true"],
            },
            {
                type: "select",
                name: AppSetting.AccessControl,
                label: "Who Can Award?",
                helpText: "Choose who is allowed to award points.",
                options: [
                    {
                        label: "Moderators Only",
                        value: "moderators-only",
                    },
                    {
                        label: "Mods and Approved Users",
                        value: "moderators-and-approved-users",
                    },
                    {
                        label: "Moderators, Approved Users, and Post Author (OP)",
                        value: "moderators-approved-and-op",
                    },
                    {
                        label: "Everyone",
                        value: "everyone",
                    },
                ],
                defaultValue: ["moderators-approved-and-op"],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.UsersWhoCannotAwardPoints,
                label: "Users Who Cannot Award Points",
                helpText:
                    "List of usernames who cannot award points, even if they are mods or approved users. Each username should be on a new line.",
                defaultValue: "",
            },
            {
                type: "string",
                name: AppSetting.DisallowedFlairs,
                label: "Disallowed Flairs",
                helpText:
                    "Comma-separated flair texts where points cannot be awarded.",
                defaultValue: "",
            },
            {
                type: "paragraph",
                name: AppSetting.PointTriggerWords,
                label: "Trigger Words",
                helpText:
                    "List of trigger words users can type to award points (e.g., !award, .point). Each command should be on a new line. If you want to use regex, enable the option below.",
                defaultValue: "!award",
                onValidate: ({ value }) => {
                    if (!value || value.trim() === "") {
                        return "You must specify at least one command";
                    }
                },
            },
            {
                name: AppSetting.ThanksCommandUsesRegex,
                type: "boolean",
                label: "Treat user commands as regular expressions",
                defaultValue: false,
                onValidate: validateRegexes,
            },
            {
                name: AppSetting.ModAwardCommand,
                type: "string",
                label: "Alternate command for mods and trusted users to award reputation points",
                helpText: "Optional.",
                defaultValue: "!modaward",
            },
            {
                type: "string",
                name: AppSetting.DenyCommand,
                label: "Moderator Deny Command",
                helpText: "Command to revoke a previously awarded point.",
                defaultValue: "!remove",
            },
            {
                type: "string",
                name: AppSetting.PointName,
                label: "Point Name",
                helpText:
                    "Singular form of the name shown in award messages, like 'point', 'kudo', etc.",
                defaultValue: "point",
            },
            {
                type: "string",
                name: AppSetting.PointSymbol,
                label: "Point Symbol",
                helpText:
                    "Optional emoji or character to show alongside point totals. Leave empty for no symbol.",
                defaultValue: "⭐",
            },
            {
                type: "select",
                name: AppSetting.NotifyOnSuccess,
                label: "Notify users when a point is awarded successfully.",
                options: [
                    {
                        label: "Do not notify",
                        value: NotifyOnSuccessReplyOptions.NoReply,
                    },
                    {
                        label: "Reply with comment",
                        value: NotifyOnSuccessReplyOptions.ReplyAsComment,
                    },
                    {
                        label: "Send a private message",
                        value: NotifyOnSuccessReplyOptions.ReplyByPM,
                    },
                ],
                defaultValue: [NotifyOnSuccessReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "select",
                name: AppSetting.NotifyUsersWhoCannotAwardPoints,
                label: "Notify a user if they are not allowed to award points.",
                options: [
                    {
                        label: "Do not notify",
                        value: NotifyUsersWhoCannotAwardPointsReplyOptions.NoReply,
                    },
                    {
                        label: "Reply with comment",
                        value: NotifyUsersWhoCannotAwardPointsReplyOptions.ReplyAsComment,
                    },
                    {
                        label: "Send a private message",
                        value: NotifyUsersWhoCannotAwardPointsReplyOptions.ReplyByPM,
                    },
                ],
                defaultValue: [NotifyUsersWhoCannotAwardPointsReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "select",
                name: AppSetting.NotifyOnError,
                label: "Notify users when an error occurs.",
                options: [
                    {
                        label: "Do not notify",
                        value: NotifyOnErrorReplyOptions.NoReply,
                    },
                    {
                        label: "Reply with comment",
                        value: NotifyOnErrorReplyOptions.ReplyAsComment,
                    },
                    {
                        label: "Send a private message",
                        value: NotifyOnErrorReplyOptions.ReplyByPM,
                    },
                ],
                defaultValue: [NotifyOnErrorReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
        ],
    },
    {
        type: "group",
        label: "Flair Setting Options",
        fields: [
            {
                name: AppSetting.ExistingFlairHandling,
                type: "select",
                label: "Flair setting option",
                helpText: "If using a symbol, it must be set in the Point Symbol box.",
                options: [
                    {
                        label: "Set flair to new score, if flair unset or flair is numeric (With Symbol)",
                        value: ExistingFlairOverwriteHandling.OverwriteNumericSymbol,
                    },
                    {
                        label: "Set flair to new score, if flair unset or flair is numeric (Without Symbol)",
                        value: ExistingFlairOverwriteHandling.OverwriteNumeric,
                    },
                    {
                        label: "Set flair to new score, if user has no flair",
                        value: ExistingFlairOverwriteHandling.OverwriteAll,
                    },
                    {
                        label: "Never set flair",
                        value: ExistingFlairOverwriteHandling.NeverSet,
                    },
                ],
                multiSelect: false,
                defaultValue: [ExistingFlairOverwriteHandling.OverwriteNumeric],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                name: AppSetting.CSSClass,
                type: "string",
                label: "CSS class to use for points flairs.",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
            },
            {
                name: AppSetting.FlairTemplate,
                type: "string",
                label: "Flair template ID to use for points flairs",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
                onValidate: isFlairTemplateValid,
            },
        ],
    },
    {
        type: "group",
        label: "Post Flair Setting Options",
        fields: [
            {
                name: AppSetting.SetPostFlairOnThanks,
                type: "boolean",
                label: "Set post flair when a reputation point is awarded.",
                helpText:
                    "This can be used to mark a question as resolved, or answered",
                defaultValue: false,
            },
            {
                name: AppSetting.SetPostFlairText,
                type: "string",
                label: "Post Flair Text",
                helpText:
                    "Optional. Please enter the text to display for the post flair.",
            },
            {
                name: AppSetting.SetPostFlairCSSClass,
                type: "string",
                label: "Post Flair CSS Class",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
            },
            {
                name: AppSetting.SetPostFlairTemplate,
                type: "string",
                label: "Post Flair Template ID",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both.",
                onValidate: isFlairTemplateValid,
            },
        ],
    },
    {
        type: "group",
        label: "Messages",
        fields: [
            {
                type: "string",
                name: AppSetting.UsersWhoCannotAwardPointsMessage,
                label: "User Cannot Award Points Message",
                helpText: `Message shown when a user specified in the "Users Who Cannot Award Points" setting tries to award points but is not allowed to.`,
                defaultValue: TemplateDefaults.UsersWhoCannotAwardPointsMessage,
            },
            //todo: make it so that this will actually do something
            {
                name: AppSetting.NotifyOnAutoSuperuserTemplate,
                type: "paragraph",
                label: "Message sent when a user reaches the trusted user threshold.",
                helpText:
                    "Placeholder supported: {{awarder}}, {{permalink}}, {{threshold}}, {{command}}",
                defaultValue: TemplateDefaults.NotifyOnSuperuserTemplate,
            },
            {
                type: "string",
                name: AppSetting.SuccessMessage,
                label: "Success Message",
                helpText:
                    "Message when a point is awarded. You can use {{awardee}} to get the person being awarded's username, {{awarder}} to get the person awarding's username, {{symbol}} to get the symbol (if one is specified), {{total}} to get the awardee's total score, {{name}} to get the name of the point, {{scoreboard}} to link to the scoreboard wiki page.",
                defaultValue:
                    "+1 {{name}} awarded to u/{{awardee}} by u/{{awarder}}. Total: {{total}}{{symbol}}. Scoreboard is located [here]({{scoreboard}})",
            },
            {
                name:AppSetting.PointAlreadyAwardedMessage,
                type: "paragraph",
                label: "Point Already Awarded Message",
                helpText: "Message sent when a user tries to award a point, but they have already awarded one. You can use {{name}} to get the name of the point.",
                defaultValue: TemplateDefaults.NotifyOnPointAlreadyAwardedTemplate,
            },
            {
                type: "string",
                name: AppSetting.SelfAwardMessage,
                label: "Self Award Message",
                helpText:
                    "Shown when someone tries to award themselves. You can use {{name}} to get the name of the point and {{awarder}} to get the name of the person trying to award themselves.",
                defaultValue: TemplateDefaults.NotifyOnSelfAwardTemplate,
            },
            {
                type: "string",
                name: AppSetting.DuplicateAwardMessage,
                label: "Duplicate Award Message",
                helpText:
                    "Shown when someone tries to award a post they've already awarded. You can use {{awardee}} to get the person being awarded's username, {{total}} to get the user's total points, {{name}} to get the point name.",
                defaultValue:
                    "This user has already been awarded for this comment.",
            },
            {
                type: "string",
                name: AppSetting.BotAwardMessage,
                label: "Bot Award Message",
                helpText:
                    "Shown when someone tries to award the bot. You can use {{name}} to get the name of the point.",
                defaultValue: "You can't award the bot a {{name}}.",
            },
            {
                type: "string",
                name: AppSetting.ApproveMessage,
                label: "Moderator Award Message",
                helpText:
                    "Shown when a mod awards a point. Use {{awardee}} to get the name of the user being awarded, {{total}} to get the user's total points, {{symbol}} to get the symbol (if one is specified), {{name}} to get the name of the point.",
                defaultValue:
                    "A moderator gave an award! u/{{awardee}} now has {{total}}{{symbol}} {{name}}s.",
            },
            {
                type: "string",
                name: AppSetting.DenyMessage,
                label: "Moderator Deny Message",
                helpText:
                    "Message when a mod removes a point. You can use {{name}} to get the name of the point.",
                defaultValue: "{{name}} removed by a moderator.",
            },
            {
                type: "string",
                name: AppSetting.ModOnlyDisallowedMessage,
                label: "Non-Mod Access Denied Message",
                helpText:
                    "Message when a non-mod tries to award a point. You can use {{name}} to get the name of the point.",
                defaultValue: "Only moderators are allowed to award {{name}}s.",
            },
            {
                type: "string",
                name: AppSetting.ApprovedOnlyDisallowedMessage,
                label: "Non-Approved Access Denied Message",
                helpText:
                    "Message when a non-approved or non-mod user tries to award a point. You can use {{name}} to get the name of the point.",
                defaultValue:
                    "Only moderators and approved users can award {{name}}s.",
            },
            //Only moderators, approved users, and OPs can award {{name}}s.
            {
                type: "string",
                name: AppSetting.OPOnlyDisallowedMessage,
                label: "Non-Mod/Approved/OP Denied Message",
                helpText: "Message when a non-mod, non-approved, or non-OP tries to award a point. You can use {{name}} to get the name of the point.",
                defaultValue: "Only moderators, approved users, and Post Authors (OPs) can award {{name}}s."

            },
            {
                type: "string",
                name: AppSetting.DisallowedFlairMessage,
                label: "Disallowed Flair Message",
                helpText:
                    "Message shown when awarding on disallowed flair. You can use {{name}} to get the name of the point.",
                defaultValue:
                    "{{name}}s cannot be awarded on posts with this flair. Please choose another post.",
            },
            {
                type: "string",
                name: AppSetting.InvalidPostMessage,
                label: "Invalid Post Message",
                helpText:
                    "Message shown when awarding is attempted on disallowed or invalid posts. You can use {{name}} to get the name of the point.",
                defaultValue:
                    "Points cannot be awarded on this post because the recipient is suspended or shadowbanned.",
            },
            {
                type: "string",
                name: AppSetting.UnflairedPostMessage,
                label: "Unflaired Post Message",
                helpText: "Shown when trying to award on an unflaired post.",
                defaultValue:
                    "Points cannot be awarded on posts without flair. Please award only on flaired posts.",
            },
            {
                name: AppSetting.UsersWhoCannotBeAwardedPointsMessage,
                label: "Users Who Cannot Be Awarded Points Message",
                helpText:
                    "Message shown when trying to award points to a user who is excluded from receiving points. You can use {{awardee}} to get the username of the user being awarded.",
                type: "string",
                defaultValue:
                    "Sorry, you cannot award points to {{awardee}} as they are excluded from receiving points.",
            },
        ],
    },
    {
        type: "group",
        label: "Misc Settings",
        fields: [
            {
                name: AppSetting.LeaderboardMode,
                type: "select",
                options: [
                    { label: "Off", value: LeaderboardMode.Off },
                    { label: "Mod Only", value: LeaderboardMode.ModOnly },
                    { label: "Default settings for wiki", value: LeaderboardMode.Public },
                ],
                label: "Wiki Leaderboard Mode",
                multiSelect: false,
                defaultValue: [LeaderboardMode.Off],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                name: AppSetting.LeaderboardSize,
                type: "number",
                label: "Leaderboard Size",
                helpText: "Number of users to show on the leaderboard (1-50).",
                defaultValue: 10,
                onValidate: ({ value }) => {
                    if (value !== undefined && (value < 1 || value > 50)) {
                        return "Value should be between 1 and 50";
                    }
                },
            },
            {
                name: AppSetting.ScoreboardLink,
                type: "string",
                label: "Scoreboard Wiki Link",
                helpText:
                    "Name of the wiki page for your subreddit's scoreboard (e.g. leaderboards).",
            },
            {
                name: AppSetting.LeaderboardHelpPage,
                type: "string",
                label: "Point System Help Page",
                helpText:
                    "Optional. Please use a full URL, (e.g. https://www.reddit.com/r/yourSubreddit/wiki/yourPointSystemExplanation).",
            },
            {
                type: "select",
                name: AppSetting.AllowUnflairedPosts,
                label: "Allow on Unflaired Posts?",
                helpText: "Allow awarding on posts without flair?",
                options: [
                    { label: "Yes", value: "yes" },
                    { label: "No", value: "no" },
                ],
                defaultValue: ["no"],
                onValidate: selectFieldHasOptionChosen,
            },
        ],
    },
    {
        type: "group",
        label: "Backup and Restore",
        fields: [
            {
                name: AppSetting.EnableBackup,
                type: "boolean",
                label: "Enable Backup",
                defaultValue: true,
            },
            {
                name: AppSetting.EnableRestore,
                type: "boolean",
                label: "Enable Restore",
                helpText:
                    "This should be left disabled to prevent inadvertent score overwriting. Only enable during restore operations.",
                defaultValue: false,
            },
        ],
    },
];

function isFlairTemplateValid(event: SettingsFormFieldValidatorEvent<string>) {
    const flairTemplateRegex = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){4}[0-9a-f]{8}$/i;
    if (event.value && !flairTemplateRegex.test(event.value)) {
        return "Invalid flair template ID";
    }
}

function selectFieldHasOptionChosen(
    event: SettingsFormFieldValidatorEvent<string[]>
) {
    if (!event.value || event.value.length !== 1) {
        return "You must choose an option";
    }
}

async function validateRegexes(
    event: SettingsFormFieldValidatorEvent<boolean>,
    context: TriggerContext
) {
    if (!event.value) {
        return;
    }

    const user = await context.reddit.getCurrentUser();
    if (!user) {
        return;
    }

    await context.scheduler.runJob({
        name: VALIDATE_REGEX_JOB,
        runAt: new Date(),
        data: { username: user.username },
    });
}

export async function validateRegexJobHandler(
    event: ScheduledJobEvent<JSONObject>,
    context: TriggerContext
) {
    const { username } = event.data as { username: string };
    const user = await context.reddit.getUserByUsername(username);
    if (!user) return;

    // Here you would perform regex validation on user commands.
    // This is an example: you can extend with actual validation logic.
    // For demo, just log.
    console.log(`Validating regex commands for user ${username}`);
}
