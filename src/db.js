import Promise from 'bluebird';

const mongoose = require('mongoose');

const Schema = mongoose.Schema;

mongoose.Promise = Promise;

const orderBookSchema = new Schema({
    weightedAvg: Number,
    avgRate: Number,
    minRate: Number,
    maxRate: Number,
    numberOfOrders: Number
});

const offerSchema = new Schema({
    rate: Number,
    amount: Number,
    startDateTime: Date
});

const activeLoanSchema = new Schema({
    loanId: Number,
    rate: Number,
    amount: Number,
    startDateTime: Date,
    duration: Number
});

const completeLoanSchema = new Schema({
    loanId: Number,
    rate: Number,
    amount: Number,
    earned: Number,
    startDateTime: Date,
    endDateTime: Date,
});

const balanceSchema = new Schema({
    offersAmount: Number,
    loansAmount: Number,
    availableAmount: Number
});

const pollerSchema = new Schema({
    lastRan: Date
});

export const OrderBook = mongoose.model('OrderBook', orderBookSchema);
export const Offer = mongoose.model('Offer', offerSchema);
export const ActiveLoan = mongoose.model('ActiveLoan', activeLoanSchema);
export const CompleteLoan = mongoose.model('CompleteLoan', completeLoanSchema);
export const Balance = mongoose.model('Balance', balanceSchema);
export const PollerCollection = mongoose.model('Poller', pollerSchema);

export const replaceActiveLoans = Promise.coroutine(function*(activeLoans){
    yield ActiveLoan.find({}).remove().exec(); // Remove all active loans

    for (let i in activeLoans){
        yield ActiveLoan.create({
            loanId: activeLoans[i].id,
            rate: activeLoans[i].rate,
            amount: activeLoans[i].amount,
            startDateTime: activeLoans[i].date,
            duration: activeLoans[i].duration
        });
    }
});

export const replaceOffers = Promise.coroutine(function*(offers){
    yield Offer.find({}).remove().exec(); // Remove all active offers

    for (let i in offers){
        yield Offer.create({
            rate: offers[i].rate,
            amount: offers[i].amount,
            startDateTime: offers[i].date
        })
    }
});

// export function getDbConnection(url) {
//     return new Promise((resolve, reject) => {
//         MongoClient.connect(url).then((db) => {
//             resolve(db);
//         })
//     });
// }
//
// export function initializeDB(url){
//     return new Promise(function (resolve, reject) {
//         Database.connect(url).then(function (db) {
//             db.register(Balance);
//             resolve(db);
//         });
//     });
// }

// Database.prototype.getBalances = function () {
//     this.db.
// }

// export class Balance extends Model {
//
// }
//
// export function* saveBalance(offersAmount, loansAmount, availableAmount) {
//     const balance = new Balance({
//         offers: offersAmount,
//         loans: loansAmount,
//         available: availableAmount
//     });
//
//     yield balance.save();
// }