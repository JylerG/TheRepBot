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

// Environment config
const IS_DEV = process.env.NODE_ENV === "development";
const IS_DEVVIT = process.env.DEVVIT_ENV === "production";
const ENABLE_FILE_LOGGING = IS_DEV && !IS_DEVVIT;

// Log file path (for local dev)
const dataDir = path.resolve("data");
const LOG_FILE = path.join(dataDir, "bot.log");

function ensureLogDirExists(): void {
  if (!fs.existsSync(dataDir)) {
    try {
      fs.mkdirSync(dataDir, { recursive: true });
    } catch (err) {
      console.error("Logger: Failed to create log directory:", err);
    }
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
  const contextString = context ? ` ${JSON.stringify(context, null, 2)}` : "";
  return `[${timestamp}] [${level}] ${message}${contextString}`;
}

function colorize(level: LogLevel, message: string): string {
  switch (level) {
    case LogLevel.INFO: return chalk.blue(message);
    case LogLevel.WARN: return chalk.yellow(message);
    case LogLevel.ERROR: return chalk.red(message);
    case LogLevel.DEBUG: return chalk.gray(message);
    default: return message;
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

function logToConsole(level: LogLevel, coloredMsg: string): void {
  switch (level) {
    case LogLevel.INFO:
    case LogLevel.DEBUG:
      console.info(coloredMsg);
      break;
    case LogLevel.WARN:
      console.warn(coloredMsg);
      break;
    case LogLevel.ERROR:
      console.error(coloredMsg);
      break;
    default:
      console.info(coloredMsg);
  }
}

export const logger = {
  info: (message: string, context?: Record<string, any>) => {
    const msg = formatMessage(LogLevel.INFO, message, context);
    const colored = colorize(LogLevel.INFO, msg);
    logToConsole(LogLevel.INFO, colored);
    writeToFile(msg);
  },
  warn: (message: string, context?: Record<string, any>) => {
    const msg = formatMessage(LogLevel.WARN, message, context);
    const colored = colorize(LogLevel.WARN, msg);
    logToConsole(LogLevel.WARN, colored);
    writeToFile(msg);
  },
  debug: (message: string, context?: Record<string, any>) => {
    const msg = formatMessage(LogLevel.DEBUG, message, context);
    const colored = colorize(LogLevel.DEBUG, msg);
    logToConsole(LogLevel.DEBUG, colored); // ✅ was console.debug
    writeToFile(msg);
  },
  error: async (
    message: string,
    context?: Record<string, any>,
    devvitContext?: TriggerContext
  ) => {
    const msg = formatMessage(LogLevel.ERROR, message, context);
    const colored = colorize(LogLevel.ERROR, msg);
    logToConsole(LogLevel.ERROR, colored);
    writeToFile(msg);
    if (devvitContext) {
      await sendModPM(devvitContext, msg);
    }
  },
};
