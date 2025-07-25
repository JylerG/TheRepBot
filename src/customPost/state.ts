import { Context, useInterval, UseIntervalResult, useState, UseStateResult } from "@devvit/public-api";
import { AppSetting } from "../settings.js";
import { POINTS_STORE_KEY } from "../thanksPoints.js";
import { CustomPostData } from "./index.js";
import { fetchLeaderboardEntries } from "../helpers/LeaderboardHelpers.js";

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type LeaderboardEntry = {
    username: string;
    score: number;
    rank: number;
    pointName: string;
};

export class LeaderboardState {
    readonly leaderboardSize: UseStateResult<number>;
    readonly leaderboardHelpUrl: UseStateResult<string>;
    readonly leaderboardEntries: UseStateResult<LeaderboardEntry[]>;
    readonly leaderboardPage: UseStateResult<number>;
    readonly leaderboardPageSize: number = 7;
    readonly subredditName: UseStateResult<string>;

    readonly refresher: UseIntervalResult;

    constructor (public context: Context) {
        this.leaderboardSize = useState<number>(async () => this.getLeaderboardSize());
        this.leaderboardHelpUrl = useState<string>(async () => await context.settings.get<string>(AppSetting.LeaderboardHelpPage) ?? "");
        this.leaderboardEntries = useState<LeaderboardEntry[]>(async () => fetchLeaderboardEntries(this.context, this.leaderboardSize[0]));
        this.leaderboardPage = useState(1);
        this.subredditName = useState<string>(async () => (await context.reddit.getCurrentSubreddit()).name);
        this.refresher = useInterval(async () => this.updateLeaderboard(), 1000 * 60);
        this.refresher.start();
    }

    get leaderboard (): LeaderboardEntry[] {
        return this.leaderboardEntries[0];
    }

    set leaderboard (value: LeaderboardEntry[]) {
        this.leaderboardEntries[1](value);
    }

    get page (): number {
        return this.leaderboardPage[0];
    }

    set page (value: number) {
        if (value < 1 || value > this.maxPage) {
            return;
        }

        this.leaderboardPage[1](value);
    }

    get maxPage (): number {
        return Math.ceil(this.leaderboard.length / this.leaderboardPageSize);
    }

    async getLeaderboardSize () {
        const redisKey = "customPostData";
        const data = await this.context.redis.get(redisKey);
        if (!data) {
            return 20;
        }

        const customPostData = JSON.parse(data) as CustomPostData;
        return customPostData.numberOfUsers;
    }

   

    async updateLeaderboard () {
        this.leaderboard = await fetchLeaderboardEntries(this.context, this.leaderboardSize[0]);
        this.refresher.start();
    }
}
