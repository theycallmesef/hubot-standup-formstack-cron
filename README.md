# hubot-standup-formstack-cron

A hubot script that gets formstack entries and posts the info on a cron

See [`src/hubot-standup-formstack-cron.js`](src/hubot-standup-formstack-cron.js) for full documentation.

## Installation

In hubot project repo, run:

`npm install hubot-standup-formstack-cron --save`

Then add **hubot-standup-formstack-cron** to your `external-scripts.json`:

```json
[
  "hubot-standup-formstack-cron"
]
```

# Configuration
```
FS_TOKEN - (Required) Formstack API Token
FS_FORMID - (Required) Formstack form ID
DATEFIELD_ID - (Required) Formstack date field ID
USERN_ID - (Required) Formstack User name field ID
YDAY_ID - (Required) Formstack Yesterday field ID
TDAY_ID - (Required) Formstack Today field ID
BLOCK_ID - (Required) Formstack Blocker field ID

DAYSBACK - (Optional) Filter formstack submissions within X day ago

ROOM - (Required for reminder and report) Chat room name for auto reminder and report
TIMEZONE - (Required for reminder and report)
FS_URL - (Optional for reminder) url of the form for auto reminder

REMINDER_CRON - (Required for reminder) schedule a reminder to fill the form
STANDUP_REPORT_CRON - (Required for auto report) schedule to send the submissions
```

# Commands:
```
hubot standup            List results of standup form for today
hubot standup today      List who has filled out the standup form
```
