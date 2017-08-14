import Promise from 'bluebird';
import Poloniex from 'poloniex-api-node';
import {Balance, CompleteLoan, replaceActiveLoans, replaceOffers, PollerCollection} from './db.js';
import Mongoose from 'mongoose';
import Big from 'big.js';

Mongoose.Promise = Promise;

const API_KEY = process.env.POLONIEX_API_KEY; // Get api key and secret from system environmental variables
const SECRET = process.env.POLONIEX_API_SECRET;

const DEFAULT_RATE = 0.0015;
const DEFAULT_DURATION = "2"; // A string with the number of days of loan
const DEFAULT_AUTO_RENEW = "0"; // "1" if auto-renew; "0" if not to auto-renew
const DEFAULT_STARTING_ORDER_BOOK_PERCENTAGE = 0.75; // The starting depth in the order book
const DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE = 0.2; // If open orders contain more than this percentage of funds of the total than start canceling orders
const DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE = 0.2; // The percentage of the available BTC to set as the amount for a offer
const DEFAULT_MAXIMUM_LOAN_OFFER_AMOUNT = 0.2; // The max amount of BTC for any loan
const DEFAULT_MINIMUM_OFFER_AMOUNT = 0.01;
const DEFAULT_MAXIMUM_ORDER_BOOK_INDEX = 0.9;
const DEFAULT_MINIMUM_ORDER_BOOK_INDEX = 0.35;

const poloniex = new Poloniex(API_KEY, SECRET, {
    socketTimeout: 130000
});

const returnLoanOrders = Promise.promisify(Poloniex.prototype.returnLoanOrders, {context: poloniex});
const returnCompleteBalances = Promise.promisify(Poloniex.prototype.returnCompleteBalances, {context: poloniex});
const createLoanOffer = Promise.promisify(Poloniex.prototype.createLoanOffer, {context: poloniex});
const returnOpenLoanOffers = Promise.promisify(Poloniex.prototype.returnOpenLoanOffers, {context: poloniex});
const cancelLoanOffer = Promise.promisify(Poloniex.prototype.cancelLoanOffer, {context: poloniex});
const returnActiveLoans = Promise.promisify(Poloniex.prototype.returnActiveLoans, {context: poloniex});
const returnAvailableAccountBalances = Promise.promisify(Poloniex.prototype.returnAvailableAccountBalances, {context: poloniex});
const transferBalance = Promise.promisify(Poloniex.prototype.transferBalance, {context: poloniex});
const lendingHistory = Promise.promisify(Poloniex.prototype.returnLendingHistory, {context: poloniex});

let orderBookIndex = new Big(DEFAULT_STARTING_ORDER_BOOK_PERCENTAGE); // How deep in the order book to open loan orders

let round = 0; // number of polling cycles

export default function Poller() {};

Poller.prototype.run = Promise.coroutine(function*() {
    const start = new Date();

    console.log("STARTING POLLER AT " + start.toString() + " - Round " + round);

    const lastRanQuery = yield PollerCollection.find({}).limit(1).sort({$natural:-1}).select('lastRan').exec();

    yield PollerCollection.create({
        lastRan: start
    });

    const availableBalances = yield returnAvailableAccountBalances(null);

    if ('exchange' in availableBalances && 'BTC' in availableBalances.exchange) {
        yield transferBalance('BTC', availableBalances.exchange.BTC, 'exchange', 'lending');
    }

    const loanOrders = yield returnLoanOrders('BTC', null);
    const completeBalances = yield returnCompleteBalances('all');
    const openLoanOffers = yield returnOpenLoanOffers();
    const activeLoans = yield returnActiveLoans();

    if(lastRanQuery.length > 0){
        const lastRanTimestamp = new Date(lastRanQuery[0].lastRan);
        console.log(lastRanTimestamp)
        const completedLoans = yield lendingHistory(lastRanTimestamp.getTime() / 1000, parseInt(start.getTime() / 1000), undefined);
        console.log(completedLoans);

        for (let i in completedLoans){
            CompleteLoan.create({
                loanId: completedLoans[i].id,
                rate: completedLoans[i].rate,
                amount: completedLoans[i].amount,
                startDateTime: completedLoans[i].open,
                endDateTime: completedLoans[i].close,
                earned: completedLoans[i].earned
            })
        }

    }

    yield replaceActiveLoans(activeLoans);
    yield replaceOffers(openLoanOffers);

    const openOffers = loanOrders.offers;
    const myAvailableBalance = new Big(completeBalances.BTC.available);
    const myActiveLoans = activeLoans.provided;
    let myOpenOffers;

    if ('BTC' in openLoanOffers){
        myOpenOffers = openLoanOffers.BTC
    }
    else{
        myOpenOffers = [];
    }

    const myOpenOffersBalance = countOrderBtc(myOpenOffers);
    const myActiveLoansBalance = countOrderBtc(myActiveLoans);

    console.log('Available balance is ' + myAvailableBalance.toString() + ' BTC');
    console.log('There are ' + openOffers.length + ' offers on the order book');
    console.log('You have ' + myOpenOffers.length + ' open offers worth ' + myOpenOffersBalance.toString() + ' BTC');
    console.log('You have ' + myActiveLoans.length + ' active loans worth ' + myActiveLoansBalance.toString() + ' BTC');
    console.log('You have a grand total of ' + myAvailableBalance.plus(myOpenOffersBalance).plus(myActiveLoansBalance).toString() + ' BTC');

    yield Balance.create({
        offersAmount: myOpenOffersBalance.toString(),
        loansAmount: myActiveLoansBalance.toString(),
        availableAmount: myAvailableBalance.toString()
    });

    yield cancelOldOrders(myOpenOffers, myAvailableBalance);

    console.log("Finished canceling old orders");

    const totalBtcInOffers = countOrderBtc(openOffers);
    console.log("There is a total of " + totalBtcInOffers.toString() + " BTC on the order book");
    const orderBookBtcIndex = totalBtcInOffers.times(orderBookIndex);
    console.log("The orderBookIndex is at " + orderBookIndex.times(100).toString() + "%");
    console.log("Setting the btcOrderBookIndex to " + orderBookBtcIndex.toString());

    const rate = determineRate(openOffers, orderBookBtcIndex);
    const amount = Math.min(myAvailableBalance.times(DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE), DEFAULT_MAXIMUM_LOAN_OFFER_AMOUNT);

    try{
        const response = yield placeLoanOffer(amount, rate);
        console.log("Order #" + response.orderID + " placed successfully");
    }
    catch (err){
        console.log("There was an error placing the loan offer");
        console.log(err);
    }

    round++;
    console.log("----------------------------------------");

    function determineRate(loanOffers, orderBookBtcIndex) {
        let sumOffers = new Big(0);

        for (let i = 0; i < loanOffers.length; i++) { // Find loan order with more than
            sumOffers = sumOffers.plus(loanOffers[i].amount);
            if (sumOffers > orderBookBtcIndex) {
                console.log("Loan offers are above " + orderBookBtcIndex.toString() + " BTC at position: " + i);
                return loanOffers[i].rate;
            }
        }

        console.log('Using the default rate');
        return DEFAULT_RATE;
    }

    // Returns a Promise after placing offer
    function placeLoanOffer(amount, rate) {
        if (amount < DEFAULT_MINIMUM_OFFER_AMOUNT)
            return Promise.reject("Amount (" + amount + ") was less then the minimum offer amount of " + DEFAULT_MINIMUM_OFFER_AMOUNT);

        console.log("creating loan offer of " + amount + " BTC for " + DEFAULT_DURATION + " days at a rate of " + rate + " with auto-renew " + DEFAULT_AUTO_RENEW);
        return createLoanOffer('BTC', amount, DEFAULT_DURATION, DEFAULT_AUTO_RENEW, rate);
    }

    function cancelOldOrders(myOpenOffers, availableBalance) {
        return new Promise(function (resolve, reject) {
            let totalBtcInOpenOffers = countOrderBtc(myOpenOffers);
            const totalBtc = availableBalance.plus(totalBtcInOpenOffers);

            const cancelOfferPromises = [];
            while (totalBtcInOpenOffers > totalBtc.times(DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE)) {
                console.log("BTC in open offers above threshold. Canceling oldest order...");
                const oldestOffer = getOldestOffer(myOpenOffers);
                cancelOfferPromises.push(cancelOffer(oldestOffer.id));
                totalBtcInOpenOffers = totalBtcInOpenOffers.minus(oldestOffer.amount);
            }

            // If had to cancel orders reduce orderBookIndex by 5% * number of canceled offers
            const reductionAmount = new Big(1 - (cancelOfferPromises.length * 0.05));
            if (cancelOfferPromises.length > 0 && orderBookIndex.times(reductionAmount) > DEFAULT_MINIMUM_ORDER_BOOK_INDEX) {
                console.log("Reducing orderBookIndex to " + reductionAmount * 100 + "% of its original amount");
                orderBookIndex = orderBookIndex.times(reductionAmount); // reduce order book index
            }
            else if (cancelOfferPromises.length == 0 && round > 0 && orderBookIndex.times(1.1) < DEFAULT_MAXIMUM_ORDER_BOOK_INDEX) { // Else increase it by 10% but not on first round
                console.log("Increasing oderBookIndex by 10%");
                orderBookIndex = orderBookIndex.times(1.1);
            }

            Promise.all(cancelOfferPromises).then(function () {
                resolve();
            })
        });
    }

    function cancelOffer(orderId) {
        return new Promise((resolve, reject) => {
            cancelLoanOffer(orderId).then(() => {
                console.log("Successfully canceled order");
                console.log("Order ID : " + orderId);
                resolve();
            })
        })
    }

    function getOldestOffer(openOffers) {
        let oldestOffer = openOffers[0];

        for (let i = 1; i < openOffers.length; i++) {
            const offer = openOffers[i];
            const offerTimestamp = new Date(offer.date).getTime();
            const oldestOfferTimestamp = new Date(oldestOffer.date).getTime();

            if (oldestOfferTimestamp > offerTimestamp) {
                oldestOffer = offer;
            }
        }

        return oldestOffer;
    }

    function countOrderBtc(offers) {
        let totalBtc = new Big(0);

        for (let i = 0; i < offers.length; i++) {
            let amount = new Big(offers[i].amount);

            totalBtc = totalBtc.plus(amount);
        }

        return totalBtc;
    }
});

