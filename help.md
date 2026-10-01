# BlueGenjiBot - Help

## What this bot does
BlueGenjiBot links partner servers through shared services.
If you post in an assigned channel with the right prefix, your message is forwarded to other partner servers using the same service.

## Games covered
The bot does not offer the same services for each game:
- **Marvel Rivals**: announcements dispatched across partner servers (every service below) **and** BlueGenji tournament management.
- **Overwatch**: BlueGenji tournament management **only** (match reminders, referee alerts, tournament log). No Overwatch announcement is dispatched across servers.

## Services (prefixes)
Every service below, tournament announcements included, is for
**Marvel Rivals only**.

- `LFS`: Looking for scrim (Marvel Rivals).
- `TA`: Tournament announcement (Marvel Rivals).
- `LFSub`: Looking for a substitute player (Marvel Rivals).
- `LFT`: Looking for a competitive team (Marvel Rivals).
- `LFP`: Looking for players for a competitive team (Marvel Rivals).
- `LFG`: Looking for a casual/ranked group (Marvel Rivals).
- `LFStaff`: Looking for staff (coach, manager, admin, etc.) for Marvel Rivals.
- `LFCast`: Looking for casters (Marvel Rivals).

## Good message format
Include these details to get better matches:
- Region: `EU`, `NA`, `LATAM`, `ASIA`
- Rank or rank range
- Date + hour
- Timezone
- Useful context (format, role, map pool, etc.)

Example:
`LFS EU Diamond Tuesday 21:00 CET - BO3 scrim`

## Deleting a forwarded message
If you delete your original message, the bot deletes the copies it posted in the
other partner channels.

It can only do so while it still holds the relay record, which lasts **seven
days**. After that the original can still be deleted, but the copies stay where
they are: the bot no longer knows which message they belonged to.

## Slash commands
Everyone:
- `/help language:<English|Français>`
- `/list-partner service:<service>`
- `/display-channel-filter-region channel:<channel>`
- `/display-channel-filter-rank channel:<channel>`
- `/show-bot-admin`
- `/scrim <level>`: posts a scrim search, **Marvel Rivals only**.
- `/recrute <role>`: posts a player or staff search, **Marvel Rivals only**.
- `/stats`: shows **your own** recent activity (only you see the reply): partner messages from the last 7 days, scrims and searches from the last 30 days. Nobody can look up another player's activity.
- `/stats-site`: shows BlueGenji website traffic (total visits, and unique visitors over the last 25 months).

Bans are **network-wide**: this is community moderation, decided by the admins of servers with 50+ members. `/ban-list` therefore shows the admin of any partner server the full list of network bans (banned player, moderator, reason, date), so they know who can no longer post through the bot and why.

To link your Discord account to the BlueGenji website, sign in to the website with Discord, or use « Applications connectées » on your profile (the former `/link` command is gone).

Retention: tracking of relayed messages (IDs, date) 7 days, erased at the latest during the following night — the copies posted in partner channels then stay on Discord; `/scrim` and `/recrute` posts 30 days with their author, then folded during the following night into plain counts per day, server and level (or role) — no author, time or order remains; network bans until they are lifted (the ban notices in the staff's private log channel are not deleted automatically); a server's configuration is erased when the bot leaves it — including when it left while the bot was offline, at the next startup; likewise a deleted relay channel is removed from the database, at the next startup if it was deleted while the bot was offline.

Server admins:
- `/ban-list` (network-wide list, see above)
- `/relay <channel>`: adds or removes an inter-server relay channel
- `/config <module>`: turns a module on or off (annonces, scrims, recrutement)
- `/assign-channel channel:<channel> service:<service> region-filter:<region> [rank-min] [rank-max]`
- `/edit-channel-filter-region channel:<channel> region:<region>`
- `/edit-channel-filter-rank channel:<channel> rank-min:<rank> rank-max:<rank>`
- `/reset-channel channel:<channel>`
- `/reset-all`
- `/set-bot-admin role:<role>`

Moderation (servers with 50+ members):
- `/ban-user-of-this-server user:<user> reason:<reason>`
- `/ban-user-of-another-server username:<username> reason:<reason>`
- `/unban id_ban:<id>`

## Support
Need help, have feedback, or found an issue?
Contact: `elessiah`
