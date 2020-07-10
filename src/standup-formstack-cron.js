/*
Description:
  Report standup notes that were filled in using formstack

Commands:
  hubot standup - List results of standup form for today
  hubot standup today - List who has filled out the standup form
  hubot standup <USERNAME> - List results of standup form for today

Author:
  Seth Rouggly <srouggly@apu.edu>

Configuration:
  HUBOT_FORMSTACK_TOKEN - (REQUIRED) Formstack API Token
  HUBOT_FORMSTACK_FORM_ID - (REQUIRED) Formstack form ID

  Formstack form MUST have feilds with the following terms (in any order).
  The fields do not need to be verbatim and are not case sensitive.
  "Date of report" would work for the "Date" feild:
    'Date' - (REQUIRED) Formstack date the report is for
    'Yesterday' - (REQUIRED) Formstack tasks from Yesterday
    'Today' - (REQUIRED) Formstack tasks for Today
    'Blocker' or 'Impeding' - (REQUIRED) Blockers or items keeping work or tasks from happening
    'first name' - (REQUIRED) Formstack User (first or other) name
    'last name' - (OPTIONAL) Formstack User Last Name

  HUBOT_FORMSTACK_PREFIX - (OPTIONAL) set a prefix for multiple standup reports
  HUBOT_FORMSTACK_HEAR - (OPTIONAL) Turn on or off hubot hear (default off)
  HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK - (OPTIONAL) Formstack submissions limiter (default 5 days)
  HUBOT_FORMSTACK_CHAT_ROOM_NAME - (REQUIRED FOR REMINDER) Chat room name for auto reminder and report
  HUBOT_FORMSTACK_TIMEZONE - (REQUIRED FOR REMINDER) default New York

  HUBOT_FORMSTACK_REMINDER_CRON - (REQUIRED FOR REMINDER) schedule a reminder to fill out the form
  HUBOT_FORMSTACK_STANDUP_REPORT_CRON - (REQUIRED FOR AUTO REPORT) schedule to post the submissions

Notes:
  Formstack is an online form builder (https://www.formstack.com/)
    Form required fields:
    - Date Feild
    - Yesterday notes
    - Today Notes
    - Blocker Notes
    - First Name
    - Last Name

Dependencies:
  "hubot-redis-brain": "",
  "cron": ">=1.7.2"

TODO:
  - Timezone adjustment for list from day
  - Friendlier way to set cron reminder and schedule
    - Schedule: Set days of week - (M-F or Custom span)
    - Schedule: Set Time of day
    - Remind x minutes before
  - Future Feature?? multiple standup reports
    - based room, setup by hubot and linked to room
    - add standup command that would capture room and form ID to redis (hubot brain)
*/

const FS_TOKEN = process.env.HUBOT_FORMSTACK_TOKEN; //(Required) Formstack API Token
// Formstack form and feild ID's
var FS_FORMID = process.env.HUBOT_FORMSTACK_FORM_ID; //(Required) Formstack form ID

var PREFIX = process.env.HUBOT_FORMSTACK_PREFIX && (PREFIX = process.env.HUBOT_FORMSTACK_PREFIX + "-") || ""; //(Optional) set a prefix for multiple standup reports

const ONHEAR = process.env.HUBOT_FORMSTACK_HEAR || false; //(Optional) Turn on or off hubot hear (default off)

const DAYSBACK = process.env.HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK || 5; //(Optional) filter formstack submissions within X day ago

const ROOM = process.env.HUBOT_FORMSTACK_CHAT_ROOM_NAME; //(Required for reminder and report) Chat room name for auto reminder and report
const TIMEZONE = process.env.HUBOT_FORMSTACK_TIMEZONE || 'America/New_York'; //(Required for reminder and report) Timezone for cron (default 'America/New_York')

const REMINDER_CRON = process.env.HUBOT_FORMSTACK_REMINDER_CRON; //(Required for reminder) schedule a reminder to fill the form
const STANDUP_REPORT_CRON = process.env.HUBOT_FORMSTACK_STANDUP_REPORT_CRON; //(Required for auto report) schedule to send the submissions
const FSAPIURL = 'https://www.formstack.com/api/v2/form/' + FS_FORMID; // Building the API url

module.exports = (robot) => {
  // Push Help Commands
  robot.commands.push(`hubot ${PREFIX}standup - List results of standup form for today`);
  robot.commands.push(`hubot ${PREFIX}standup today - List who has filled out the standup form`);
  robot.commands.push(`hubot ${PREFIX}standup <USERNAME> - List results of standup form for today`);

  // cron module
  const CronJob = require('cron').CronJob;
  // Reminder with names of those who already filled it out cron
  if (REMINDER_CRON && ROOM) {
    // Reminder Cron
    REMINDER_CRON_JOB = new CronJob(REMINDER_CRON, function() {
      GetFormInfoRedis(ROOM);
      robot.messageRoom(ROOM, `@here Time to fill out the <${FS_URL}|stand up report>\n`);
      // fuction to list who has filled out the form
      return FilledItOut(ROOM);
    }, null, true, TIMEZONE);
    REMINDER_CRON_JOB.start;
  } else {
    robot.logger.error("standup-formstack-cron: Missing variable for reminder cron");
  };

  if (STANDUP_REPORT_CRON && ROOM) {
    // Report results cron
    STANDUP_REPORT_CRON_JOB = new CronJob(STANDUP_REPORT_CRON, function() {
      GetFormInfoRedis(ROOM);
      // fuction to list results of form for today
      return ReportStandup(ROOM);
    }, null, true, TIMEZONE);
    STANDUP_REPORT_CRON_JOB.start;
  } else {
    robot.logger.error("standup-formstack-cron: Missing variable for standup cron");
  };

  // Check formstack token is set
  if (!FS_TOKEN) {
    robot.logger.error("standup-formstack-cron: Missing formstack token");
  }
  if (!FS_FORMID) {
    robot.logger.error("standup-formstack-cron: Missing formstack ID");
  }

  // ---- ad-hoc commands ----
  var regx = "standup\\s+(\\w+(?:\\s+\\w+)?)?$";
  // Hear command without addressing hubot
  if (ONHEAR) {
    robot.hear(new RegExp("^" + PREFIX + regx, 'i'), (msg) => {
      msg.finish();
      BotRespond(msg);
    });
  };
  // Respond to command by addressing hubot
  robot.respond(new RegExp(PREFIX + regx, 'i'), (msg) => {
    msg.finish();
    BotRespond(msg);
  });

  function BotRespond(msg) {
    var room, rxmatch;
    room = msg.message.room;
    rxmatch = msg.match[1];
    GetFormInfoRedis(room);
    // Logic to seperate the commands
    if (rxmatch && rxmatch.toLowerCase() === "today") {
      // fuction to list all users that filled out the form
      FilledItOut(room);
    } else if (rxmatch && rxmatch.toLowerCase() === "help") {
      // function to list a single user that filled out the form
      HelpReply(room);
    } else if (rxmatch && (rxmatch.toLowerCase() !== "today"
        || rxmatch.toLowerCase() !== "help")) {
      // function to list a single user that filled out the form
      SingleReport(room, rxmatch);
    } else if (!rxmatch) {
      // fuction to list results of form for today
      ReportStandup(room);
    };
  };

  // ---- Pull Data From Formstack HTTP Webhook ----
  // Get info about the form from http webhook (like url and field id's) and then save it to redis (hubot brain)
  function GetFormInfo(room) {
    // set / clear local vars
    var jdata, FS_RD_ARR;
    var FS_RD_ARR_NULL = [];
    FSURL = `${FSAPIURL}.json?oauth_token=${FS_TOKEN}`;
    // Call FS http get function
    GetFormSubData(room, FSURL, (jdata) => {
      // Get form url
      FS_URL = jdata.url;
      // Get field id's by keyword search
      for (field of jdata.fields) {
        if (field.label.toLowerCase().match(/date/i)) {
          DATEFIELD_ID = field.id;
        } else if (field.label.toLowerCase().match(/\byesterday\b/i)) {
          YDAY_ID = field.id;
        } else if (field.label.toLowerCase().match(/\btoday\b/i)) {
          TDAY_ID = field.id;
        } else if (field.label.toLowerCase().match(/\bimped|\bblock/i)) {
          BLOCK_ID = field.id;
        } else if (field.label.toLowerCase().match(/\bfirst name\b/i)) {
          USERFN_ID = field.id;
        } else if (field.label.toLowerCase().match(/\blast name\b/i)) {
          USERLN_ID = field.id;
        };
      };
      // Array of all required formstack vars
      var FS_ARR = [FS_FORMID, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID];
      // Check array for null
      var FS_ARR_NULL = FS_ARR.includes(undefined);
      var FS_ARR_NULL2 = FS_ARR.includes('');
      // if one in array is undefined or empty, get info from webhook
      if (FS_ARR_NULL === false || FS_ARR_NULL2 === false || !FS_ARR.length === false) {
        robot.brain.set(`FS_${room}:FS_URL`, FS_URL);
        robot.brain.set(`FS_${room}:FS_FORMID`, FS_FORMID);
        robot.brain.set(`FS_${room}:DATEFIELD_ID`, DATEFIELD_ID);
        robot.brain.set(`FS_${room}:YDAY_ID`, YDAY_ID);
        robot.brain.set(`FS_${room}:TDAY_ID`, TDAY_ID);
        robot.brain.set(`FS_${room}:BLOCK_ID`, BLOCK_ID);
        robot.brain.set(`FS_${room}:USERFN_ID`, USERFN_ID);
        robot.brain.set(`FS_${room}:USERLN_ID`, USERLN_ID);
        robot.logger.info("standup-formstack-cron: Data saved to redis");
      } else {
        robot.logger.error("standup-formstack-cron: One or more variables are empty");
        robot.messageRoom(room, "I was not able to find the form, Please ask my owner to check the logs");
      }
    });
  };

  // ---- Pull Data From Redis ----
  // Get info about the form saved in redis (like url and field id's)
  function GetFormInfoRedis(room) {
    // Clear Vars
    var FS_URL, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID, USERLN_ID;
    // Get vars from redis
    FS_URL = robot.brain.get(`FS_${room}:FS_URL`);
    FS_FORMID = robot.brain.get(`FS_${room}:FS_FORMID`);
    DATEFIELD_ID = robot.brain.get(`FS_${room}:DATEFIELD_ID`);
    YDAY_ID = robot.brain.get(`FS_${room}:YDAY_ID`);
    TDAY_ID = robot.brain.get(`FS_${room}:TDAY_ID`);
    BLOCK_ID = robot.brain.get(`FS_${room}:BLOCK_ID`);
    USERFN_ID = robot.brain.get(`FS_${room}:USERFN_ID`);
    USERLN_ID = robot.brain.get(`FS_${room}:USERLN_ID`);
    // Array of required formstack vars
    var FS_ARR = [FS_FORMID, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID];
    // Check array for null
    var FS_ARR_NULL = FS_ARR.includes(undefined);
    var FS_ARR_NULL2 = FS_ARR.includes('');
    // if one in array is undefined or empty, get info from webhook

    if (FS_ARR_NULL === false || FS_ARR_NULL2 === false || !FS_ARR.length === false) {
      robot.logger.info("standup-formstack-cron: Could not get info from redis");
      GetFormInfo(room);
    } else {
      robot.logger.info("standup-formstack-cron: Data gathered from redis");
    };
  };

  // ---- Date calculator and formater ----
  // returns formated current date "DATEFORMAT" and lookback date "MINDATE"
  function CalcDate() {
    // TODO set date to match timezone var
    var TODAY = new Date;
    var TODAYBACK = new Date;
    // Set date lookback XX amount of days
    TODAYBACK.setDate(TODAYBACK.getDate() - DAYSBACK);
    // create lookback date limit to filter submissions results using "min_time" param in url
    // "min_time" param is based on eastern time
    var MINDATE = TODAYBACK.getFullYear() + "-" + (TODAYBACK.getMonth() + 1) + "-" + TODAYBACK.getDate() + " 13:45:00";
    // Set Month array
    var MTHREE = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    // create formated month day year for formstack lookup (Jan 01, 2019)
    // (`0${TODAY.getDate()}`).slice(-2) creates a two digit day
    var DATEFORMAT = (MTHREE[TODAY.getMonth()]+" "+(`0${TODAY.getDate()}`).slice(-2)+", "+TODAY.getFullYear());
    // return formated dates
    if (DATEFORMAT && MINDATE) {
      return [DATEFORMAT, MINDATE];
    } else {
      robot.logger.error("standup-formstack-cron: Issue with date formats. One or more is missing");
    };
  };

  // ---- Return json from formstack web request ----
  // "room" and "fsurl" are passed in, "jbody" is the return
  function GetFormSubData(room, fsurl, jbody) {
    // Get json of form submissions
    robot.http(fsurl).get()((err, res, body) => {
      if (err) {
        // send error message to room
        robot.messageRoom(room, `I was not able to connect to Formstack: ${res}`);
        robot.logger.error(`standup-formstack-cron: Error connecting to formstack: ${res}`);
        return;
      } else {
        var jdata = JSON.parse(body);
        if (jdata.error) {
          robot.messageRoom(room, "Somethings not right, have my owner take a look at my logs");
          robot.logger.error(`standup-formstack-cron: Error retreving data: ${jdata.error}`);
        };
        // send results to return function
        jbody(jdata);
      };
    });
  };

  // ---- Format and Clean message data ----
  function FormatClean(entry, clnmessage) {
    var yday, tday, block, message, userfn, userln, usern;
    // fuction to clean up submission text
    function CleanTxt(value) {
      // Clean trailing spaces
      Cleaned1 = value.replace(/\s+$/g, "");
      // Clean Leading spaces and leading hyphans
      Cleaned2 = Cleaned1.replace(/^\s*\-+\s*|\s*\-+\s*$|^\s+/gm, "");
      // Clean trailing spaces..again
      Cleaned3 =Cleaned2.replace(/\s+$/g, "");
      // Add tab and hyphan
      return Cleaned3.replace(/^/gm, "\t\- ");
    };

    // set vars for text from json data
    datefield = entry.data[DATEFIELD_ID].value;
    userfn = entry.data[USERFN_ID].value;
    yday = entry.data[YDAY_ID].value;
    tday = entry.data[TDAY_ID].value;
    block = entry.data[BLOCK_ID].value;
    if (USERLN_ID) {
      userln = entry.data[USERLN_ID].value;
    };
    // Join first and last if last exist
    usern = [userfn, userln].filter(Boolean).join(" ");
    // assemble message
    // title with user name and date
    message = `*${usern}* - ${datefield}`;
    // title section Yesterday with user data below
    message += "\n\t*_Yesterday:_*\n" + CleanTxt(yday);
    // title section Today with user data below
    message += "\n\t*_Today:_*\n" + CleanTxt(tday);
    // skip blocker section if empty
    if (block !== "Nothing") {
      message += "\n\t*_Blockers:_*\n" + CleanTxt(block);
    };
    clnmessage(message);
  };

  // ---- Form data Report for all users today ----
  function ReportStandup(room) {
    var entry, message, FSURL;
    // Get dates needed
    Dates = CalcDate();
    DATEFORMAT = Dates[0];
    MINDATE = Dates[1];
    // formstack url with form ID, token (oauth_token) and date range filter (min_time)
    FSURL = `${FSAPIURL}/submission.json?data=true&expand_data=false&min_time=${encodeURI(MINDATE)}&oauth_token=${FS_TOKEN}`;

    // Callback return function of pased json from url
    GetFormSubData(room, FSURL, (jdata) => {
      // loop filtered submissions
      for (entry of jdata.submissions) {
        // get date in form
        datefield = entry.data[DATEFIELD_ID].value;
        // Parse submissions and match for today
        if (datefield === DATEFORMAT) {
          FormatClean(entry, (message) => {
            robot.messageRoom(room, message);
          });
        };
      };
      if (!message) {
        // Funny messages hubot sends if no results are found
        var gone = [
          "Sooooo... Is everyone on holiday?",
          "Nothing? Was it something I said?",
          "Do you wanna build a snowman?... It doesn't have to be snowman... OK, bye",
          ":notes:Here I go agian on my own!:notes:\n\tGoing down the only road I've ever know!:notes:",
          "Bueller? Bueller?... Bueller?....... Bueller?",
          "https://media.giphy.com/media/jNH0Bto1xBNwQ/giphy.gif",
          "Today was a day off wasn't it?... I wish I had a day off",
          "Great! I'm going back to sleep",
          ":rotating_light: " + robot.name + " dance party!! :rotating_light: \n\thttps://media.giphy.com/media/v0YiARQxj1yc8/giphy.gif",
          "*" + robot.name + "* - " + DATEFORMAT + "\n\t*_Yesterday:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Other duties as assigned\n\t*_Today:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Other duties as assigned\n\t*_Blockers:_*\n\t\- No one is here"
        ];
        robot.messageRoom(room, gone[Math.floor(Math.random()*gone.length)]);
      };
    });
  };

  // ---- Form data Report for single user ----
  function SingleReport(room, user) {
    var message, userfn, userln, usern, FSURL;
    var messageList = [];
    // Get dates needed
    Dates = CalcDate();
    DateFormat = Dates[0];
    MINDATE = Dates[1];
    FSURL = `${FSAPIURL}/submission.json?data=true&expand_data=false&min_time=${encodeURI(MINDATE)}&oauth_token=${FS_TOKEN}`;
    // Callback return function of pased json from url
    GetFormSubData(room, FSURL, (jdata) => {
      // loop filtered submissions
      for (entry of jdata.submissions) {
        userfn = entry.data[USERFN_ID].value;
        datefield = entry.data[DATEFIELD_ID].value;
        if (USERLN_ID) {
          userln = entry.data[USERLN_ID].value;
        };
        // Join first and last if last exist
        usern = [userfn, userln].filter(Boolean).join(" ");
        // build array of usernames for today
        if (datefield === DateFormat) {
          // look up user
          if (usern.toLowerCase() === user.toLowerCase()
              || userfn.toLowerCase() === user.toLowerCase()
              || userln.toLowerCase() === user.toLowerCase()) {
            FormatClean(entry, (RtrnMessage) => {
              messageList.push(RtrnMessage);
            });
          };
        };
      };
      message = messageList.join("\n");
      if (!message) {
        message = `I'm not able to find ${user}\n`;
        FilledItOut(room);
      };
      robot.messageRoom(room, message);
    });
  };

  // ---- List users who filled out report today ----
  function FilledItOut(room) {
    var message, userfn, userln, usern;
    // Get dates needed
    Dates = CalcDate();
    DateFormat = Dates[0];
    MINDATE = Dates[1];
    FSURL = `${FSAPIURL}/submission.json?data=true&expand_data=false&min_time=${encodeURI(MINDATE)}&oauth_token=${FS_TOKEN}`;
    // Callback return function of pased json from url
    GetFormSubData(room, FSURL, (jdata) => {
      var users = [];
      // loop filtered submissions
      for (entry of jdata.submissions) {
        userfn = entry.data[USERFN_ID].value;
         datefield = entry.data[DATEFIELD_ID].value;
        if (USERLN_ID) {
           userln = entry.data[USERLN_ID].value;
        };
        // Join first and last if last exist
        usern = [userfn, userln].filter(Boolean).join(" ");
        // build array of usernames for today
        if (datefield === DateFormat) {
          users.push(usern);
        };
      };
      // comma seperate users array and replace last comma with "and"
      userList = users.join(", ").replace(/, ([^,]+)$/, ' and $1');
      // set message and grammer to fit results
      if (users.length === 0) {
        // message for no users
        message = "No one has filled out the report for today";
      } else if (users.length === 1) {
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
    var message = "";
    if (ONHEAR) {
      message += `You can @${robot.name} or I'll listen for *${PREFIX}standup*\n`
    }
    message += `${robot.name} ${PREFIX}standup - List results of standup form for today\n`;
    message += `${robot.name} ${PREFIX}standup today - List who has filled out the standup form\n`;
    message +=`${robot.name} ${PREFIX}standup <USERNAME> - List results of standup form for today`;
    robot.messageRoom(room, message);
  };
};
