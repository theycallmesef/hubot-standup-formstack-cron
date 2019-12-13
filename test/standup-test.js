var chai, expect, sinon;

chai = require('chai');

sinon = require('sinon');

chai.use(require('sinon-chai'));

expect = chai.expect;

describe('standup-formstack-cron', function() {
  beforeEach(function() {
    return this.robot = {
      respond: sinon.spy(),
      hear: sinon.spy()
    };
  });
  it('registers a respond listener for standup command', function() {
    return expect(this.robot.respond).to.have.been.calledWith(/^ps-standup( ([Tt]oday))?$/i);
  });
  return it('registers a respond listener for standup command', function() {
    return expect(this.robot.respond).to.have.been.calledWith(/^ps-standup$/i);
  });
});
