# hubot-standup-formstack-cron

A hubot script that gets Formstack entries from a form for a stand up scrum meeting and posts the info on a cron or by command.


## Installation

In hubot project repo, run:

```
npm install hubot-standup-formstack-cron --save
```
Or add `"hubot-standup-formstack-cron": ""` to your package.json dependencies

Then add **hubot-standup-formstack-cron** to your `external-scripts.json`:

```json
[
  "hubot-standup-formstack-cron"
]
```

## Configuration

Requires a Formstack form and access to Formstack api. All forms must be on the same account, and the api key must have access to all of the forms you want to add to this script.\
[Formstack](https://www.formstack.com/) - "*An intuitive, drag-and-drop form and workflow builder that allows businesses to collect information that matters and automate processes*".


##### Note
- Formstack form MUST have fields with the following key terms (in any order).
- The fields do not need to be verbatim and are not case sensitive.
- "Date of report" would work for the "Date" field.


| Key Term | Description |
| -------- | ----------- |
| '**Date**' | (REQUIRED) Formstack date the report is for |
| '**Yesterday**' | (REQUIRED) Formstack tasks from Yesterday|
| '**Today**' | (REQUIRED) Formstack tasks for Today |
| '**Blocker**' or '**Impeding**' | (REQUIRED) Blockers or items keeping work or tasks from happening |
| '**First Name**' | (REQUIRED) Formstack User (first or other) name |
| '**Last Name**' | (OPTIONAL) Formstack User Last Name |

#### **Environment Variables:**

##### A single form can be setup by default using the Environment Variables
##### Normal setup is done from the built in command

| Key Term | Description |
| -------- | ----------- |
| HUBOT_FORMSTACK_TOKEN | (Required) Formstack API Token |
| HUBOT_FORMSTACK_PREFIX | (Optional) set a prefix for multiple standup reports |
| HUBOT_FORMSTACK_HEAR | (Optional) Turn on or off hubot hear (default off) |
| HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK | (Optional) Filter Formstack submissions within X day ago (default 5 days) |
| HUBOT_FORMSTACK_TIMEZONE | (Optional) global timezone for all forms used by the reminder and report |
|-- **Preset From Options** --||
| HUBOT_FORMSTACK_FORM_ID | (Optional) Formstack preset form ID |
| HUBOT_FORMSTACK_URL | (Optional for reminder) url of the preset form for auto reminder |
| HUBOT_FORMSTACK_CHAT_ROOM_NAME | (Optional for reminder and report) Preset Chat room name for auto reminder and report |
| HUBOT_FORMSTACK_REMINDER_CRON | (Optional for reminder) Preset schedule a reminder to fill the form |
| HUBOT_FORMSTACK_STANDUP_REPORT_CRON | (Optional for auto report) Preset schedule to send the submissions |


## Commands:
```
hubot standup setup <FORMID> <TIME> <REMINDER> <CRONDAYS> - Setup the script for the first time
    FORMID - Formstack Form ID\n`;
    TIME - Time of auto post (8:00am or 14:00)
    REMINDER - Number of minutes before to send reminder (15) Default 30
    CRONDAYS - Days to post in cron format (1-5 or 0,1,2,3) 0 = Sunday. Default 1-5 (weekdays)
    Reminder and crondays can be skipped to accept defaults

hubot standup            List all results of standup form for today
hubot standup today      List all who have filled out the standup form today
hubot standup <person>   List <person> results of standup form today (search first and/or last name)
hubot standup remove     Remove the standup link form the room
```

## Sample Interaction:


CustomPrefix = Ateam (Optional)\
Kate and Sam fill out form:
```
(on reminder cron)
Hubot:        @here Time to fill out the stand up report <Link_to_form>
              Sam has filled out the report for today

Sam:          hubot Ateam-standup
Hubot:        Kate: Jan-01-2019
                Yesterday:
                  - tasks
                Today:
                  - tasks
                Blocker:
                  - none

              Sam:
                Yesterday:
                  - tasks
                Today:
                  - tasks
                Blocker:
                  - none

Sam:          hubot Ateam-standup today
Hubot:        Kate and Sam have filled out the report for today

Sam:          hubot Ateam-standup Kate
Hubot:        Kate: Jan-01-2019
                Yesterday:
                  - tasks
                Today:
                  - tasks
                Blocker:
                  - none

```

## NPM Module

[https://www.npmjs.com/package/hubot-standup-formstack-cron](https://www.npmjs.com/package/hubot-standup-formstack-cron)
