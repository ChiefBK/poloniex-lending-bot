import Promise from 'bluebird';

const mongoose = require('mongoose');

const Schema = mongoose.Schema;

mongoose.Promise = Promise;

const orderBookSchema = new Schema({
    weightedAvg: Number,
    avgIntRate: Number,
    minIntRate: Number,
    maxIntRate: Number,
    numberOfOrders: Number
});

const offerSchema = new Schema({
    intRate: Number,
    amount: Number
});

const loanSchema = new Schema({
    intRate: Number,
    amount: Number,
    startDateTime: Date,
    endDateTime: Date,
    plannedDuration: Date
});

const balanceSchema = new Schema({
    offersAmount: Number,
    loansAmount: Number,
    availableAmount: Number
});

export const OrderBook = mongoose.model('OrderBook', orderBookSchema);
export const Offer = mongoose.model('Offer', offerSchema);
export const Loan = mongoose.model('Loan', loanSchema);
export const Balance = mongoose.model('Balance', balanceSchema);


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