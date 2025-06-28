import chalk from "chalk";
import { TriggerContext } from "@devvit/public-api";
import fs from "fs";
import path from "path";

export enum LogLevel {
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
  DEBUG = "DEBUG",
}

// Determine environment
const IS_DEV = process.env.NODE_ENV === "development";
const IS_DEVVIT = process.env.DEVVIT_ENV === "production"; // Optional, based on deployment metadata
const ENABLE_FILE_LOGGING = IS_DEV && !IS_DEVVIT;

// Optional file logging for local development only
const dataDir = path.resolve("data");
const LOG_FILE = path.join(dataDir, "bot.log");

function ensureLogDirExists(): void {
  try {
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
  } catch (err) {
    console.error("Logger: Failed to create log directory:", err);
  }
}

function writeToFile(message: string): void {
  if (!ENABLE_FILE_LOGGING) return;
  ensureLogDirExists();
  try {
    fs.appendFileSync(LOG_FILE, message + "\n", "utf8");
  } catch (err) {
    console.error("Logger: Failed to write to log file:", err);
  }
}

function formatMessage(level: LogLevel, message: string, context?: Record<string, any>): string {
  const timestamp = new Date().toISOString();
  const ctxStr = context ? ` ${JSON.stringify(context, null, 2)}` : "";
  return `[${timestamp}] [${level}] ${message}${ctxStr}`;
}

function colorize(level: LogLevel, msg: string): string {
  switch (level) {
    case LogLevel.INFO:
      return chalk.blue(msg);
    case LogLevel.WARN:
      return chalk.yellow(msg);
    case LogLevel.ERROR:
      return chalk.red(msg);
    case LogLevel.DEBUG:
      return chalk.gray(msg);
    default:
      return msg;
  }
}

async function sendModPM(context: TriggerContext, message: string): Promise<void> {
  try {
    const subreddit = context.subredditName ?? (await context.reddit.getCurrentSubreddit()).name;
    await context.reddit.sendPrivateMessage({
      to: `/r/${subreddit}`,
      subject: "TheRepBot Error Alert",
      text: message.slice(0, 10000),
    });
  } catch (e) {
    console.error("Logger: Failed to send Reddit PM:", e);
  }
}

export const logger = {
  info: (message: string, context?: Record<string, any>) => {
    const msg = formatMessage(LogLevel.INFO, message, context);
    console.log(colorize(LogLevel.INFO, msg));
    writeToFile(msg);
  },
  warn: (message: string, context?: Record<string, any>) => {
    const msg = formatMessage(LogLevel.WARN, message, context);
    console.warn(colorize(LogLevel.WARN, msg));
    writeToFile(msg);
  },
  debug: (message: string, context?: Record<string, any>) => {
    const msg = formatMessage(LogLevel.DEBUG, message, context);
    console.debug(colorize(LogLevel.DEBUG, msg));
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
    if (devvitContext) {
      await sendModPM(devvitContext, msg);
    }
  },
};
