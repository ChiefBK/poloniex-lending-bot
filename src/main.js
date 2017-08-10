import Poller from './poller2.js'
import cron from 'node-cron';
import Promise from 'bluebird';
import Mongoose from 'mongoose';

const url = 'mongodb://172.17.0.1:27017/poloniex-loaning-bot'; //TODO - hardcoded ip
// const url = '172.17.0.1:27017/poloniex-loaning-bot'; //TODO - hardcoded ip

const server = Promise.coroutine(function*() {
    console.log("STARTING BOT at " + new Date().toString());
    Mongoose.connect(url, function(){
        console.log("Connected to DB");
    });

    const poller = new Poller();

    // TODO - add start poller immediately option
    cron.schedule('*/1 * * * *', poller.run, true); // Run poller at the five minute mark. e.g. at 8:05, 8:10, 8:15, etc
});

server();