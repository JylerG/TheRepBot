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
    NotifyOnSelfAward = "notifyOnSelfAward",
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
    NotifyOnSuccess = "notifyOnSuccess",
    NotifyOnSuccessTemplate = "notifyOnSuccessTemplate",
    NotifyAwardedUser = "notifyAwardedUser",
    NotifyAwardedUserTemplate = "notifyAwardedUserTemplate",
    SetPostFlairOnThanks = "setPostFlairOnThanks",
    SetPostFlairText = "setPostFlairOnThanksText",
    SetPostFlairCSSClass = "setPostFlairOnThanksCSSClass",
    SetPostFlairTemplate = "setPostFlairOnThanksTemplate",
    LeaderboardMode = "leaderboardMode",
    ScoreboardName = "ScoreboardName",
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
    NotifyOnPointAlreadyAwarded = "notifyOnPointAlreadyAwarded",
    NotifyOnDuplicateAward = "notifyOnDuplicateAward",
    NotifyOnBotAward = "notifyOnBotAward",
    NotifyOnApprove = "notifyOnApprove",
    NotifyOnDeny = "notifyOnDeny",
    NotifyOnModOnlyDisallowed = "notifyOnModOnlyDisallowed",
    NotifyOnApprovedOnlyDisallowed = "notifyOnApprovedOnlyDisallowed",
    NotifyOnOPOnlyDisallowed = "notifyOnOPOnlyDisallowed",
    NotifyOnDisallowedFlair = "notifyOnDisallowedFlair",
    NotifyOnInvalidPost = "notifyOnInvalidPost",
    NotifyOnUnflairedPost = "notifyOnUnflairedPost",
    NotifyOnDuplicateAwardMessage = "notifyOnDuplicateAwardMessage",
    NotifyOnUsersWhoCannotBeAwarded = "notifyOnUsersWhoCannotBeAwarded",
}

export enum TemplateDefaults {
    UnflairedPostMessage = "Points cannot be awarded on posts without flair. Please award only on flaired posts.",
    OPOnlyDisallowedMessage = "Only moderators, approved users, and Post Authors (OPs) can award {{name}}s.",
    DenyMessage = "1 {{name}} removed by a moderator.  u/{{awardee}} now has {{total}}{{symbol}} {{name}}s. Scoreboard is located [here]({{scoreboard}}).",
    ApproveMessage = "A moderator gave an award! u/{{awardee}} now has {{total}}{{symbol}} {{name}}s.",
    NotifyOnDuplicateAwardMessage = "You have already awarded this comment a {{name}}.",
    NotifyOnPointAlreadyAwardedTemplate = "You have already awarded this comment a {{name}}.",
    LeaderboardHelpPageMessage = "[How to award points with RepBot.]({{help}})",
    DisallowedFlairMessage = "Points cannot be awarded on posts with this flair. Please choose another post.",
    UsersWhoCannotAwardPointsMessage = "You do not have permission to award {{name}}s.",
    ModOnlyDisallowedMessage = "Only moderators are allowed to award points.",
    ApprovedOnlyDisallowedMessage = "Only moderators and approved users can award points.",
    DuplicateAwardMessage = "This user has already been awarded for this comment.",
    SelfAwardMessage = "You can't award yourself a {{name}}.",
    BotAwardMessage = "You can't award the bot a {{name}}.",
    UsersWhoCannotBeAwardedPointsMessage = "Sorry, you cannot award points to u/{{awardee}} as they are excluded from receiving points.",
    InvalidPostMessage = "Points cannot be awarded on this post because the recipient is suspended or shadowbanned.",
    NotifyOnSelfAwardTemplate = "Hello {{awarder}}, you cannot award a {{name}} to yourself.",
    NotifyOnSuccessTemplate = "+1 {{name}} awarded to u/{{awardee}} by u/{{awarder}}. Total: {{total}}{{symbol}}. Scoreboard is located [here]({{scoreboard}}).",
    NotifyAwardedUserTemplate = "Hello {{awardee}},\n\nYou have been awarded a point for your contribution! New score: {{score}}",
    NotifyOnSuperuserTemplate = 'Hello {{awardee}},\n\nNow that you have reached {{threshold}} points you can now award points yourself, even if normal users do not have permission to. Please use the command "{{command}}" if you\'d like to do this.',
}

export enum AutoSuperuserReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnPointAlreadyAwardedReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnDuplicateAwardReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnModApproveReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnModDenyReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnModOnlyDisallowedReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnApprovedOnlyDisallowedReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnOPOnlyDisallowedReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnDisallowedFlairReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnInvalidPostReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnUnflairedPostReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyUsersWhoCannotBeAwardedReplyOptions {
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

export enum NotifyOnSelfAwardReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyUsersWhoCannotAwardPointsReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

export enum NotifyOnBotAwardReplyOptions {
    NoReply = "none",
    ReplyByPM = "replybypm",
    ReplyAsComment = "replybycomment",
}

const NotifyOnPointAlreadyAwardedReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnPointAlreadyAwardedReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnPointAlreadyAwardedReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnPointAlreadyAwardedReplyOptions.ReplyAsComment,
    },
];

const NotifyUsersWhoCannotAwardPointsReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyUsersWhoCannotAwardPointsReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyUsersWhoCannotAwardPointsReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyUsersWhoCannotAwardPointsReplyOptions.ReplyAsComment,
    },
];

const NotifyOnDuplicateAwardReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnDuplicateAwardReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnDuplicateAwardReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnDuplicateAwardReplyOptions.ReplyAsComment,
    },
];

const NotifyOnBotAwardReplyOptionChoices = [
    { label: "No Notification", value: NotifyOnBotAwardReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: NotifyOnBotAwardReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnBotAwardReplyOptions.ReplyAsComment,
    },
];

const NotifyOnModApproveReplyOptionChoices = [
    { label: "No Notification", value: NotifyOnModApproveReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: NotifyOnModApproveReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnModApproveReplyOptions.ReplyAsComment,
    },
];

const NotifyOnModDenyReplyOptionChoices = [
    { label: "No Notification", value: NotifyOnModDenyReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: NotifyOnModDenyReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnModDenyReplyOptions.ReplyAsComment,
    },
];

const NotifyOnModOnlyDisallowedReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnModOnlyDisallowedReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnModOnlyDisallowedReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnModOnlyDisallowedReplyOptions.ReplyAsComment,
    },
];

const NotifyOnApprovedOnlyDisallowedReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnApprovedOnlyDisallowedReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnApprovedOnlyDisallowedReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnApprovedOnlyDisallowedReplyOptions.ReplyAsComment,
    },
];

const NotifyOnOPOnlyDisallowedReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnOPOnlyDisallowedReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnOPOnlyDisallowedReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnOPOnlyDisallowedReplyOptions.ReplyAsComment,
    },
];

const NotifyOnDisallowedFlairReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnDisallowedFlairReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnDisallowedFlairReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnDisallowedFlairReplyOptions.ReplyAsComment,
    },
];

const NotifyOnInvalidPostReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnInvalidPostReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnInvalidPostReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnInvalidPostReplyOptions.ReplyAsComment,
    },
];

const NotifyOnUnflairedPostReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyOnUnflairedPostReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyOnUnflairedPostReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnUnflairedPostReplyOptions.ReplyAsComment,
    },
];

const NotifyUsersWhoCannotBeAwardedReplyOptionChoices = [
    {
        label: "No Notification",
        value: NotifyUsersWhoCannotBeAwardedReplyOptions.NoReply,
    },
    {
        label: "Send user a private message",
        value: NotifyUsersWhoCannotBeAwardedReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyUsersWhoCannotBeAwardedReplyOptions.ReplyAsComment,
    },
];

const NotifyOnSelfAwardReplyOptionChoices = [
    { label: "No Notification", value: NotifyOnSelfAwardReplyOptions.NoReply },
    {
        label: "Send user a private message",
        value: NotifyOnSelfAwardReplyOptions.ReplyByPM,
    },
    {
        label: "Reply as comment",
        value: NotifyOnSelfAwardReplyOptions.ReplyAsComment,
    },
];

const NotifyOnSuccessReplyOptionChoices = [
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

const AccessControlOptionChoices = [
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
];

const LeaderboardModeOptionChoices = [
    { label: "Off", value: LeaderboardMode.Off },
    { label: "Mod Only", value: LeaderboardMode.ModOnly },
    {
        label: "Default settings for wiki",
        value: LeaderboardMode.Public,
    },
];

const ExistingFlairHandlingOptionChoices = [
    {
        label: "Set flair to new score, if flair unset or flair is numeric (With Symbol)",
        value: ExistingFlairOverwriteHandling.OverwriteNumericSymbol,
    },
    {
        label: "Set flair to new score, if flair unset or flair is numeric (Without Symbol)",
        value: ExistingFlairOverwriteHandling.OverwriteNumeric,
    },
    {
        label: "Never set flair",
        value: ExistingFlairOverwriteHandling.NeverSet,
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
            {
                type: "select",
                name: AppSetting.AccessControl,
                label: "Who Can Award Points",
                helpText: "Choose who is allowed to award points",
                options: AccessControlOptionChoices,
                defaultValue: ["moderators-approved-and-op"],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.ModOnlyDisallowedMessage,
                label: "Mod Only Disallowed Message",
                helpText:
                    "Message shown when a user tries to award a point but only moderators can award points.",
                defaultValue: TemplateDefaults.ModOnlyDisallowedMessage,
            },
            {
                type: "paragraph",
                name: AppSetting.ApprovedOnlyDisallowedMessage,
                label: "Approved Only Disallowed Message",
                helpText:
                    "Message shown when a user tries to award a point but only mods and approved users can award points.",
                defaultValue: TemplateDefaults.ApprovedOnlyDisallowedMessage,
            },
            {
                type: "paragraph",
                name: AppSetting.OPOnlyDisallowedMessage,
                label: "OP Only Disallowed Message",
                helpText:
                    "Message shown when a user tries to award a point but only mods, approved users, and Post Authors (OPs) can award points.",
                defaultValue: TemplateDefaults.OPOnlyDisallowedMessage,
            },
            {
                type: "string",
                name: AppSetting.DisallowedFlairs,
                label: "Disallowed Flairs",
                helpText:
                    "Comma-separated flair texts where points cannot be awarded",
                defaultValue: "",
            },
            {
                type: "paragraph",
                name: AppSetting.PointTriggerWords,
                label: "Trigger Words",
                helpText:
                    "List of trigger words users can type to award points (e.g., !award, .point). Each command should be on a new line. If you want to use regex, enable the option below",
                defaultValue: "!award",
                onValidate: noValidTriggerWords,
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
                helpText: "Optional",
                defaultValue: "!modaward",
            },
            {
                type: "string",
                name: AppSetting.DenyCommand,
                label: "Moderator Deny Command",
                helpText: "Command to revoke a previously awarded point",
                defaultValue: "!remove",
            },
            {
                type: "string",
                name: AppSetting.PointName,
                label: "Point Name",
                helpText:
                    "Singular form of the name shown in award messages, like 'point', 'kudo', etc. Lowercase is recommended",
                defaultValue: "point",
            },
            {
                type: "string",
                name: AppSetting.PointSymbol,
                label: "Point Symbol",
                helpText:
                    "Optional emoji or character to show alongside point totals. Leave empty for no symbol",
                defaultValue: "",
            },
        ],
    },
    {
        type: "group",
        label: "Points Setting Options",
        fields: [
            {
                name: AppSetting.ExistingFlairHandling,
                type: "select",
                label: "Flair setting option",
                helpText:
                    "If using a symbol, it must be set in the Point Symbol box",
                options: ExistingFlairHandlingOptionChoices,
                multiSelect: false,
                defaultValue: [ExistingFlairOverwriteHandling.OverwriteNumeric],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                name: AppSetting.CSSClass,
                type: "string",
                label: "CSS class to use for points flairs",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both",
            },
            {
                name: AppSetting.FlairTemplate,
                type: "string",
                label: "Flair template ID to use for points flairs",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both",
                onValidate: isFlairTemplateValid,
            },
        ],
    },
    {
        type: "group",
        label: "Notification Settings",
        fields: [
            {
                type: "select",
                name: AppSetting.NotifyOnSelfAward,
                label: "Notify users when they try to award themselves",
                options: NotifyOnSelfAwardReplyOptionChoices,
                defaultValue: [NotifyOnSelfAwardReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.SelfAwardMessage,
                label: "Self Award Message",
                helpText:
                    "Shown when someone tries to award themselves. Placeholders Supported: {{name}}, {{awarder}}",
                defaultValue: TemplateDefaults.NotifyOnSelfAwardTemplate,
            },
            {
                type: "select",
                name: AppSetting.NotifyOnSuccess,
                label: "Notify users when a point is awarded successfully",
                options: NotifyOnSuccessReplyOptionChoices,
                defaultValue: [NotifyOnSuccessReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.SuccessMessage,
                label: "Success Message",
                helpText:
                    "Message when a point is awarded. Placeholders Supported: {{awardee}}, {{awarder}} , {{symbol}}, {{total}}, {{name}}, {{scoreboard}}",
                defaultValue: TemplateDefaults.NotifyOnSuccessTemplate,
            },
            {
                type: "select",
                name: AppSetting.NotifyUsersWhoCannotAwardPoints,
                label: "Notify a user if they are not allowed to award points",
                options: NotifyUsersWhoCannotAwardPointsReplyOptionChoices,
                defaultValue: [
                    NotifyUsersWhoCannotAwardPointsReplyOptions.NoReply,
                ],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.UsersWhoCannotAwardPoints,
                label: "Users Who Cannot Award Points",
                helpText:
                    "List of usernames who cannot award points, even if they are mods or approved users. Each username should be on a new line",
                defaultValue: "",
            },
            {
                type: "paragraph",
                name: AppSetting.UsersWhoCannotAwardPointsMessage,
                label: "User Cannot Award Points Message",
                helpText: `Message shown when a user specified in the "Users Who Cannot Award Points" setting tries to award points but is not allowed to. Placeholders Supported: {{name}}`,
                defaultValue: TemplateDefaults.UsersWhoCannotAwardPointsMessage,
            },

            {
                type: "select",
                name: AppSetting.NotifyOnDuplicateAward,
                label: "Notify a user if they try to award a point on a comment they've already awarded",
                options: NotifyOnDuplicateAwardReplyOptionChoices,
                defaultValue: [NotifyOnDuplicateAwardReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.NotifyOnDuplicateAwardMessage,
                label: "Duplicate Award Message",
                helpText: `Message shown when a user tries to award a point on a comment they've already awarded. Placeholders Supported: {{name}}`,
                defaultValue: TemplateDefaults.NotifyOnDuplicateAwardMessage,
            },
            {
                type: "select",
                name: AppSetting.NotifyOnBotAward,
                label: "Notify a user if they try to award the bot",
                options: NotifyOnBotAwardReplyOptionChoices,
                defaultValue: [NotifyOnBotAwardReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.BotAwardMessage,
                label: "Bot Award Message",
                helpText:
                    "Message shown when someone tries to award the bot. You can use {{name}} to get the name of the point",
                defaultValue: TemplateDefaults.BotAwardMessage,
            },
            {
                type: "select",
                name: AppSetting.NotifyOnApprove,
                label: "Notify a user when a point is awarded by a moderator",
                options: NotifyOnModApproveReplyOptionChoices,
                defaultValue: [NotifyOnModApproveReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.ApproveMessage,
                label: "Moderator Award Message",
                helpText:
                    "Placeholders supported: {{awarder}}, {{awardee}}, {{permalink}}, {{total}}, {{symbol}}, {{name}}, {{scoreboard}}",
                defaultValue: TemplateDefaults.ApproveMessage,
            },
            {
                type: "select",
                name: AppSetting.NotifyOnDeny,
                label: "Notify a user when a point is removed by a moderator",
                options: NotifyOnModDenyReplyOptionChoices,
                defaultValue: [NotifyOnModDenyReplyOptions.NoReply],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                type: "paragraph",
                name: AppSetting.DenyMessage,
                label: "Moderator Deny Message",
                helpText:
                    "Placeholders supported: {{awarder}}, {{awardee}}, {{permalink}}, {{total}}, {{symbol}}, {{name}}, {{scoreboard}}",
                defaultValue: TemplateDefaults.DenyMessage,
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
                label: "Set post flair when a reputation point is awarded",
                helpText:
                    "This can be used to mark a question as resolved, or answered",
                defaultValue: false,
            },
            {
                name: AppSetting.SetPostFlairText,
                type: "string",
                label: "Post Flair Text",
                helpText:
                    "Optional. Please enter the text to display for the post flair",
            },
            {
                name: AppSetting.SetPostFlairCSSClass,
                type: "string",
                label: "Post Flair CSS Class",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both",
            },
            {
                name: AppSetting.SetPostFlairTemplate,
                type: "string",
                label: "Post Flair Template ID",
                helpText:
                    "Optional. Please choose either a CSS class or flair template, not both",
                onValidate: isFlairTemplateValid,
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
                options: LeaderboardModeOptionChoices,
                label: "Wiki Leaderboard Mode",
                multiSelect: false,
                defaultValue: [LeaderboardMode.Off],
                onValidate: selectFieldHasOptionChosen,
            },
            {
                name: AppSetting.LeaderboardSize,
                type: "number",
                label: "Leaderboard Size",
                helpText: "Number of users to show on the leaderboard (1-100)",
                defaultValue: 50,
                onValidate: ({ value }) => {
                    if (value !== undefined && (value < 1 || value > 100)) {
                        return "Value should be between 1 and 100";
                    }
                },
            },
            {
                name: AppSetting.ScoreboardName,
                type: "string",
                label: "Scoreboard Wiki Name",
                helpText:
                    "Name of the wiki page for your subreddit's scoreboard (e.g. leaderboard). Singular form is recommended as there is only one scoreboard per subreddit",
                defaultValue: "leaderboard",
                onValidate: ({ value }) => {
                    if (!value || value.trim() === "") {
                        return "You must specify a wiki page name";
                    }
                },
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

function noValidTriggerWords(event: SettingsFormFieldValidatorEvent<string>) {
    if (!event.value || event.value.trim() === "") {
        return "You must specify at least one trigger word";
    }
    const lines = event.value.split("\n").map((line) => line.trim());
    if (lines.length === 0 || lines.some((line) => line === "")) {
        return "You must specify at least one trigger word";
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
