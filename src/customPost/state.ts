
import {
    Context,
    useInterval,
    UseIntervalResult,
    useState,
    UseStateResult,
} from "@devvit/public-api";
import { AppSetting } from "../settings.js";
import pluralize from "pluralize";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type LeaderboardEntry = {
    username: string;
    score: number;
    rank: number;
    pointName: string;
};
const POINTS_STORE_KEY = `thanksPointsStore`;

export class LeaderboardState {
    readonly leaderboardSize: UseStateResult<number>;
    readonly leaderboardHelpUrl: UseStateResult<string>;
    readonly leaderboardEntries: UseStateResult<LeaderboardEntry[]>;
    readonly leaderboardPage: UseStateResult<number>;
    readonly leaderboardPageSize: number = 7;
    readonly subredditName: UseStateResult<string>;

    readonly refresher: UseIntervalResult;

    constructor(public context: Context) {
        // Use state, defaulting to 20 if no Redis value is found
        this.leaderboardSize = useState<number>(20);

        // Get leaderboard help URL from settings
        this.leaderboardHelpUrl = useState<string>(
            async () =>
                (await context.settings.get<string>(
                    AppSetting.PointSystemHelpPage
                )) ?? ""
        );

        // Default to an empty leaderboard until fetched
        this.leaderboardEntries = useState<LeaderboardEntry[]>([]);

        // Track current page
        this.leaderboardPage = useState(1);

        // Subreddit name for flair and other use cases
        this.subredditName = useState<string>(
            async () => (await context.reddit.getCurrentSubreddit()).name
        );

        // Set up an interval to refresh leaderboard periodically
        this.refresher = useInterval(
            async () => this.updateLeaderboard(),
            1000 * 60
        );

        // Kick off first update
        this.refresher.start();

        // Immediately fetch leaderboard once constructed
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
        return Math.ceil(this.leaderboard.length / this.leaderboardPageSize);
    }

    async fetchLeaderboard () {
        const leaderboard: LeaderboardEntry[] = [];
        const settings = await this.context.settings.getAll();
        const items = await this.context.redis.zRange(POINTS_STORE_KEY, 0, this.leaderboardSize[0] - 1, { by: "rank", reverse: true });
        let rank = 1;
        for (const item of items) {
            leaderboard.push({
                username: item.member,
                score: item.score,
                rank: rank++,
                pointName: capitalize(pluralize(String(settings[AppSetting.PointName] ?? "point"))),
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
