# BlueGenjiBot - Help

## What this bot does
BlueGenjiBot links partner servers through shared services.
If you post in an assigned channel with the right prefix, your message is forwarded to other partner servers using the same service.

## Services (prefixes)
Scrim, player and staff searches (`LFS`, `LFSub`, `LFT`, `LFP`, `LFG`,
`LFStaff`, `LFCast`) are for **Marvel Rivals only**. Only `TA` covers
tournament announcements for any game.

- `LFS`: Looking for scrim (Marvel Rivals).
- `TA`: Tournament announcement.
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
- `/help language:<English|Francais>`
- `/list-partner service:<service>`
- `/display-channel-filter-region channel:<channel>`
- `/display-channel-filter-rank channel:<channel>`
- `/ban-list`
- `/show-bot-admin`

Server admins:
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
