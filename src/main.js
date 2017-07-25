import Poller from './poller2.js'
import cron from 'node-cron';
import Promise from 'bluebird';
import {getDbConnection} from './db.js';

const url = 'mongodb://172.17.0.1:27017/poloniex-loaning-bot'; //TODO - hardcoded ip

const server = Promise.coroutine(function*() {
    console.log("STARTING at " + new Date().toString());

    const dbConnection = yield getDbConnection(url);

    const poller = new Poller(dbConnection);

    cron.schedule('*/5 * * * *', Promise.coroutine(poller.run), true); // Run poller at the five minute mark. e.g. at 8:05, 8:10, 8:15, etc
});

server();