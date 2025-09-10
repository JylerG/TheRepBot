import {
    Context,
    useState,
    UseStateResult,
    useInterval,
    UseIntervalResult,
} from "@devvit/public-api";
import { AppSetting } from "../settings.js";
import pluralize from "pluralize";
import { logger } from "../logger.js";

export type LeaderboardEntry = {
    username: string;
    score: number;
    rank: number;
    pointName: string;
};

const POINTS_STORE_KEY = `thanksPointsStore`;

export class LeaderboardState {
    readonly leaderboardEntries: UseStateResult<LeaderboardEntry[]>;
    readonly leaderboardSize: UseStateResult<number>;
    readonly leaderboardHelpUrl: UseStateResult<string>;
    readonly leaderboardPage: UseStateResult<number>;
    readonly subredditName: UseStateResult<string>;
    readonly leaderboardPageSize: number = 7;
    readonly refresher: UseIntervalResult;

    constructor(public context: Context) {
        // Initialize the leaderboard with empty array
        this.leaderboardEntries = useState<LeaderboardEntry[]>([]);
        // Default leaderboard size
        this.leaderboardSize = useState<number>(20);
        // Default page
        this.leaderboardPage = useState<number>(1);
        // Leaderboard help URL from settings
        this.leaderboardHelpUrl = useState<string>(
            async () =>
                (await context.settings.get<string>(
                    AppSetting.PointSystemHelpPage
                )) ?? ""
        );
        // Current subreddit name
        this.subredditName = useState<string>(
            async () => (await context.reddit.getCurrentSubreddit()).name
        );

        // Interval to refresh leaderboard every 60 seconds
        this.refresher = useInterval(async () => {
            await this.updateLeaderboard();
        }, 1000 * 60);

        this.refresher.start();

        // Kick off the first update immediately
        this.updateLeaderboard();
    }

    get leaderboard(): LeaderboardEntry[] {
        return this.leaderboardEntries[0];
    }

    set leaderboard(value: LeaderboardEntry[]) {
        this.leaderboardEntries[1](value);
    }

    get page(): number {
        return this.leaderboardPage[0];
    }

    set page(value: number) {
        if (value < 1 || value > this.maxPage) return;
        this.leaderboardPage[1](value);
    }

    get maxPage(): number {
        return Math.max(
            1,
            Math.ceil(this.leaderboard.length / this.leaderboardPageSize)
        );
    }

    getPageEntries(): LeaderboardEntry[] {
        return this.leaderboard.slice(
            (this.page - 1) * this.leaderboardPageSize,
            this.page * this.leaderboardPageSize
        );
    }

    async fetchLeaderboard () {
        const leaderboard: LeaderboardEntry[] = [];
        const items = await this.context.redis.zRange(POINTS_STORE_KEY, 0, this.leaderboardSize[0] - 1, { by: "rank", reverse: true });
        let rank = 1;
        const settings = await this.context.settings.getAll();
        for (const item of items) {
            leaderboard.push({
                username: item.member,
                score: item.score,
                rank: rank++,
                pointName: await settings[AppSetting.PointName] as string ?? "point",
            });
        }

        return leaderboard;
    }

    async updateLeaderboard () {
        this.leaderboard = await this.fetchLeaderboard();
        this.refresher.start();
    }
}

function capitalize(word: string): string {
    return word.charAt(0).toUpperCase() + word.slice(1);
}

// Optional helper to fetch scores from wiki
export async function getScoresFromWiki(
    context: Context
): Promise<Record<string, number>> {
    const subredditName = await context.reddit.getCurrentSubredditName();
    const settings = await context.settings.getAll();
    const pageName =
        (settings[AppSetting.ScoreboardName] as string) ?? "leaderboard";

    const wiki = await context.reddit.getWikiPage(subredditName, pageName);
    const content = wiki.content ?? "";

    const scores: Record<string, number> = {};
    const lines = content
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);

    const startIndex = lines.findIndex((l) => l.startsWith("-|"));
    for (let i = startIndex + 1; i < lines.length; i++) {
        const parts = lines[i].split("|").map((p) => p.trim());
        if (parts.length >= 2) {
            const username = parts[0].replace(/^u\//, "");
            const score = parseInt(parts[1], 10);
            if (!isNaN(score)) {
                scores[username] = score;
            }
        }
    }
    return scores;
}
