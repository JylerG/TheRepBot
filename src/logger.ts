// logger.ts
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { TriggerContext } from "@devvit/public-api";

export enum LogLevel {
    INFO = "INFO",
    WARN = "WARN",
    ERROR = "ERROR",
    DEBUG = "DEBUG",
}

const LOG_FILE = path.resolve("/mnt/data", "bot.log");
const IS_DEV = process.env.NODE_ENV === "development" || true; // set `false` for prod

function formatMessage(level: LogLevel, message: string, context?: Record<string, any>): string {
    const timestamp = new Date().toISOString();
    const ctxStr = context ? ` ${JSON.stringify(context, null, 2)}` : "";
    return `[${timestamp}] [${level}] ${message}${ctxStr}`;
}

function colorize(level: LogLevel, msg: string): string {
    switch (level) {
        case LogLevel.INFO: return chalk.blue(msg);
        case LogLevel.WARN: return chalk.yellow(msg);
        case LogLevel.ERROR: return chalk.red(msg);
        case LogLevel.DEBUG: return chalk.gray(msg);
        default: return msg;
    }
}

function writeToFile(message: string): void {
    try {
        fs.appendFileSync(LOG_FILE, message + "\n", "utf8");
    } catch (err) {
        console.error("Failed to write to log file:", err);
    }
}

async function sendModPM(context: TriggerContext, message: string): Promise<void> {
    try {
        const subreddit = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
        await context.reddit.sendPrivateMessage({
            to: `/r/${subreddit}`,
            subject: "Bot Error Alert",
            text: message.slice(0, 10000), // Reddit PM length cap
        });
    } catch (e) {
        console.error("Failed to send Reddit PM:", e);
    }
}

export const logger = {
    info: (message: string, context?: Record<string, any>) => {
        const msg = formatMessage(LogLevel.INFO, message, context);
        if (IS_DEV) console.log(colorize(LogLevel.INFO, msg));
        writeToFile(msg);
    },
    warn: (message: string, context?: Record<string, any>) => {
        const msg = formatMessage(LogLevel.WARN, message, context);
        if (IS_DEV) console.warn(colorize(LogLevel.WARN, msg));
        writeToFile(msg);
    },
    debug: (message: string, context?: Record<string, any>) => {
        const msg = formatMessage(LogLevel.DEBUG, message, context);
        if (IS_DEV) console.debug(colorize(LogLevel.DEBUG, msg));
        writeToFile(msg);
    },
    error: async (
        message: string,
        context?: Record<string, any>,
        devvitContext?: TriggerContext
    ) => {
        const msg = formatMessage(LogLevel.ERROR, message, context);
        console.error(colorize(LogLevel.ERROR, msg));
        writeToFile(msg);
        if (devvitContext) await sendModPM(devvitContext, msg);
    },
};
