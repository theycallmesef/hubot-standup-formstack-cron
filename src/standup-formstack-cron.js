// Description:
//  Report standup notes that were filled in using formstack
//
// Author:
//   Seth Rouggly <srouggly@apu.edu>
//
// Notes:
//  Formstack is an online form builder (https://www.formstack.com/)
//    Form required fields:
//    - Date Feild
//    - Yesterday notes
//    - Today Notes
//    - Blocker Notes
//    - First Name
//    - Last Name
//
// Configuration:
//  HUBOT_FORMSTACK_TOKEN - (required) Formstack API Token
//
//  HUBOT_FORMSTACK_FORM_ID - (required) Formstack form ID
//  HUBOT_FORMSTACK_DATE_FIELD_ID - (required) Formstack date feild ID
//  HUBOT_FORMSTACK_USER_FIELD_ID - (required) Formstack User name feild ID
//  HUBOT_FORMSTACK_YESTERDAY_FIELD_ID - (required) Formstack Yesterday feild ID
//  HUBOT_FORMSTACK_TODAY_FIELD_ID - (required) Formstack Today feild ID
//  HUBOT_FORMSTACK_BLOCKER_FIELD_ID - (required) Formstack Blocker feild ID
//
//  HUBOT_FORMSTACK_PREFIX - (Optional) set a prefix for multiple standup reports
//
//  HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK - (Optional) Formstack submissions limiter
//
//  HUBOT_FORMSTACK_CHAT_ROOM_NAME - (required for reminder) Chat room name for auto reminder and report
//  HUBOT_FORMSTACK_TIMEZONE - (required for reminder)
//
//  HUBOT_FORMSTACK_URL - (required for reminder) url of the form for auto reminder
//  HUBOT_FORMSTACK_REMINDER_CRON - (required for reminder) schedule a reminder to fill the form
//  HUBOT_FORMSTACK_STANDUP_REPORT_CRON - (required for auto report) schedule to send the submissions
//
//
// Commands:
//  hubot (CustomPrefix-)standup            List results of standup form for today
//  hubot (CustomPrefix-)standup today      List who has filled out the standup form
//
// Dependencies:
//  cron
//
// TODO:
//  - Univesal command (custom command)??
//  - Return results by specific user (fs-standup kim)

const FS_TOKEN = process.env.HUBOT_FORMSTACK_TOKEN || false; //(Required) Formstack API Token
// Formstack form and feild ID's
const FS_FORMID = process.env.HUBOT_FORMSTACK_FORM_ID; //(Required) Formstack form ID
const DATEFIELD_ID = process.env.HUBOT_FORMSTACK_DATE_FIELD_ID; //(Required) Formstack date field ID
const USERN_ID = process.env.HUBOT_FORMSTACK_USER_FIELD_ID; //(Required) Formstack User name field ID
const YDAY_ID = process.env.HUBOT_FORMSTACK_YESTERDAY_FIELD_ID; //(Required) Formstack Yesterday field ID
const TDAY_ID = process.env.HUBOT_FORMSTACK_TODAY_FIELD_ID; //(Required) Formstack Today field ID
const BLOCK_ID = process.env.HUBOT_FORMSTACK_BLOCKER_FIELD_ID; //(Required) Formstack Blocker field ID

//(Optional) set a prefix for multiple standup reports
if (process.env.HUBOT_FORMSTACK_PREFIX) {
  const PREFIX = process.env.HUBOT_FORMSTACK_PREFIX + "-";
} else {
  const PREFIX = "";
}

const DAYSBACK = process.env.HUBOT_FORMSTACK_SUBMISSIONS_LOOKBACK || 10; //(Optional) filter formstack submissions within X day ago

const ROOM = process.env.HUBOT_FORMSTACK_CHAT_ROOM_NAME; //(Required for reminder and report) Chat room name for auto reminder and report
const TIMEZONE = process.env.HUBOT_FORMSTACK_TIMEZONE || 'America/New_York'; //(Optional for reminder and report) Timezone for cron

const FS_URL = process.env.HUBOT_FORMSTACK_URL || ""; //(Optional for reminder) url of the form for auto reminder
const REMINDER_CRON = process.env.HUBOT_FORMSTACK_REMINDER_CRON; //(Required for reminder) schedule a reminder to fill the form
const STANDUP_REPORT_CRON = process.env.HUBOT_FORMSTACK_STANDUP_REPORT_CRON; //(Required for auto report) schedule to send the submissions
const FSAPIURL = 'https://www.formstack.com/api/v2/form/' + FS_FORMID + '/submission.json'; // Building the API url

module.exports = (robot) => {
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
    REMINDER_CRON_JOB.start
  } else {
    robot.logger.error("Missing variable for reminder cron");
  }
  if (STANDUP_REPORT_CRON && ROOM) {
    // Report results cron
    STANDUP_REPORT_CRON_JOB = new CronJob(STANDUP_REPORT_CRON, function() {
      // fuction to list results of form for today
      return ReportStandup(ROOM);
    }, null, true, TIMEZONE);
    STANDUP_REPORT_CRON_JOB.start
  } else {
    robot.logger.error("Missing variable for standup cron");
  }

  // ad-hoc commands
  regx = new RegExp("^" + PREFIX + "standup( ([Tt]oday))?$", 'i');
  robot.hear(regx, (msg) => {
    msg.finish();
    // Logic to seperate the commands
    if (msg.match[2] && msg.match[2].toLowerCase() === "today") {
      // fuction to list who has filled out the form
      FilledItOut(msg.message.room)
    } else {
      // fuction to list results of form for today
      ReportStandup(msg.message.room);
    }
  });

  // Date calculator and formater
  // returns formated current date "DATEFORMAT" and lookback date "MINDATE"
  function CalcDate() {
    const TODAY = new Date;
    const TODAYBACK = new Date;
    // Set date lookback XX amount of days
    TODAYBACK.setDate(TODAYBACK.getDate() - DAYSBACK);
    // create lookback date limit to filter submissions results using "min_time" param in url
    // "min_time" param is based on eastern time
    const MINDATE = TODAYBACK.getFullYear() + "-" + (TODAYBACK.getMonth() + 1) + "-" + TODAYBACK.getDate() + " 13:45:00";
    // Set Month array
    const MTHREE = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    // create formated month day year for formstack lookup (Jan 01, 2019)
    // (`0${TODAY.getDate()}`).slice(-2) creates a two digit day
    const DATEFORMAT = (MTHREE[TODAY.getMonth()]+" "+(`0${TODAY.getDate()}`).slice(-2)+", "+TODAY.getFullYear());
    // return formated dates
    if (DATEFORMAT && MINDATE) {
      return [DATEFORMAT, MINDATE];
    } else {
      robot.logger.error("Issue with date formats. One or more is missing");
    }
  }

  // function to return json from formstack web request
  // "MINDATE" is passed in, "jbody" is the return
  function GetFormData(room, MINDATE, jbody) {
    // Check formstack token is set
    if (FS_TOKEN === false) {
      // send error message to room
      robot.messageRoom(room, "um... so, according to my records a formstack token was not set up.\nYou'll need to have that done before I can I can retrieve the data");
      robot.logger.error("Missing formstack token");
      return;
    }
    // formstack url with form ID, token (oauth_token) and date range filter (min_time)
    const FSURL = `${FSAPIURL}?data=true&expand_data=false&min_time=${encodeURI(MINDATE)}&oauth_token=${FS_TOKEN}`
    // Get json of form submissions
    robot.http(FSURL).get()((err, res, body) => {
      if (err) {
        // send error message to room
        robot.messageRoom(room, `I was not able to connect to Formstack: ${res}`);
        robot.logger.error(`Error connecting to formstack: ${res}`);
        return;
      } else {
        jdata = JSON.parse(body);
        if (jdata.error) {
          robot.messageRoom(room, "Somethings not right, have my owner take a look at my logs");
          robot.logger.error(`Error retreving data: ${jdata.error}`);
        }
        // send results to return function
        jbody(jdata);
      }
    });
  };

  // From data report
  function ReportStandup(room) {
    var entry, yday, tday, block, message;
    // Get dates needed
    Dates = CalcDate();
    DATEFORMAT = Dates[0];
    MINDATE = Dates[1];

    // Callback return function of pased json from url
    GetFormData(room, MINDATE, (jdata) => {
      // loop filtered submissions
      for (entry of jdata.submissions) {
        // get date in form
        datefield = entry.data[DATEFIELD_ID].value;
        // Parse submissions and match for today
        if (datefield === DATEFORMAT) {
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

          // set vars for text from json
          usern = entry.data[USERN_ID].value;
          yday = entry.data[YDAY_ID].value;
          tday = entry.data[TDAY_ID].value;
          block = entry.data[BLOCK_ID].value;
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
          }
          // send message to room
          robot.messageRoom(room, message);
        }
      }
      if (!message) {
        var gone = [
          "Sooooo... Is everyone on holiday?",
          "Nothing? Was it something I said?",
          "Do you wanna build a snowman?... It doesn't have to be snowman... OK, bye",
          ":notes:Here I go agian on my own!:notes:\n\tGoing down the only road I've ever know!:notes:",
          "Bueller? Bueller?... Bueller?....... Bueller?",
          "https://media.giphy.com/media/jNH0Bto1xBNwQ/giphy.gif",
          "Today was a day off wasn't it?... I wish I had a day off",
          "Great! I'm going back to sleep",
          ":rotating_light: Otterbot dance party!! :rotating_light: \n\thttps://media.giphy.com/media/v0YiARQxj1yc8/giphy.gif",
          "*Otterbot* - " + datefield + "\n\t*_Yesterday:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Otter duties as assigned\n\t*_Today:_*\n\t\- Report Standup\n\t\- Answer Questions\n\t\- Otter duties as assigned\n\t*_Blockers:_*\n\t\- No one is here"
        ];
        robot.messageRoom(room, gone[Math.floor(Math.random()*gone.length)]);
      }
    });
  };

  // Who filled out report today
  function FilledItOut(room) {
    // Get dates needed
    Dates = CalcDate();
    DateFormat = Dates[0];
    MINDATE = Dates[1];
    // Callback return function of pased json from url
    GetFormData(room, MINDATE, (jdata) => {
      var users = [];
      // loop filtered submissions
      for (entry of jdata.submissions) {
        const usern = entry.data[USERN_ID].value;
        const datefield = entry.data[DATEFIELD_ID].value;
        // build array of usernames for today
        if (datefield === DateFormat) {
          users.push(usern);
        }
      }
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
      }
      // send message to room
      robot.messageRoom(room, message);
    });
  };
};
