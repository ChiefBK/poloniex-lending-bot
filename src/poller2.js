import Promise from "bluebird";
import Poloniex from "poloniex-api-node";
import {Balance, CompleteLoan, replaceActiveLoans, replaceOffers, PollerCollection} from "./db.js";
import Mongoose from "mongoose";
import Big from "big.js";

Mongoose.Promise = Promise;

const API_KEY = process.env.POLONIEX_API_KEY; // Get api key and secret from system environmental variables
const SECRET = process.env.POLONIEX_API_SECRET;

const DEFAULT_RATE = 0.0015;
const DEFAULT_DURATION = "2"; // A string with the number of days of loan
const DEFAULT_AUTO_RENEW = "0"; // "1" if auto-renew; "0" if not to auto-renew
const DEFAULT_ORDER_BOOK_MEAN_INDEX = 0.75; // The starting depth in the order book
const DEFAULT_OFFER_DIFFERENCE_INDEX = 0.08; // The starting difference between orders when they are placed
const DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE = 0.2; // If open orders contain more than this percentage of funds of the total than start canceling orders
const DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE = 0.2; // The percentage of the available BTC to set as the amount for a offer
const DEFAULT_MAXIMUM_LOAN_OFFER_AMOUNT = 0.2; // The max amount of BTC for any loan
const DEFAULT_MINIMUM_OFFER_AMOUNT = 0.01;
const DEFAULT_MAXIMUM_ORDER_BOOK_INDEX = 0.9;
const DEFAULT_MINIMUM_ORDER_BOOK_INDEX = 0.35;
const OFFERS_PER_POLLING_CYCLE = 5; // Number of offers to create every polling cycle

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

let meanOrderBookIndex = new Big(DEFAULT_ORDER_BOOK_MEAN_INDEX); // How deep in the order book to open loan orders

let round = 0; // number of polling cycles

export default function Poller() {
};

Poller.prototype.run = Promise.coroutine(function*() {
    const start = new Date();

    console.log("STARTING POLLER AT " + start.toString() + " - Round " + round);

    const lastRanQuery = yield PollerCollection.find({}).limit(1).sort({$natural: -1}).select('lastRan').exec();

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

    if (lastRanQuery.length > 0) {
        const lastRanTimestamp = new Date(lastRanQuery[0].lastRan);
        console.log(lastRanTimestamp)
        const completedLoans = yield lendingHistory(lastRanTimestamp.getTime() / 1000, parseInt(start.getTime() / 1000), undefined);
        console.log(completedLoans);

        for (let i in completedLoans) {
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

    if ('BTC' in openLoanOffers) {
        myOpenOffers = openLoanOffers.BTC
    }
    else {
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

    try {
        yield cancelOldOrders(myOpenOffers, myAvailableBalance);
    }
    catch (e) {
        console.log("There was an error cancelling orders");
        console.log(e);
    }

    console.log("Finished canceling old orders");

    const totalBtcInOffers = countOrderBtc(openOffers);
    console.log("There is a total of " + totalBtcInOffers.toString() + " BTC on the order book");
    // console.log("The meanOrderBookIndex is at " + meanOrderBookIndex.times(100).toString() + "%");
    // console.log("Setting the meanBtcOrderBookIndex to " + orderBookBtcIndex.toString());

    const totalAmountToOffer = Math.min(myAvailableBalance.times(DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE), DEFAULT_MAXIMUM_LOAN_OFFER_AMOUNT);
    const numOfOffers = totalAmountToOffer / OFFERS_PER_POLLING_CYCLE > DEFAULT_MINIMUM_OFFER_AMOUNT ? OFFERS_PER_POLLING_CYCLE : parseInt(totalAmountToOffer / DEFAULT_MINIMUM_OFFER_AMOUNT);
    const orderBookIndexes = getOrderBookIndexes(numOfOffers, DEFAULT_ORDER_BOOK_MEAN_INDEX, DEFAULT_OFFER_DIFFERENCE_INDEX);
    const orderBookBtcIndexes = getOrderBookBtcIndexes(orderBookIndexes, totalBtcInOffers);

    console.log("Making " + numOfOffers + " offers this polling cycle");
    console.log("The orderBookIndexes are " + orderBookIndexes);
    console.log("The orderBookBtcIndexes are " + orderBookBtcIndexes);

    const rates = getRates(openOffers, orderBookBtcIndexes, numOfOffers);
    console.log("The rates are " + rates);

    const individualOfferAmount = Big(totalAmountToOffer / numOfOffers);
    console.log("the individual offer amount is " + individualOfferAmount.toString());

    try {
        for (let i in rates) {
            const response = yield placeLoanOffer(individualOfferAmount.toString(), rates[i]);
            console.log("Order #" + response.orderID + " placed successfully");
        }
    }
    catch (err) {
        console.log("There was an error placing the loan offer");
        console.log(err);
    }

    round++;
    console.log("----------------------------------------");

    // TODO - use random gaussian distribution to generate rates https://goo.gl/EqR2Dv
    function getOrderBookIndexes(numOfOffers, meanOrderBookIndex, offerDifferenceIndex) {
        const startingIndexDifference = numOfOffers % 2 == 0 ? Big((numOfOffers / 2 - 0.5) * offerDifferenceIndex) : Big(parseInt(numOfOffers / 2) * offerDifferenceIndex);
        const startingIndex = Big(meanOrderBookIndex - startingIndexDifference);

        console.log("the starting index diff is " + startingIndexDifference);
        console.log("the starting index is " + startingIndex);

        const indexes = [];

        for (let i = 0; i < numOfOffers; i++) {
            indexes.push(startingIndex.plus(Big(i).times(offerDifferenceIndex)));
        }

        return indexes;
    }

    function getOrderBookBtcIndexes(orderBookIndexes, totalBtcInOffers) {
        const orderBookBtcIndexes = [];

        for (let i = 0; i < orderBookIndexes.length; i++) {
            orderBookBtcIndexes.push(orderBookIndexes[i].times(totalBtcInOffers))
        }

        return orderBookBtcIndexes;
    }

    function getRates(loanOffers, orderBookBtcIndexes) {
        let sumOffers = new Big(0);
        let index = 0;

        const rates = [];

        for (let i = 0; i < loanOffers.length; i++) { // Find loan order with more than
            sumOffers = sumOffers.plus(loanOffers[i].amount);
            console.log("loan offer amount is " + loanOffers[i].amount);
            console.log("Sum offers is " + sumOffers);
            while (index < orderBookBtcIndexes.length && sumOffers.gt(orderBookBtcIndexes[index])) {
                console.log("Loan offers are above " + orderBookBtcIndexes[index].toString() + " BTC at position: " + i);
                rates.push(loanOffers[i].rate);
                index++;
            }
        }

        return rates;
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
            while (totalBtcInOpenOffers.gt(totalBtc.times(DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE))) {
                console.log("BTC in open offers above threshold. Canceling oldest order...");
                const oldestOffer = getOldestOffer(myOpenOffers);
                cancelOfferPromises.push(cancelOffer(oldestOffer.id));
                totalBtcInOpenOffers = totalBtcInOpenOffers.minus(oldestOffer.amount);
            }

            // If had to cancel orders reduce orderBookIndex by 5% * number of canceled offers
            const reductionAmount = Big(1).minus(Big(cancelOfferPromises.length).times(Big(0.05)));
            if (cancelOfferPromises.length > 0 && meanOrderBookIndex.times(reductionAmount).gt(Big(DEFAULT_MINIMUM_ORDER_BOOK_INDEX))) {
                console.log("Reducing orderBookIndex to " + reductionAmount * 100 + "% of its original amount");
                meanOrderBookIndex = meanOrderBookIndex.times(reductionAmount); // reduce order book index
            }
            else if (cancelOfferPromises.length == 0 && round > 0 && (meanOrderBookIndex.times(1.1)).lt(Big(DEFAULT_MAXIMUM_ORDER_BOOK_INDEX))) { // Else increase it by 10% but not on first round
                console.log("Increasing oderBookIndex by 10%");
                meanOrderBookIndex = meanOrderBookIndex.times(1.1);
            }

            Promise.all(cancelOfferPromises).then(function () {
                resolve();
            }).catch(function (e) {
                console.log("There was a error cancelling orders")
                console.log(e)
            })
        });
    }

    function cancelOffer(orderId) {
        return new Promise((resolve, reject) => {
            cancelLoanOffer(orderId).then(() => {
                console.log("Successfully canceled order");
                console.log("Order ID : " + orderId);
                resolve();
            }).catch(function (e) {
                console.log("There was an error cancelling order " + orderId)
                console.log(e)
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

