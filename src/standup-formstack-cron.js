/*
Description:
  Report standup notes that were filled in using formstack

Commands:
  hubot standup setup <FORMID> <TIME> <REMINDER> <CRONDAYS> - Setup the script for the first time
      FORMID - Formstack Form ID\n`;
      TIME - Time of auto post (8:00am or 14:00)
      REMINDER - Number of minutes before to send reminder (15) Default 30
      CRONDAYS - Days to post in cron format (1-5 or 0,1,2,3) 0 = Sunday. Default 1-5 (weekdays)
      Reminder and crondays can be skipped to accept defaults

  hubot standup            List all results of standup form for today
  hubot standup today      List all who have filled out the standup form today
  hubot standup <person>   List <person> results of standup form today (search first and/or last name)
  hubot standup randomize  Randomize the list of all results of standup form

Author:
  theycallmesef

Configuration:
- Formstack form MUST have fields with the following key terms (in any order).
- The fields do not need to be verbatim and are not case sensitive.
- "Date of report" would work for the "Date" field.

  Date                  (REQUIRED) Formstack date the report is for
  Yesterday             (REQUIRED) Formstack tasks from Yesterday
  Today                 (REQUIRED) Formstack tasks for Today
  Blocker or Impeding   (REQUIRED) Blockers or items keeping work or tasks from happening
  First Name            (REQUIRED) Formstack User (first or other) name
  Last Name             (OPTIONAL) Formstack User Last Name

Environment Variables:
  HUBOT_FORMSTACK_TOKEN - (REQUIRED) Formstack API Token

  HUBOT_FORMSTACK_PREFIX - (OPTIONAL) set a prefix for multiple standup reports
  HUBOT_FORMSTACK_HEAR - (OPTIONAL) Turn on or off hubot hear (default off)
  HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK - (OPTIONAL) Formstack submissions limiter (default 5 days)
  HUBOT_FORMSTACK_TIMEZONE - (Optional) Set Timezone for all forms (default timezone of the form)

Notes:
  Formstack is an online form builder (https://www.formstack.com/)
    Form fields:
    - Date Feild
    - Yesterday notes
    - Today Notes
    - Blocker Notes
    - First Name
    - Last Name     (optional)

Dependencies:
  "hubot-redis-brain": "",
  "cron": ">=1.7.2"

TODO:

*/

//(Required) Formstack API Token
const FS_TOKEN = process.env.HUBOT_FORMSTACK_TOKEN;

//(Optional) set a prefix for multiple standup reports, usually used in combination with "on hear"
let PREFIX_A = process.env.HUBOT_FORMSTACK_PREFIX && (PREFIX = `${process.env.HUBOT_FORMSTACK_PREFIX}-`) || "";
const PREFIX = PREFIX_A;

//(Optional) Turn on or off hubot hear (default off)
let ONHEAR_A = process.env.HUBOT_FORMSTACK_HEAR || false;
const ONHEAR = ONHEAR_A;

/*
NOTE: There is some type of limit on the amount of data returned by the Formstack API.
It unexpectedly truncates the most recent data rather than the oldest.
I would not set the look back farther that 5 days for 4-5 people filling out the form.
*/
//(Optional) filter formstack submissions within X day ago
let DAYSBACK_A = process.env.HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK || 3;
const DAYSBACK = DAYSBACK_A;

export default (robot) => {
  // Push Help Commands
  robot.commands.push(`hubot ${PREFIX}standup - List results of standup form for today`);
  robot.commands.push(`hubot ${PREFIX}standup today - List who has filled out the standup form`);
  robot.commands.push(`hubot ${PREFIX}standup <USERNAME> - List results of standup form for today`);
  robot.commands.push(`hubot ${PREFIX}standup randomize - Randomize the list of all results of standup form`);
  robot.commands.push(`hubot ${PREFIX}standup setup - Setup a form in a room (see help for more)`);
  robot.commands.push(`hubot ${PREFIX}standup remove - Remove a form from a room`);
  robot.commands.push(`hubot ${PREFIX}standup help - List command help and how to set up chat room`);

  // cron module
  const CronJob = require('cron').CronJob;

  // timezone module
  const { DateTime } = require('luxon');

  // setup global arrays to store vars for each room
  let REMINDER_CRON_JOB = [],
    STANDUP_REPORT_CRON_JOB = [],
    FS_URL = [],
    FS_FORMID = [],
    DATEFIELD_ID = [],
    YDAY_ID = [],
    TDAY_ID = [],
    BLOCK_ID = [],
    USERFN_ID = [],
    USERLN_ID = [],
    FSAPIURL = [],
    TIMEZONE = [],
    RANDOMIZE = [];

  // Backwards Compatability set up form from global variables
  if (process.env.HUBOT_FORMSTACK_FORM_ID && process.env.HUBOT_FORMSTACK_CHAT_ROOM_NAME) {
    robot.logger.info("standup-formstack-cron: Setting up Form from env's");
    const id = process.env.HUBOT_FORMSTACK_FORM_ID;
    const rm = process.env.HUBOT_FORMSTACK_CHAT_ROOM_NAME;
    // Auto setup form from env's
    SetupForm(rm, id);
    // Auto setup cron from env's
    if ((process.env.HUBOT_FORMSTACK_REMINDER_CRON || process.env.HUBOT_FORMSTACK_STANDUP_REPORT_CRON) && process.env.HUBOT_FORMSTACK_TIMEZONE) {
      robot.logger.info("standup-formstack-cron: Setting up Cron from env's");
      const mn = process.env.HUBOT_FORMSTACK_REMINDER_CRON;
      const rp = process.env.HUBOT_FORMSTACK_STANDUP_REPORT_CRON;
      const tm = process.env.HUBOT_FORMSTACK_TIMEZONE;
      SetCron(rm, rp, mn, tm);
    };
  };

  // Load all crons from previous steup rooms from list in redis
  // On 'connected' runs once when redis is connected
  robot.brain.on('connected', () => {
    let brainrooms = [],
      rooms;
    try {
      robot.logger.info("standup-formstack-cron: Gathering rooms with forms setup from redis");
      // Create array of rooms or empty array
      brainrooms = robot.brain.get(`FS_Rooms`) || [];
      if (brainrooms.length > 0) {
        // ignore any duplicates
        rooms = brainrooms.filter((c, index) => {
          return brainrooms.indexOf(c) === index;
        });
        robot.logger.info(`standup-formstack-cron: Loading ${rooms.length} rooms`);
        // loop list of rooms and set up crons that were setup before
        for (room of rooms) {
          const standup_report_cron = robot.brain.get(`FS_${room}.REPORT_CRON`);
          const reminder_cron = robot.brain.get(`FS_${room}.REMIND_CRON`);
          const timezone = robot.brain.get(`FS_${room}.TIMEZONE`);
          // Check vars and setup cron
          if (standup_report_cron && reminder_cron) {
            robot.logger.info(`standup-formstack-cron: setting up room ${room}`);
            robot.messageRoom(room, `I got rebooted. I'm restoring the reminder and standup schedule from memory...`);
            FS_FORMID[room] = robot.brain.get(`FS_${room}.FS_FORMID`);
            SetCron(room, standup_report_cron, reminder_cron, timezone);
          } else {
            // filter out room and remove from list
            rooms = rooms.filter(e => e !== room);
          };
        };
        // save any changes back to redis
        robot.brain.set(`FS_Rooms`, rooms);
      };
    } catch (err) {
      robot.logger.info(`standup-formstack-cron: Failed to gather rooms with forms setup from redis ${err}`);
    };
  });

  // ---- ad-hoc commands ----
  //Regex summery: "standup" maybe any nummber of spaces, then construct for "setup" or a word maybe with another word
  const REGX = "standup\\s*(setup (\\d+)\\s*(?:(\\d{1,2}:\\d{2}(?:am|pm)?|\\d{4}) ?(?:(\\d{1,2}) ?([0-6]\\-[0-6]|[0-6](?:,[0-6]){0,6})?)?)?|\\w+(?:\\s+[a-z]+)?)?$";

  // Hear command without addressing hubot
  if (ONHEAR) {
    robot.hear(new RegExp("^" + PREFIX + REGX, 'i'), (msg) => {
      msg.finish();
      BotRespond(msg);
    });
  };
  // Respond to command by addressing hubot
  robot.respond(new RegExp(PREFIX + REGX, 'i'), (msg) => {
    msg.finish();
    BotRespond(msg);
  });

  // Parse responce for commands
  function BotRespond(msg) {
    // Ignore the command "standup" and pull remaining command text
    const room = msg.message.room;
    const rxmatch = msg.match[1];
    robot.logger.info("standup-formstack-cron: Bot responding to command");
    // Check formstack token is set
    if (!FS_TOKEN) {
      robot.messageRoom(room, "Unable to run this plugin\nCannot find the Formstack token");
      robot.logger.error("standup-formstack-cron: Missing formstack token. Please add global variable");
      return;
    };
    // TODO Why is this here and not in the next logic?
    if (!GetFormInfoRedis(room)) {
      if (FS_FORMID[room]) {
        GetFormInfo(room);
      };
    };
    // Parse string from input command
    if (FS_FORMID[room]) {
      if (rxmatch) {
        // Logic to seperate the commands
        if (rxmatch.toLowerCase() === "today" || rxmatch.toLowerCase() === "list") {
          // fuction to list all users that filled out the form
          FilledItOut(room);
        } else if (rxmatch.toLowerCase() === "remove") {
          // function to remove standup from room
          RemoveStandup(room);
        } else if (rxmatch.toLowerCase() === "help") {
          // function to list available commands
          HelpReply(room);
        } else if (rxmatch.toLowerCase() === "randomize") {
          // Toggle randomness of full report
          RANDOMIZE[room] = !RANDOMIZE[room];
          robot.brain.set(`FS_${room}.RANDOMIZE`, RANDOMIZE[room]);
          if (RANDOMIZE[room]) {
            robot.messageRoom(room, `Full reports will be in random order`);
          } else {
            robot.messageRoom(room, `Full reports will be in order submitted`);
          };
        } else if (rxmatch.toLowerCase().substring(0, 5) === "setup") {
          // Catch if a form is already setup in room
          robot.messageRoom(room, `There seems to be a form already linked to this room (Form ID: ${FS_FORMID[room]})\nIf you would like to replace the current form\nplease run the remove command and then setup the new one.`);
        } else if (!["today", "help", "randomize", "setup", "remove"].includes(rxmatch)) {
          // If non command, call function to list a single users form for today
          SingleReport(room, rxmatch);
        };
      } else {
        // If second part is empty, call function to list all results of form for today
        ReportStandup(room);
      };
    } else {
      // look for setup command
      if (rxmatch && rxmatch.toLowerCase().substring(0, 5) === "setup") {
        // function to setup form to room
        if (msg.match[2]) {
          robot.messageRoom(room, `Setting up connection to form`);
          robot.logger.info("standup-formstack-cron: Setting up connection to form");
          SetupForm(room, msg.match[2], msg.match[3], msg.match[4], msg.match[5]);
        } else {
          robot.messageRoom(room, "I don't understand the command\nI think there is something missing, please try again");
          HelpReply(room);
        };
      } else {
        robot.messageRoom(room, "A form is not setup for this room\nTo attach a form to this room, please use the 'Setup' command");
        HelpReply(room);
      };
    };
  };

  // ---- Setup form and cron to room ----
  function SetupForm(room, formid, reporttime, remindbeforemin, days) {
    let time,
      date,
      rooms = [];
    // Make sure form id is a number
    if (Number.isInteger(Number(formid))) {
      FS_FORMID[room] = formid;
      robot.brain.set(`FS_${room}.FS_FORMID`, FS_FORMID[room]);
    } else {
      robot.messageRoom(room, `The form ID entered (${formid}), is not a number\nPlease try again`);
      return;
    };
    // Get form data and "timezone" from Form
    GetFormInfo(room).then((result) => {
      if (result) {
        // Setup cron
        if (reporttime) {
          // Set date
          time = reporttime.split(":");
          // Convert to 24h time
          if (reporttime.match(/pm$/i)) {
            if (parseInt(time[0]) !== 12) {
              time[0] = parseInt(time[0]) + 12;
            };
            time[1] = time[1].slice(0, -2);
          } else if (reporttime.match(/am$/i)) {
            if (parseInt(time[0]) === 12) {
              time[0] = parseInt(time[0]) + 12;
            };
            time[1] = time[1].slice(0, -2);
          };

          // Set days if undefined
          // !RegExp('\\d\-\\d|\\d|(\\d\,\\s)+\\d').test(days)
          if (days === undefined) {
            days = "1-5";
          };
          // Set Reminder if null
          if (!Number.isInteger(Number(remindbeforemin)) || remindbeforemin === undefined) {
            remindbeforemin = 30;
          };
          // Set crons
          date = new Date();
          // set time in date object in order to properlly do time math
          date.setHours(time[0]);
          date.setMinutes(time[1]);
          // Set report cron for time and days
          const standup_report_cron = `${date.getMinutes()} ${date.getHours()} * * ${days}`;
          // Set Minutes minus X minutes
          date.setMinutes(date.getMinutes() - remindbeforemin);
          // Set reminder cron for time and days
          const reminder_cron = `${date.getMinutes()} ${date.getHours()} * * ${days}`;
          //log built crons
          robot.logger.info(`standup-formstack-cron: Report Cron Set To - ${standup_report_cron}`);
          robot.logger.info(`standup-formstack-cron: Remind Cron Set To - ${reminder_cron}`);
          // Save cron time to redis
          robot.brain.set(`FS_${room}.REPORT_CRON`, standup_report_cron);
          robot.brain.set(`FS_${room}.REMIND_CRON`, reminder_cron);
          //Setup Cron
          SetCron(room, standup_report_cron, reminder_cron, TIMEZONE[room]);
        } else {
          robot.messageRoom(room, `No report or reminder cron was set`);
          robot.logger.info(`standup-formstack-cron: No report cron was defined`);
        };
      };
    })
      .then(result => {
        robot.logger.info(`standup-formstack-cron: Adding room ${room} to rooms list in redis`);
        //add rooms to list
        rooms = robot.brain.get(`FS_Rooms`);
        rooms.push(room);
        robot.brain.set(`FS_Rooms`, rooms);
        robot.logger.info("standup-formstack-cron: Form setup has completed");
        return true;
      })
      .catch(err => {
        robot.logger.info(`standup-formstack-cron: SetupForm: Return False ${err}`);
        return false;
      });
  };

  // ---- setup auto post and reminder cron ----
  function SetCron(room, standup_report_cron, reminder_cron, timezone) {
    robot.logger.info(`standup-formstack-cron: Running cron setup: Room - ${room}`);
    // Reminder with names of those who already filled it out cron
    if (room) {
      if (reminder_cron) {
        robot.logger.info(`standup-formstack-cron: Setting up reminder cron: Room - ${room} | Timezone - ${timezone}`);
        // Reminder Cron
        REMINDER_CRON_JOB[room] = new CronJob(reminder_cron, function () {
          GetFormInfoRedis(room);
          robot.messageRoom(room, `@here Time to fill out the <${FS_URL[room]}|stand up report>\n`);
          // fuction to list who has filled out the form
          return FilledItOut(room);
          robot.logger.info("standup-formstack-cron: Finish FilledItOut Cron");
        }, null, true, timezone);
        robot.logger.info(`standup-formstack-cron: Starting Reminder Cron: Room - ${room}`);
        REMINDER_CRON_JOB[room].start();
      } else {
        robot.logger.error("standup-formstack-cron: Missing variable for reminder cron.");
      };

      if (standup_report_cron) {
        // Report results cron
        STANDUP_REPORT_CRON_JOB[room] = new CronJob(standup_report_cron, function () {
          GetFormInfoRedis(room);
          // fuction to list results of form for today "true" is passed to "CronRun"
          return ReportStandup(room, true);
        }, null, true, timezone);
        robot.logger.info(`standup-formstack-cron: Starting Report Cron: Room - ${room}`);
        STANDUP_REPORT_CRON_JOB[room].start();
      } else {
        robot.logger.error("standup-formstack-cron: Missing variable for standup cron");
      };
      // Test if cron is Running
      if (STANDUP_REPORT_CRON_JOB[room].running && REMINDER_CRON_JOB[room].running) {
        robot.messageRoom(room, `Form reminder (${FS_FORMID[room]}) setup was successfull\nNext reminder running at  ${REMINDER_CRON_JOB[room].nextDates(1)}\nNext report running at ${STANDUP_REPORT_CRON_JOB[room].nextDates(1)}`);
        //return true;
      } else {
        robot.messageRoom(room, `Form reminder (${FS_FORMID[room]}) failed to be setup\nPlease ask my owner to check the logs`);
        //return false;
      };
    } else {
      robot.logger.error("standup-formstack-cron: Missing variable for room");
    };
  };

  // --- test for empty values in an array ---
  function TestArrayValues(array) {
    robot.logger.info("standup-formstack-cron: Testing array values");
    for (i = 0; i < array.length; i++) {
      if (!array[i] || array[i] === '' || array[i] == undefined) {
        // array does not have a value
        return false;
      };
    };
    return true;
  };

  // ---- Pull Data From Formstack HTTP Webhook ----
  // Get info about the form from http webhook (like url and field id's) and then save it to redis (hubot brain)
  function GetFormInfo(room) {
    let jdata;
    FSAPIURL[room] = `https://www.formstack.com/api/v2/form/${FS_FORMID[room]}`;
    const fsurl = `${FSAPIURL[room]}.json?oauth_token=${FS_TOKEN}`;
    robot.logger.info(`standup-formstack-cron: Calling API to get form data from formstack (${FSAPIURL[room]})`);
    // Call FS http get function
    return new Promise((resolve, reject) => {
      GetFormSubData(room, fsurl, (jdata) => {
        // Get form url
        FS_URL[room] = jdata.url;
        TIMEZONE[room] = jdata.timezone;
        robot.logger.info("standup-formstack-cron: Pulling form data from formstack json");
        // Get field id's by keyword search
        for (field of jdata.fields) {
          let fieldLabel = field.label.toLowerCase();
          if (fieldLabel.match(/\bdate\b/i)) {
            DATEFIELD_ID[room] = field.id;
          } else if (fieldLabel.match(/\byesterday\b|\bprevious\b/i)) {
            YDAY_ID[room] = field.id;
          } else if (fieldLabel.match(/\btoday\b/i)) {
            TDAY_ID[room] = field.id;
          } else if (fieldLabel.match(/\bimped|\bblock/i)) {
            BLOCK_ID[room] = field.id;
          } else if (fieldLabel.match(/\bfirst name\b/i)) {
            USERFN_ID[room] = field.id;
          } else if (fieldLabel.match(/\blast name\b/i)) {
            USERLN_ID[room] = field.id;
          };
        };

        // Array of all required formstack vars
        const fsredisarr = [FS_FORMID[room], DATEFIELD_ID[room], YDAY_ID[room], TDAY_ID[room], BLOCK_ID[room], USERFN_ID[room]];
        // test array and write vars to redis
        if (TestArrayValues(fsredisarr)) {
          try {
            robot.brain.set(`FS_${room}.FS_URL`, FS_URL[room]);
            robot.brain.set(`FS_${room}.FS_FORMID`, FS_FORMID[room]);
            robot.brain.set(`FS_${room}.DATEFIELD_ID`, DATEFIELD_ID[room]);
            robot.brain.set(`FS_${room}.YDAY_ID`, YDAY_ID[room]);
            robot.brain.set(`FS_${room}.TDAY_ID`, TDAY_ID[room]);
            robot.brain.set(`FS_${room}.BLOCK_ID`, BLOCK_ID[room]);
            robot.brain.set(`FS_${room}.USERFN_ID`, USERFN_ID[room]);
            robot.brain.set(`FS_${room}.USERLN_ID`, USERLN_ID[room]);
            robot.brain.set(`FS_${room}.FSAPIURL`, FSAPIURL[room]);
            robot.brain.set(`FS_${room}.TIMEZONE`, TIMEZONE[room]);
          } catch (err) {
            robot.logger.error(`standup-formstack-cron: Error saving to redis ${err}`);
            reject("error");
          };
        } else {
          robot.logger.error(`standup-formstack-cron: One or more variables are empty ${fsredisarr}`);
          robot.messageRoom(room, "I was not able to find the form, Please ask my owner to check the logs");
          reject("error");
        };
        robot.logger.info(`standup-formstack-cron: Form values were successfully pulled and saved to redis`);
        resolve("Done");
      });
    });
  };


  // ---- Pull Data From Redis ----
  // Get info about the form saved in redis (like url and field id's)
  function GetFormInfoRedis(room) {
    robot.logger.info("standup-formstack-cron: Gathering data from redis");
    // Set vars from redis data
    try {
      FS_URL[room] = robot.brain.get(`FS_${room}.FS_URL`);
      FS_FORMID[room] = robot.brain.get(`FS_${room}.FS_FORMID`);
      DATEFIELD_ID[room] = robot.brain.get(`FS_${room}.DATEFIELD_ID`);
      YDAY_ID[room] = robot.brain.get(`FS_${room}.YDAY_ID`);
      TDAY_ID[room] = robot.brain.get(`FS_${room}.TDAY_ID`);
      BLOCK_ID[room] = robot.brain.get(`FS_${room}.BLOCK_ID`);
      USERFN_ID[room] = robot.brain.get(`FS_${room}.USERFN_ID`);
      USERLN_ID[room] = robot.brain.get(`FS_${room}.USERLN_ID`);
      FSAPIURL[room] = robot.brain.get(`FS_${room}.FSAPIURL`);
      TIMEZONE[room] = robot.brain.get(`FS_${room}.TIMEZONE`);
      RANDOMIZE[room] = robot.brain.get(`FS_${room}.RANDOMIZE`);
    } catch (err) {
      robot.logger.error(`standup-formstack-cron: Error retreving from redis ${err}`);
    };

    // Array of required formstack vars
    const fsvararr = [FS_FORMID[room], DATEFIELD_ID[room], YDAY_ID[room], TDAY_ID[room], BLOCK_ID[room], USERFN_ID[room]];
    // test array of vars pulled from redis
    if (TestArrayValues(fsvararr)) {
      // got the info
      robot.logger.info(`standup-formstack-cron: Field Id's gathered from redis (${fsvararr})`);
      return true;
    } else {
      // Did not get all the info
      robot.logger.info("standup-formstack-cron: Could not read Field Id's in at least one var from redis");
      return false;
    };
  };

  // ---- remove a standup form from a room ----
  function RemoveStandup(room) {
    let rooms;
    robot.messageRoom(room, `Removing link to form ID ${FS_FORMID[room]} from this room`);
    robot.logger.info(`standup-formstack-cron: Removing form link ID ${FS_FORMID[room]} from room ${room}`);
    // remove brain entries
    try {
      robot.brain.remove(`FS_${room}.FS_URL`);
      robot.brain.remove(`FS_${room}.FS_FORMID`);
      robot.brain.remove(`FS_${room}.DATEFIELD_ID`);
      robot.brain.remove(`FS_${room}.YDAY_ID`);
      robot.brain.remove(`FS_${room}.TDAY_ID`);
      robot.brain.remove(`FS_${room}.BLOCK_ID`);
      robot.brain.remove(`FS_${room}.USERFN_ID`);
      robot.brain.remove(`FS_${room}.USERLN_ID`);
      robot.brain.remove(`FS_${room}.FSAPIURL`);
      robot.brain.remove(`FS_${room}.TIMEZONE`);
      robot.brain.remove(`FS_${room}.RANDOMIZE`);
    } catch (err) {
      robot.messageRoom(room, `There was an issue, please have my owner check my logs`);
      robot.logger.error(`standup-formstack-cron: Error deleting values in brain ${err}`);
      return;
    };
    // unset vars
    delete FS_URL[room];
    delete FS_FORMID[room];
    delete DATEFIELD_ID[room];
    delete YDAY_ID[room];
    delete TDAY_ID[room];
    delete BLOCK_ID[room];
    delete USERFN_ID[room];
    delete USERLN_ID[room];
    delete FSAPIURL[room];
    delete RANDOMIZE[room];

    try {
      robot.brain.get(`FS_${room}.FS_FORMID`);
    } catch (err) {
      robot.messageRoom(room, `There was an error when removing`);
      robot.logger.info(`standup-formstack-cron: Form failed to be removed from room ${room}. Error: ${err}`);
      return;
    };

    //Stop any crons that were setup
    robot.logger.info(`standup-formstack-cron: Removing any cron jobs that were setup`);
    if (STANDUP_REPORT_CRON_JOB[room].running) {
      STANDUP_REPORT_CRON_JOB[room].stop();
    };
    if (REMINDER_CRON_JOB[room].running) {
      REMINDER_CRON_JOB[room].stop();
    };
    if (STANDUP_REPORT_CRON_JOB[room].running || REMINDER_CRON_JOB[room].running) {
      robot.logger.info(`standup-formstack-cron: One or more cron jobs failed to stop`);
    };

    // remove room from list in redis
    rooms = robot.brain.get(`FS_Rooms`) || [];

    // filter out room to remove
    rooms = rooms.filter(e => e !== room);
    robot.brain.set(`FS_Rooms`, rooms);

    robot.messageRoom(room, `Removal Complete`);
    robot.logger.info(`standup-formstack-cron: Form has been removed from room ${room}`);
  };

  // ---- Date calculator and formater ----
  // returns formated current date "datefromat" and lookback date "mindate"
  function CalcDate(room) {
    let today;
    robot.logger.info(`standup-formstack-cron: Running calculations for the date`);
    //set date time to match timezone var time
    if (DateTime.local().setZone(TIMEZONE[room]).isValid) {
      today = DateTime.now().setZone(TIMEZONE[room]);
    } else {
      today = DateTime.now().setZone("America/Los_Angeles");
    };
    // create lookback date limit to filter submissions results using "min_time" param in url
    // formstack api "min_time" param is based on eastern time
    const mindate = `${DateTime.fromISO(today.minus({ days: DAYSBACK })).toFormat('yyyy-LL-dd')}`;
    const datefromat = DateTime.fromISO(today).toFormat('LLL dd, yyyy');

    // return formated dates
    if (datefromat && mindate) {
      return [datefromat, mindate];
    } else {
      robot.logger.error("standup-formstack-cron: Issue with date formats. One or more is missing");
    };
  };

  // ---- Return json from formstack web request ----
  // "room" and "fsurl" are passed in, "jbody" is the return
  function GetFormSubData(room, fsurl, callback) {
    robot.logger.info("standup-formstack-cron: Gathering json data from form api");
    // Get json of form submissions
    robot.http(fsurl)
      .header('Accept', 'application/json')
      .get()((err, res, body) => {
        if (err) {
          // send error message to room
          robot.messageRoom(room, `I was not able to connect to Formstack: ${res}`);
          robot.logger.error(`standup-formstack-cron: Error connecting to formstack: ${res}`);
          return;
        } else {
          const jdata = JSON.parse(body);
          if (jdata.error) {
            robot.messageRoom(room, "Somethings not right, have my owner take a look at my logs");
            robot.logger.error(`standup-formstack-cron: Error retreving data: ${jdata.error}`);
          };
          // send results to return function
          robot.logger.info(`standup-formstack-cron: Data retrived from API`);
          callback(jdata);
        };
      });
  };

  // ---- Format and Clean message data ----
  function FormatClean(room, entry, callback) {
    let message,
      userln;
    robot.logger.info(`standup-formstack-cron: Cleaning format of text for report`);
    // fuction to clean up submission text
    function CleanTxt(value) {
      // Clean trailing spaces
      let cleaned = value.replace(/\s+$/g, "");
      // Clean Leading spaces and leading hyphans
      cleaned = cleaned.replace(/^\s*\-+\s*|\s*\-+\s*$|^\s+/gm, "");
      // Clean trailing spaces..again
      cleaned = cleaned.replace(/\s+$/g, "");
      // Add tab and hyphan
      cleaned = cleaned.replace(/^/gm, "\t\- ");
      return cleaned;
    };

    // set vars for text from json data
    const datefield = entry.data[DATEFIELD_ID[room]].value;
    const yday = entry.data[YDAY_ID[room]].value;
    const tday = entry.data[TDAY_ID[room]].value;
    const block = entry.data[BLOCK_ID[room]].value;
    const userfn = entry.data[USERFN_ID[room]].value;
    if (USERLN_ID[room]) {
      userln = entry.data[USERLN_ID[room]].value;
    };
    // Join first and last if last exist
    const usern = [userfn, userln].filter(Boolean).join(" ");
    // assemble message
    // title with user name and date
    message = `*${usern}* - ${datefield}`;
    // title section Yesterday with user data below
    message += `\n\t*_Previous Stand Up:_*\n${CleanTxt(yday)}`;
    // title section today with user data below
    message += `\n\t*_Today:_*\n${CleanTxt(tday)}`;
    // skip blocker section if empty
    if (block !== "Nothing") {
      message += `\n\t*_Blockers:_*\n${CleanTxt(block)}`;
    };
    callback(message);
  };

  function shuffle(array) {
    let currentIndex = array.length,
      randomIndex;
    // While there remain elements to shuffle...
    while (currentIndex != 0) {
      // Pick a remaining element...
      randomIndex = Math.floor(Math.random() * currentIndex);
      currentIndex--;
      // And swap it with the current element.
      [array[currentIndex], array[randomIndex]] = [array[randomIndex], array[currentIndex]];
    }
    return array;
  }

  // ---- Form data Report for all users today ----
  function ReportStandup(room, CronRun) {
    let entry,
      message,
      messgaearray = [];
    robot.logger.info(`standup-formstack-cron: Running standard Standup report to room ${room}`);
    // Get dates needed
    // formstack url with form ID, token (oauth_token) and date range filter (min_time)
    const dates = CalcDate(room);
    const dateformat = dates[0];
    const mindate = dates[1];
    const fsurl = `${FSAPIURL[room]}/submission.json?data=true&expand_data=false&min_time=${encodeURI(mindate)}&oauth_token=${FS_TOKEN}`;

    // Callback return function of pased json from url
    GetFormSubData(room, fsurl, (jdata) => {
      // loop filtered submissions
      for (entry of jdata.submissions) {
        // get date in form
        const datefield = entry.data[DATEFIELD_ID[room]].value;
        // Parse submissions and match for today
        if (datefield === dateformat) {
          FormatClean(room, entry, (clnmessage) => {
            // Save data to var in higher scope
            messgaearray.push(clnmessage);
          });
        };
      };
      // post Funny message if no results are found
      if (messgaearray.length === 0 && CronRun) {
        const gone = [
          "Sooooo... Is everyone on holiday?",
          "Nothing? Was it something I said?",
          "Do you wanna build a snowman?... It doesn't have to be snowman... OK, bye",
          ":notes:Here I go again on my own!:notes:\n\tGoing down the only road I've ever know!:notes:",
          "Bueller? Bueller?... Bueller?....... Bueller?",
          "https://media.giphy.com/media/jNH0Bto1xBNwQ/giphy.gif",
          "Today was a day off wasn't it?... I wish I had a day off",
          "Great! I'm going back to sleep",
          `:rotating_light: ${robot.name} dance party!! :rotating_light: \n\thttps://media.giphy.com/media/v0YiARQxj1yc8/giphy.gif`,
          `*${robot.name} * - ${dateformat}\n\t*_Previous Stand Up:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Other duties as assigned\n\t*_Today:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Other duties as assigned\n\t*_Blockers:_*\n\t\- No one is here`
        ];
        robot.messageRoom(room, gone[Math.floor(Math.random() * gone.length)]);
      };
      // Randomize Post order
      if (RANDOMIZE[room]) {
        shuffle(messgaearray);
      }
      for (message of messgaearray) {
        robot.messageRoom(room, message);
      };
    });
  };

  // ---- Form data Report for single user ----
  function SingleReport(room, user) {
    let message,
      messageList = [];
    robot.logger.info(`standup-formstack-cron: Running single Standup report to room ${room}`);
    // Get dates needed
    const dates = CalcDate(room);
    const dateformat = dates[0];
    const mindate = dates[1];
    const fsurl = `${FSAPIURL[room]}/submission.json?data=true&expand_data=false&min_time=${encodeURI(mindate)}&oauth_token=${FS_TOKEN}`;
    // Callback return function of pased json from url
    GetFormSubData(room, fsurl, (jdata) => {
      // loop filtered submissions
      for (entry of jdata.submissions) {
        let userfn,
          datefield,
          userln;
        userfn = entry.data[USERFN_ID[room]].value;
        datefield = entry.data[DATEFIELD_ID[room]].value;
        if (USERLN_ID[room]) {
          userln = entry.data[USERLN_ID[room]].value;
        };
        // Join first and last if last exist
        const usern = [userfn, userln].filter(Boolean).join(" ");
        // build array of usernames for today
        if (datefield === dateformat) {
          // look up user
          if (usern.toLowerCase() === user.toLowerCase()
            || userfn.toLowerCase() === user.toLowerCase()
            || userln.toLowerCase() === user.toLowerCase()) {
            FormatClean(room, entry, (rtrnmessage) => {
              messageList.push(rtrnmessage);
            });
          };
        };
      };
      message = messageList.join("\n");
      if (!message) {
        message = `I'm not able to find a report for ${user}, but\n `;
        FilledItOut(room);
      };
      robot.messageRoom(room, message);
    });
  };

  // ---- List users who filled out report today ----
  function FilledItOut(room) {
    let message,
      users = [];
    robot.logger.info(`standup-formstack-cron: Running list of users that filled out report to room ${room}`);
    // Get dates needed
    const dates = CalcDate(room),
      dateformat = dates[0],
      mindate = dates[1],
      fsurl = `${FSAPIURL[room]}/submission.json?data=true&expand_data=false&min_time=${encodeURI(mindate)}&oauth_token=${FS_TOKEN}`;
    // Callback return function of pased json from url
    GetFormSubData(room, fsurl, (jdata) => {
      // loop filtered submissions
      for (entry of jdata.submissions) {
        let userfn,
          datefield,
          userln;
        userfn = entry.data[USERFN_ID[room]].value;
        datefield = entry.data[DATEFIELD_ID[room]].value;
        if (USERLN_ID[room]) {
          userln = entry.data[USERLN_ID[room]].value;
        };
        // Join first and last if last exist
        const usern = [userfn, userln].filter(Boolean).join(" ");
        // build array of usernames for today
        if (datefield === dateformat) {
          users.push(usern);
        };
      };
      // comma seperate users array and replace last comma with "and"
      const userList = users.join(", ").replace(/, ([^,]+)$/, ' and $1') || "No one";
      // set message and grammer to fit results
      if (users.length <= 1) {
        // message for 1 user
        message = `${userList} has filled out the report for today`;
      } else {
        // message for 2+ users
        message = `${userList} have filled out the report for today`;
      };
      // send message to room
      robot.messageRoom(room, message);
    });
  };

  function HelpReply(room) {
    let message = "";
    robot.logger.info(`standup-formstack-cron: Displaying Help to room ${room}`);
    if (ONHEAR) {
      message += `You can @${robot.name} or I'll listen for *${PREFIX}standup*\n`;
    };
    message += `${robot.name} ${PREFIX}standup - List results of standup form for today\n`;
    message += `${robot.name} ${PREFIX}standup today - List who has filled out the standup form\n`;
    message += `${robot.name} ${PREFIX}standup <USERNAME> - List results of standup form for today\n`;
    message += `${robot.name} ${PREFIX}standup randomize - Randomize the list of all results of standup form\n`
    message += `${robot.name} ${PREFIX}standup remove - Remove a form from a room\n`;
    message += `${robot.name} ${PREFIX}standup setup FORMID TIME REMINDER CRONDAYS - Setup the script for the first time\n`;
    message += `\tFORMID - Formstack Form ID\n`;
    message += `\tTIME - Time of auto post (8:00am or 14:00)\n`;
    message += `\tREMINDER - Number of minutes before to send reminder (15) Default 30\n`;
    message += `\tCRONDAYS - Days to post in cron format (1-5 or 0,1,2,3) 0 = Sunday. Default 1-5 (weekdays)\n`;
    message += `\tReminder and crondays can be skipped to accept defaults`;
    robot.messageRoom(room, message);
  };
};
