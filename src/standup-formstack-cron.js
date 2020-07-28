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
  HUBOT_FORMSTACK_TIMEZONE - (REQUIRED FOR REMINDER) default New York

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

const FS_TOKEN = process.env.HUBOT_FORMSTACK_TOKEN; //(Required) Formstack API Token
var PREFIX = process.env.HUBOT_FORMSTACK_PREFIX && (PREFIX = `${process.env.HUBOT_FORMSTACK_PREFIX}-`) || ""; //(Optional) set a prefix for multiple standup reports
var ONHEAR = process.env.HUBOT_FORMSTACK_HEAR || false; //(Optional) Turn on or off hubot hear (default off)
var DAYSBACK = process.env.HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK || 5; //(Optional) filter formstack submissions within X day ago
var TIMEZONE = process.env.HUBOT_FORMSTACK_TIMEZONE || 'America/New_York'; //(Required for reminder and report) Timezone for cron (default 'America/New_York')


module.exports = (robot) => {
  // Push Help Commands
  robot.commands.push(`hubot ${PREFIX}standup - List results of standup form for today`);
  robot.commands.push(`hubot ${PREFIX}standup today - List who has filled out the standup form`);
  robot.commands.push(`hubot ${PREFIX}standup <USERNAME> - List results of standup form for today`);
  robot.commands.push(`hubot ${PREFIX}standup setup - setup a form in a room (see help for more)`);
  robot.commands.push(`hubot ${PREFIX}standup remove - remove a form from a room`);
  robot.commands.push(`hubot ${PREFIX}standup help - List command help and how to set up chat room`);

  // cron module
  const CronJob = require('cron').CronJob;

  // timezone module
  var { DateTime } = require('luxon');

  // Backwards Compatability
  if (process.env.HUBOT_FORMSTACK_FORM_ID && process.env.HUBOT_FORMSTACK_CHAT_ROOM_NAME) {
    robot.logger.info("standup-formstack-cron: Setting up Form from env's");
    let ID = process.env.HUBOT_FORMSTACK_FORM_ID;
    let RM = process.env.HUBOT_FORMSTACK_CHAT_ROOM_NAME;
    // Auto setup form from env's
    SetupForm(RM, ID);
    // Auto setup cron from env's
    if ((process.env.HUBOT_FORMSTACK_REMINDER_CRON || process.env.HUBOT_FORMSTACK_STANDUP_REPORT_CRON) && process.env.HUBOT_FORMSTACK_TIMEZONE) {
      robot.logger.info("standup-formstack-cron: Setting up Cron from env's");
      let MN = process.env.HUBOT_FORMSTACK_REMINDER_CRON;
      let RP = process.env.HUBOT_FORMSTACK_STANDUP_REPORT_CRON;
      let TM = process.env.HUBOT_FORMSTACK_TIMEZONE;
      SetCron(RM, RP, MN, TM);
    };
  };


  // ---- ad-hoc commands ----
  //var regx = "standup\\s+(\\w+(?:\\s+\\w+)?)?$";
  var regx = "standup\\s*(setup (\\d+)\\s*(?:(\\d{1,2}:\\d{2}(?:am|pm)?|\\d{4}) ?(?:(\\d{1,2}) ?([0-6]\\-[0-6]|[0-6](?:,[0-6]){0,6})?)?)?|\\w+(?:\\s+[a-z]+)?)?$";

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

  // Parse responce for commands
  function BotRespond(msg) {
    var room, rxmatch;
    room = msg.message.room;
    rxmatch = msg.match[1];
    robot.logger.info("standup-formstack-cron: Bot responding to command");
    // Check formstack token is set
    if (!FS_TOKEN) {
      robot.messageRoom(room, "Unable to run this plugin\nCannot find the Formstack token");
      robot.logger.error("standup-formstack-cron: Missing formstack token. Please add global variable");
      return;
    };
    GetFormInfoRedis(room);
    if (FS_FORMID){
      if (rxmatch) {
        // Logic to seperate the commands
        if (rxmatch.toLowerCase() === "today") {
          // fuction to list all users that filled out the form
          FilledItOut(room);
        } else if (rxmatch.toLowerCase() === "remove") {
          // function to remove standup from room
          RemoveStandup(room);
        } else if (rxmatch.toLowerCase() === "help") {
        // function to list available commands
          HelpReply(room);
        } else if (!["today", "help", "setup", "remove"].includes(rxmatch)) {
          // function to list a single user that filled out the form
          SingleReport(room, rxmatch);
        } else if (rxmatch && rxmatch.toLowerCase().substring(0, 5) === "setup") {
          robot.messageRoom(room, "There seems to be a form already linked to this room\nIf you would like to replace the current form\nplease run the remove command and then setup the new one.");
        };
      } else {
        // fuction to list results of form for today
        ReportStandup(room);
      };
    } else {
      // look for setup command
      if (rxmatch && rxmatch.toLowerCase().substring(0, 5) === "setup") {
        // function to setup form to room
        if (msg.match[2]){
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
    robot.messageRoom(room, `Setting up connection to form`);
    robot.logger.info("standup-formstack-cron: Setting up connection to form");
    // Make sure formid is a number
    if (Number.isInteger(Number(formid))) {
      FS_FORMID = formid;
      robot.brain.set(`FS_${room}.FS_FORMID`, FS_FORMID);
    } else {
      robot.messageRoom(room, `The form ID entered (${formid}), is not a number\nPlease try again`);
    };

    // Get form data and "timezone"
    GetFormInfo(room);

    // Setup cron
    if (reporttime) {
      // Set date
      var time = reporttime.split(":");
      // Convert to 24h time
      if (reporttime.match(/pm$/i)) {
        time[0] = time[0] + 12;
        time[1] = time[1].slice(0,-2);
      } else if (reporttime.match(/am$/i)) {
        time[1] = time[1].slice(0,-2);
      };
      // Set days if null
      if (!days) {
        var days = "1-5";
      };
      // Set Reminder if null
      if (!remindbeforemin) {
        var remindbeforemin = "30";
      };
      // Set crons
      var d = new Date();
      // set time in date object in order to properlly do time math
      d.setHours(time[0]);
      d.setMinutes(time[1]);
      // Set report cron for time and days
      var standup_report_cron = `${d.getMinutes()} ${d.getHours()} * * ${days}`;
      // Set Minutes minus X minutes
      d.setMinutes( d.getMinutes() - remindbeforemin);
      // Set reminder cron for time and days
      var reminder_cron = `${d.getMinutes()} ${d.getHours()} * * ${days}`;
      // var timezone = ;

      robot.messageRoom(room, `Form reminder (${formid}) setup in this room for ${reporttime} on days ${days}`);
      SetCron(room, standup_report_cron, reminder_cron);
    };
    robot.messageRoom(room, `${formid} - Form has been setup`);
  };

  // ---- setup auto post and reminder cron ----
  function SetCron(room, standup_report_cron, reminder_cron){
    robot.logger.info("standup-formstack-cron: Running cron setup");
    // Reminder with names of those who already filled it out cron
    if (reminder_cron && room) {
      // Reminder Cron
      reminder_cron_job = new CronJob(reminder_cron, function() {
        GetFormInfoRedis(room);
        robot.messageRoom(room, `@here Time to fill out the <${FS_URL}|stand up report>\n`);
        // fuction to list who has filled out the form
        return FilledItOut(room);
      }, null, true, TIMEZONE);
      reminder_cron_job.start;
    } else {
      robot.logger.error("standup-formstack-cron: Missing variable for reminder cron");
    };

    if (standup_report_cron && room) {
      // Report results cron
      standup_report_cron_job = new CronJob(standup_report_cron, function() {
        GetFormInfoRedis(room);
        var CronRun = TRUE;
        // fuction to list results of form for today
        return ReportStandup(room, CronRun);
      }, null, true, TIMEZONE);
      standup_report_cron_job.start;
    } else {
      robot.logger.error("standup-formstack-cron: Missing variable for standup cron");
    };
    robot.logger.info(`standup-formstack-cron: End cron setup for ${room}`);
  };

  // --- test for empty values in an array ---
  function TestArrayValues(array) {
    robot.logger.info("standup-formstack-cron: Testing array values");
    for (i = 0; i < array.length; i++) {
      if (!array[i] || array[i] === '' || array[i] == undefined) {
        // var does not have a value
        return false;
      };
    };
    return true;
  };

  // ---- Pull Data From Formstack HTTP Webhook ----
  // Get info about the form from http webhook (like url and field id's) and then save it to redis (hubot brain)
  function GetFormInfo(room) {
    // set / clear local vars
    var jdata, FS_RD_ARR;
    FSAPIURL = `https://www.formstack.com/api/v2/form/${FS_FORMID}`;
    FSURL = `${FSAPIURL}.json?oauth_token=${FS_TOKEN}`;
    robot.logger.info(`standup-formstack-cron: Calling API to get form data from formstack (${FSAPIURL})`);
    // Call FS http get function
    GetFormSubData(room, FSURL, (jdata) => {
      // Get form url
      FS_URL = jdata.url;
      TIMEZONE = jdata.timezone;
      robot.logger.info("standup-formstack-cron: Pulling form data from formstack");
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
      var FS_RD_ARR = [FS_FORMID, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID];
      // test array and write vars to redis
      if (TestArrayValues(FS_RD_ARR)) {
        try {
          robot.brain.set(`FS_${room}.FS_URL`, FS_URL);
          robot.brain.set(`FS_${room}.FS_FORMID`, FS_FORMID);
          robot.brain.set(`FS_${room}.DATEFIELD_ID`, DATEFIELD_ID);
          robot.brain.set(`FS_${room}.YDAY_ID`, YDAY_ID);
          robot.brain.set(`FS_${room}.TDAY_ID`, TDAY_ID);
          robot.brain.set(`FS_${room}.BLOCK_ID`, BLOCK_ID);
          robot.brain.set(`FS_${room}.USERFN_ID`, USERFN_ID);
          robot.brain.set(`FS_${room}.USERLN_ID`, USERLN_ID);
          robot.brain.set(`FS_${room}.FSAPIURL`, FSAPIURL);
          robot.brain.set(`FS_${room}.TIMEZONE`, TIMEZONE);
        } catch(err) {
          robot.logger.error(`standup-formstack-cron: Error saving to redis ${err}`);
        };
      } else {
        robot.logger.error(`standup-formstack-cron: One or more variables are empty ${FS_RD_ARR}`);
        robot.messageRoom(room, "I was not able to find the form, Please ask my owner to check the logs");
      };
    });
  };

  // ---- Pull Data From Redis ----
  // Get info about the form saved in redis (like url and field id's)
  function GetFormInfoRedis(room) {
    var FS_ARR;
    robot.logger.info("standup-formstack-cron: Gathering data from redis");
    // Set vars from redis data
    try {
      FS_URL = robot.brain.get(`FS_${room}.FS_URL`);
      FS_FORMID = robot.brain.get(`FS_${room}.FS_FORMID`);
      DATEFIELD_ID = robot.brain.get(`FS_${room}.DATEFIELD_ID`);
      YDAY_ID = robot.brain.get(`FS_${room}.YDAY_ID`);
      TDAY_ID = robot.brain.get(`FS_${room}.TDAY_ID`);
      BLOCK_ID = robot.brain.get(`FS_${room}.BLOCK_ID`);
      USERFN_ID = robot.brain.get(`FS_${room}.USERFN_ID`);
      USERLN_ID = robot.brain.get(`FS_${room}.USERLN_ID`);
      FSAPIURL = robot.brain.get(`FS_${room}.FSAPIURL`);
      TIMEZONE = robot.brain.get(`FS_${room}.TIMEZONE`);
    } catch(err) {
      robot.logger.error(`standup-formstack-cron: Error retreving from redis ${err}`);
    };

    // Array of required formstack vars
    var FS_ARR = [FS_FORMID, DATEFIELD_ID, YDAY_ID, TDAY_ID, BLOCK_ID, USERFN_ID];
    // test array of vars pulled from redis
    if (TestArrayValues(FS_ARR)) {
      // got the info
      robot.logger.info(`standup-formstack-cron: Data gathered from redis (${FS_ARR})`);
    } else {
      // Did not get all the info
      robot.logger.info("standup-formstack-cron: Could not read data in at least one var from redis" );
      if (FS_FORMID) {
        GetFormInfo(room);
      };
    };
  };

  // ---- remove a standup form from a room ----
  function RemoveStandup(room) {
    robot.messageRoom(room, `Removing form ${FS_FORMID} from this room`);
    robot.logger.info(`standup-formstack-cron: Removing form link ${FS_FORMID} from ${room}`);
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
    } catch(err) {
      robot.messageRoom(room, `There was an issue, please have my owner check my logs`);
      robot.logger.error(`standup-formstack-cron: Error deleting values in brain ${err}`);
    };
    if (!err) {
      // unset vars
      FS_URL = undefined;
      FS_FORMID = undefined;
      DATEFIELD_ID = undefined;
      YDAY_ID = undefined;
      TDAY_ID = undefined;
      BLOCK_ID = undefined;
      USERFN_ID = undefined;
      USERLN_ID = undefined;
      FSAPIURL = undefined;

      try {
        robot.brain.get(`FS_${room}.FS_FORMID`);
      } catch(err) {
        robot.messageRoom(room, `There was an error when removing`);
        robot.logger.info(`standup-formstack-cron: Form failed to be removed from ${room}. Error: ${err}`);
      };

      robot.messageRoom(room, `Removed form link`);
      robot.logger.info(`standup-formstack-cron: Form has been removed from ${room}`);
    };
  };

  // ---- Date calculator and formater ----
  // returns formated current date "DATEFORMAT" and lookback date "MINDATE"
  function CalcDate() {
    robot.logger.info(`standup-formstack-cron: Running calculations for the date`);
    // TODO set date time to match timezone var time
    DateTime.local().setZone(TIMEZONE);
    var TODAY = new Date;
    var TODAYBACK = new Date;
    // Set date lookback XX amount of days
    TODAYBACK.setDate(TODAYBACK.getDate() - DAYSBACK);
    // create lookback date limit to filter submissions results using "min_time" param in url
    // formstack api "min_time" param is based on eastern time
    var MINDATE = `${TODAYBACK.getFullYear()}-${(TODAYBACK.getMonth() + 1)}-${TODAYBACK.getDate()} 13:45:00`;
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
        var jdata = JSON.parse(body);
        if (jdata.error) {
          robot.messageRoom(room, "Somethings not right, have my owner take a look at my logs");
          robot.logger.error(`standup-formstack-cron: Error retreving data: ${jdata.error}`);
        };
        // send results to return function
        robot.logger.info(`standup-formstack-cron: Data retrived from API`);
        jbody(jdata);
      };
    });
  };

  // ---- Format and Clean message data ----
  function FormatClean(entry, clnmessage) {
    var yday, tday, block, message, userfn, userln, usern;
    robot.logger.info(`standup-formstack-cron: Cleaning format of text for report`);
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
    message += `\n\t*_Yesterday:_*\n${CleanTxt(yday)}`;
    // title section Today with user data below
    message += `\n\t*_Today:_*\n${CleanTxt(tday)}`;
    // skip blocker section if empty
    if (block !== "Nothing") {
      message += `\n\t*_Blockers:_*\n${CleanTxt(block)}`;
    };
    clnmessage(message);
  };

  // ---- Form data Report for all users today ----
  function ReportStandup(room, CronRun) {
    var entry, message, FSURL;
    robot.logger.info(`standup-formstack-cron: Running standard Standup report to ${room}`);
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
      if (!message && CronRun) {
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
          `:rotating_light: ${robot.name} dance party!! :rotating_light: \n\thttps://media.giphy.com/media/v0YiARQxj1yc8/giphy.gif`,
          `*${robot.name} * - ${DATEFORMAT}\n\t*_Yesterday:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Other duties as assigned\n\t*_Today:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Other duties as assigned\n\t*_Blockers:_*\n\t\- No one is here`
        ];
        robot.messageRoom(room, gone[Math.floor(Math.random()*gone.length)]);
      };
    });
  };

  // ---- Form data Report for single user ----
  function SingleReport(room, user) {
    var message, userfn, userln, usern, FSURL;
    var messageList = [];
    robot.logger.info(`standup-formstack-cron: Running single Standup report to ${room}`);
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
    robot.logger.info(`standup-formstack-cron: Running list of users that filled out report to ${room}`);
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
    robot.logger.info(`standup-formstack-cron: Displaying Help to ${room}`);
    if (ONHEAR) {
      message += `You can @${robot.name} or I'll listen for *${PREFIX}standup*\n`
    };
    message += `${robot.name} ${PREFIX}standup - List results of standup form for today\n`;
    message += `${robot.name} ${PREFIX}standup today - List who has filled out the standup form\n`;
    message +=`${robot.name} ${PREFIX}standup <USERNAME> - List results of standup form for today\n`;
    message +=`${robot.name} ${PREFIX}standup remove - Remove form configuration from the room\n`;
    message += `${robot.name} ${PREFIX}standup setup FORMID TIME REMINDER CRONDAYS - Setup the script for the first time\n`;
    message += `\tFORMID - Formstack Form ID\n`;
    message += `\tTIME - Time of auto post (8:00am or 14:00)\n`;
    message += `\tREMINDER - Number of minutes before to send reminder (15) Default 30\n`;
    message += `\tCRONDAYS - Days to post in cron format (1-5 or 0,1,2,3) 0 = Sunday. Default 1-5 (weekdays)\n`;
    message += `\tReminder and crondays can be skipped to accept defaults`;
    robot.messageRoom(room, message);
  };
};
