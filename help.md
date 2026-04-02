# BlueGenjiBot - Help

## What this bot does
BlueGenjiBot links partner servers through shared services.
If you post in an assigned channel with the right prefix, your message is forwarded to other partner servers using the same service.

## Services (prefixes)
- `LFS`: Looking for scrim.
- `TA`: Tournament announcement.
- `LFSub`: Looking for a substitute player.
- `LFT`: Looking for a competitive team.
- `LFP`: Looking for players for a competitive team.
- `LFG`: Looking for a casual/ranked group.
- `LFStaff`: Looking for staff (coach, manager, admin, etc.).
- `LFCast`: Looking for casters.

## Good message format
Include these details to get better matches:
- Region: `EU`, `NA`, `LATAM`, `ASIA`
- Rank or rank range
- Date + hour
- Timezone
- Useful context (format, role, map pool, etc.)

Example:
`LFS EU Diamond Tuesday 21:00 CET - BO3 scrim`

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
