RepBot is an app that allows users to award reputation points if a user has been helpful. Its main use case is for help and advice subreddits to help indicate users who have a track record of providing useful solutions.

It allows the OP of a post, a mod, or a trusted user to reply to a user and award them a point using a bot command, which will be stored as their user flair (optional from v1.2) and stored in a data store. The command can be customisable (by default it is `!thanks`).

The app gets triggered when a comment is posted or edited, but only never award points twice per comment. It triggers on edit to give the user chance to amend a comment to add the "thanks" command if they forget initially.

You can also set an optional post flair if a point is awarded, such as to mark the question as "Resolved".

The app has backup and restore functionality, which enables points to be preserved if you uninstall the app or if you want to import data from a previous reputation points app. For technical details of this function, please [see here](https://www.reddit.com/r/fsvapps/wiki/reputatorbotbackup/). THIS BIT IS FROM u/fsv'S CODE AND TAKEN STRAIGHT FROM THEIR REPUTATORBOT PROJECT.

## Custom Post

By using the subreddit ... menu, you can create a custom post that shows the current leaderboard. You can choose the post title and the number of users to show on the leaderboard.

## Limitations

* The optional leaderboard will not pull in points for users until this app awards one. If you have previously used /u/Clippy_Office_Asst or a similar bot to award reputation points in the past, this will make the leaderboard misleading unless you restore from a backup.
* For flair setting options, if you specify both a CSS class and a flair template, the flair template will be used.

## Suggestions

You may wish to create an automod rule that detects phrases like "thank you" and similar in comments that do not have the trigger command, and reply suggesting that they use the command.

I strongly recommend using a command that is not going to be used in "normal" comments, to avoid awarding points accidentally. If you use a prefix e.g. !thanks or /award, you will reduce the risk of accidental points awarding.

I recommend testing settings out on a test subreddit before deploying to a real subreddit for the first time.

## Data Stored

This application stores the reputation score awarded by the app for each user in a Redis data store and (if configured) as the user's flair. It also stores a record that a comment has had a point awarded on it for a period of a week after that point is awarded.

If the application is removed from a subreddit, all data is deleted although the flairs will remain. If the application is subsequently re-installed, the existing flairs will be used as a basis for new point awarding.

Data for users is removed from the app within 48 hours from v1.3 onwards.

## Acknowledgements

[Code edited from u/fsv's reputatorbot](https://github.com/fsvreddit/reputatorbot).

## About

This app is open source and licenced under the BSD 3-Clause Licence. You can find the source code on GitHub [here](https://github.com/JylerG/TheRepBot).

NOTE: If you update settings, you will have to uninstall to be able to reimplement the content that you want in whatever you are editing.

## Version History
### 0.0.13
* * Make it so only the all time leaderboard appears (can't figure out how to do every leaderboard) (STILL IN PROGRESS)
### 0.0.12
* Update README to be more accurate
### 0.0.11
* Fix incorrect version number for 0.0.10
### 0.0.10
* Remove daily, weekly, monthly, and yearly leaderboards for now to try and fix it.
### 0.0.9
* Make it so that users can select if they use an all-time leaderboard only or daily, weekly, monthly, yearly, and all-time leaderboards (this part is a WIP).
### 0.0.8
* Make it so the bot can actually send the user messages
* Improve code for functionality
* Make it so the symbol can be added to a user's flair if a symbol is specified
### 0.0.7
* Fixed a typo in v0.0.6 (used TheRepBot instead of reputatorbot in acknowledgements)
### 0.0.6
* Kept bits of code from TheRepBot while implementing custom code
* Set up a baseline for what should be used
* Implemented daily, weekly, monthly, yearly, and alltime leaderboards
* Made code work as intended as much as possible
* Note that this bot's source code has changed since this README/project was first created and is why these notes may seem weird with what the code shows
### 0.0.5
* Add more customizability to various messages
* Allow awards to be allowed/not on unflaired posts as specified by app 
* Add more options to customizability
* Make it so that various placeholders work and the scoreboard appears as intended
* NOTE: THE SCOREBOARD IS BUGGY AND STILL A WORK-IN-PROGRESS
### 0.0.2
* Improved text explanations for what various entries are for
### 0.0.1
* Getting base code out