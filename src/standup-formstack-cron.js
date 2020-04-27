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

  Formstack form MUST have feild with the following terms (in any order).
  The fields do not need to be verbatim and are not case sensitive.
  "Date of report" would work for the "Date" feild:
    'Date' () - (REQUIRED) Formstack date the report is for
    'Yesterday' - (REQUIRED) Formstack tasks from Yesterday
    'Today' - (REQUIRED) Formstack tasks for Today
    'Blocker' or 'Impeding' - (REQUIRED) Blockers or items keeping work on tasks from happening
    'first name' - (REQUIRED) Formstack User (first or other) name
    'last name' - (OPTIONAL) Formstack User Last Name

  HUBOT_FORMSTACK_PREFIX - (OPTIONAL) set a prefix for multiple standup reports
  HUBOT_FORMSTACK_HEAR - (Optional) Turn on or off hubot hear (default off)
  HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK - (OPTIONAL) Formstack submissions limiter
  HUBOT_FORMSTACK_CHAT_ROOM_NAME - (REQUIRED FOR REMINDER) Chat room name for auto reminder d report
  HUBOT_FORMSTACK_TIMEZONE - (REQUIRED FOR REMINDER)

  HUBOT_FORMSTACK_REMINDER_CRON - (REQUIRED FOR REMINDER) schedule a reminder to fill the form
  HUBOT_FORMSTACK_STANDUP_REPORT_CRON - (REQUIRED FOR AUTO REPORT) schedule to send the submissions

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
  - Future Feature?? multiple standup reports
    - based room, setup by hubot and linked to room
    - add standup command that would capture room and form ID
*/

const FS_TOKEN = process.env.HUBOT_FORMSTACK_TOKEN; //(Required) Formstack API Token
// Formstack form and feild ID's
var FS_FORMID = process.env.HUBOT_FORMSTACK_FORM_ID; //(Required) Formstack form ID

var PREFIX = process.env.HUBOT_FORMSTACK_PREFIX && (PREFIX = process.env.HUBOT_FORMSTACK_PREFIX + "-") || ""; //(Optional) set a prefix for multiple standup reports

const ONHEAR = process.env.HUBOT_FORMSTACK_HEAR || false; //(Optional) Turn on or off hubot hear (default off)

const DAYSBACK = process.env.HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK || 10; //(Optional) filter formstack submissions within X day ago

const ROOM = process.env.HUBOT_FORMSTACK_CHAT_ROOM_NAME; //(Required for reminder and report) Chat room name for auto reminder and report
const TIMEZONE = process.env.HUBOT_FORMSTACK_TIMEZONE || 'America/New_York'; //(Optional for reminder and report) Timezone for cron

const REMINDER_CRON = process.env.HUBOT_FORMSTACK_REMINDER_CRON; //(Required for reminder) schedule a reminder to fill the form
const STANDUP_REPORT_CRON = process.env.HUBOT_FORMSTACK_STANDUP_REPORT_CRON; //(Required for auto report) schedule to send the submissions
const FSAPIURL = 'https://www.formstack.com/api/v2/form/' + FS_FORMID; // Building the API url
var FS_URL, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID, USERLN_ID;

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
      robot.messageRoom(ROOM, `@here Time to fill out the stand up report ${FS_URL}\n`);
      // fuction to list who has filled out the form
      return FilledItOut(ROOM);
    }, null, true, TIMEZONE);
    REMINDER_CRON_JOB.start;
  } else {
    robot.logger.error("Missing variable for reminder cron");
  };

  if (STANDUP_REPORT_CRON && ROOM) {
    // Report results cron
    STANDUP_REPORT_CRON_JOB = new CronJob(STANDUP_REPORT_CRON, function() {
      // fuction to list results of form for today
      return ReportStandup(ROOM);
    }, null, true, TIMEZONE);
    STANDUP_REPORT_CRON_JOB.start;
  } else {
    robot.logger.error("Missing variable for standup cron");
  };

  // Check formstack token is set
  if (!FS_TOKEN) {
    robot.logger.error("Missing formstack token");
  }
  if (!FS_FORMID) {
    robot.logger.error("Missing formstack ID");
  }


  //TEST New Vars

  robot.respond(/this http fs test/i, (msg) => {
    msg.finish();
    GetFormInfo(msg);
  });

  robot.respond(/this http fs test2/i, (msg) => {
    msg.finish();
    var FS_URL, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID, USERLN_ID;
    GetFormInfoRedis(msg);
  });

  function GetFormInfo(msg) {
    // set / clear local vars
    var jdata, FS_RD_ARR;
    var FS_RD_ARR_NULL = [];
    var room = msg.message.room;
    FSURL = `${FSAPIURL}.json?oauth_token=${FS_TOKEN}`;
    robot.logger.info("FS_RD_ARR_NULL is "+FS_RD_ARR_NULL);

    // Call FS http get function
    GetFormData(room, FSURL, (jdata) => {
      // Get form url
      FS_URL = jdata.url;
      // Get field id's by keyword search
      for (field of jdata.fields) {
        if (field.label.toLowerCase().includes("date")) {
          DATEFIELD_ID = field.id;
        } else if (field.label.toLowerCase().includes("yesterday")) {
          YDAY_ID = field.id;
        } else if (field.label.toLowerCase().includes("today")) {
          TDAY_ID = field.id;
        } else if (field.label.toLowerCase().includes("impeding") || field.label.toLowerCase().includes("blocking")) {
          BLOCK_ID = field.id;
        } else if (field.label.toLowerCase().includes("first name")) {
          USERFN_ID = field.id;
        } else if (field.label.toLowerCase().includes("last name")) {
          USERLN_ID = field.id;
        };
      };
      // // Array of formstack vars
      // var FS_ARR = [FS_URL, FS_FORMID, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID, USERLN_ID];
      // // Check array for null
      // var FS_ARR_VALID = !FS_ARR.includes(undefined);
      // // if all in array are valid save vars to redis
      // if (FS_ARR_VALID) {
      //   robot.brain.set(`FS_${room}:FS_URL`, FS_URL);
      //   robot.brain.set(`FS_${room}:FS_FORMID`, FS_FORMID);
      //   robot.brain.set(`FS_${room}:DATEFIELD_ID`, DATEFIELD_ID);
      //   robot.brain.set(`FS_${room}:YDAY_ID`, YDAY_ID);
      //   robot.brain.set(`FS_${room}:TDAY_ID`, TDAY_ID);
      //   robot.brain.set(`FS_${room}:BLOCK_ID`, BLOCK_ID);
      //   robot.brain.set(`FS_${room}:USERFN_ID`, USERFN_ID);
      //   robot.brain.set(`FS_${room}:USERLN_ID`, USERLN_ID);
      // } else {
      //   robot.logger.error("One or more variables are empty");
      // }
      try {
        robot.brain.set(`FS_${room}:FS_URL`, FS_URL);
        robot.brain.set(`FS_${room}:FS_FORMID`, FS_FORMID);
        robot.brain.set(`FS_${room}:DATEFIELD_ID`, DATEFIELD_ID);
        robot.brain.set(`FS_${room}:YDAY_ID`, YDAY_ID);
        robot.brain.set(`FS_${room}:TDAY_ID`, TDAY_ID);
        robot.brain.set(`FS_${room}:BLOCK_ID`, BLOCK_ID);
        robot.brain.set(`FS_${room}:USERFN_ID`, USERFN_ID);
        robot.brain.set(`FS_${room}:USERLN_ID`, USERLN_ID);
      } catch(err) {
        robot.logger.info("Could not save info to redis "+err.message);
      }

    });
  };

// Get form info from redis
function GetFormInfoRedis(msg) {
  try {
    robot.brain.get(`FS_${room}:FS_URL`);
    robot.brain.get(`FS_${room}:FS_FORMID`); robot.brain.get(`FS_${room}:DATEFIELD_ID`);
    robot.brain.get(`FS_${room}:YDAY_ID`);
    robot.brain.get(`FS_${room}:TDAY_ID`);
    robot.brain.get(`FS_${room}:BLOCK_ID`);
    robot.brain.get(`FS_${room}:USERFN_ID`);
    robot.brain.get(`FS_${room}:USERLN_ID`);
  } catch(err) {
    robot.logger.info("Could not get info from redis "+err.message);
    //GetFormInfo(msg);
  };
};



  //END TEST






  // ---- ad-hoc commands ----
  var regx = "standup(?:\\s+)?(\\w+(?:\\s+\\w+)?)?$";
  // Hear command without addressing hubot
  if (ONHEAR) {
    robot.hear(new RegExp("^" + PREFIX + regx, 'i'), (msg) => {
      msg.finish();
      BotRespond(msg);
    });
  };
  // Respond to command by addressign hubot
  robot.respond(new RegExp(PREFIX + regx, 'i'), (msg) => {
    msg.finish();
    BotRespond(msg);
  });

  function BotRespond(msg) {
    var room, rxmatch;
    room = msg.message.room;
    rxmatch = msg.match[1];
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
      robot.logger.error("Issue with date formats. One or more is missing");
    };
  };
  // ---- Return json from formstack web request ----
  // "room" and "fsurl" are passed in, "jbody" is the return
  function GetFormData(room, fsurl, jbody) {
      // DEBUG
      robot.logger.info("In GetFormData function");

    // Get json of form submissions
    robot.http(fsurl).get()((err, res, body) => {
        // DEBUG
        robot.logger.info("In GetFormData function http");

      if (err) {
        // send error message to room
        //robot.messageRoom(room, `I was not able to connect to Formstack: ${res}`);
        robot.logger.error(`Error connecting to formstack: ${res}`);
        return;
      } else {
        var jdata = JSON.parse(body);
        if (jdata.error) {
          //robot.messageRoom(room, "Somethings not right, have my owner take a look at my logs");
          robot.logger.error(`Error retreving data: ${jdata.error}`);
        };
          // DEBUG
          robot.logger.info("finish GetFormData function - no error");

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
    GetFormData(room, FSURL, (jdata) => {
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
      if (message === "") {
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
    GetFormData(room, FSURL, (jdata) => {
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
    GetFormData(room, FSURL, (jdata) => {
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
