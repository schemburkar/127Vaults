import test from 'node:test';
import assert from 'node:assert/strict';
import { matchingLogin, originOf } from '../src/match.mjs';
test('www and non-www login hosts match without trusting other subdomains or ports',()=>{
 for(const [saved,page] of [['twilio.com','https://www.twilio.com/login'],['www.twilio.com','https://twilio.com/login'],['https://twilio.com:443','https://www.twilio.com/']]) assert.equal(matchingLogin(saved,page),true);
 for(const page of ['https://console.twilio.com','https://evil.twilio.com','https://www.twilio.com.evil.test','http://www.twilio.com','https://www.twilio.com:444']) assert.equal(matchingLogin('twilio.com',page),false,page);
 assert.notEqual(originOf('https://twilio.com'),originOf('https://www.twilio.com'),'permission and vault-tab origins stay exact');
 assert.equal(matchingLogin('127.0.0.1','https://www.127.0.0.1'),false,'IP addresses do not gain a DNS alias');
});
