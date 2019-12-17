# hubot-standup-formstack-cron

A hubot script that gets formstack entries and posts the info on a cron

See [`src/standup-formstack-cron.js`](src/standup-formstack-cron.js) for full documentation.

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

Formstack is an online form builder (https://www.formstack.com/)
  Form required fields:
  - Date Feild
  - Yesterday notes
  - Today Notes
  - Blocker Notes
  - First Name
  - Last Name

HUBOT_FORMSTACK_TOKEN - (Required) Formstack API Token
HUBOT_FORMSTACK_FORM_ID - (Required) Formstack form ID
HUBOT_FORMSTACK_DATE_FIELD_ID - (Required) Formstack date field ID
HUBOT_FORMSTACK_USER_FIELD_ID - (Required) Formstack User name field ID
HUBOT_FORMSTACK_YESTERDAY_FIELD_ID - (Required) Formstack Yesterday field ID
HUBOT_FORMSTACK_TODAY_FIELD_ID - (Required) Formstack Today field ID
HUBOT_FORMSTACK_BLOCKER_FIELD_ID - (Required) Formstack Blocker field ID

HUBOT_FORMSTACK_PREFIX - (Optional) set a prefix for multiple standup reports

HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK - (Optional) Filter formstack submissions within X day ago

HUBOT_FORMSTACK_CHAT_ROOM_NAME - (Required for reminder and report) Chat room name for auto reminder and report
HUBOT_FORMSTACK_TIMEZONE - (Required for reminder and report)
HUBOT_FORMSTACK_URL - (Optional for reminder) url of the form for auto reminder

HUBOT_FORMSTACK_REMINDER_CRON - (Required for reminder) schedule a reminder to fill the form
HUBOT_FORMSTACK_STANDUP_REPORT_CRON - (Required for auto report) schedule to send the submissions
```

# Commands:
```
hubot (CustomPrefix-)standup            List results of standup form for today
hubot (CustomPrefix-)standup today      List who has filled out the standup form
```
