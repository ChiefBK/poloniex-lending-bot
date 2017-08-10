import Promise from 'bluebird';
import Poloniex from 'poloniex-api-node';
import {Balance} from './db.js';
import Mongoose from 'mongoose';

Mongoose.Promise = Promise;

const API_KEY = process.env.POLONIEX_API_KEY; // Get api key and secret from system environmental variables
const SECRET = process.env.POLONIEX_API_SECRET;

const DEFAULT_RATE = 0.0015;
const DEFAULT_DURATION = "2"; // A string with the number of days of loan
const DEFAULT_AUTO_RENEW = "0"; // "1" if auto-renew; "0" if not to auto-renew
const DEFAULT_STARTING_ORDER_BOOK_PERCENTAGE = 0.75; // The starting depth in the order book
const DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE = 0.2; // If open orders contain more than this percentage of funds of the total than start canceling orders
const DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE = 0.2;
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

let orderBookIndex = DEFAULT_STARTING_ORDER_BOOK_PERCENTAGE; // How deep in the order book to open loan orders

let round = 0; // number of polling cycles

export default function Poller() {};

Poller.prototype.run = Promise.coroutine(function*() {
    console.log("STARTING POLLER AT " + new Date().toString() + " - Round " + round);

    const availableBalances = yield returnAvailableAccountBalances(null);

    if ('exchange' in availableBalances) {
        yield transferBalance('BTC', availableBalances.exchange.BTC, 'exchange', 'lending');
    }

    const loanOrders = yield returnLoanOrders('BTC', null);
    const completeBalances = yield returnCompleteBalances('all');
    const openLoanOffers = yield returnOpenLoanOffers();
    const activeLoans = yield returnActiveLoans();

    const openOffers = loanOrders.offers;
    const myAvailableBalance = parseFloat(completeBalances.BTC.available);
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

    console.log('Available balance is ' + myAvailableBalance + ' BTC');
    console.log('There are ' + openOffers.length + ' offers on the order book');
    console.log('You have ' + myOpenOffers.length + ' open offers worth ' + myOpenOffersBalance.toFixed(8) + ' BTC');
    console.log('You have ' + myActiveLoans.length + ' active loans worth ' + myActiveLoansBalance.toFixed(8) + ' BTC');
    console.log('You have a grand total of ' + (myAvailableBalance + myOpenOffersBalance + myActiveLoansBalance).toFixed(8) + ' BTC');

    const balance = new Balance({
        offersAmount: parseFloat(myOpenOffersBalance.toFixed(8)),
        loansAmount: parseFloat(myActiveLoansBalance.toFixed(8)),
        availableAmount: parseFloat(myAvailableBalance.toFixed(8))
    });

    yield balance.save();

    yield cancelOldOrders(myOpenOffers, myAvailableBalance);

    console.log("Finished canceling old orders");

    const totalBtcInOffers = countOrderBtc(openOffers);
    console.log("There is a total of " + totalBtcInOffers.toFixed(8) + " BTC on the order book");
    const btcOrderBookIndex = totalBtcInOffers * orderBookIndex;
    console.log("The orderBookIndex is at " + orderBookIndex * 100 + "%");
    console.log("Setting the btcOrderBookIndex to " + btcOrderBookIndex.toFixed(8));

    const rate = determineRate(openOffers, btcOrderBookIndex);
    const amount = Math.min(myAvailableBalance * DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE, DEFAULT_MAXIMUM_LOAN_OFFER_AMOUNT);

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

    function determineRate(loanOffers, btcOrderBookIndex) {
        let sumOffers = 0;

        for (let i = 0; i < loanOffers.length; i++) { // Find loan order with more than
            sumOffers += Number(loanOffers[i].amount);
            if (sumOffers > btcOrderBookIndex) {
                console.log("Loan offers are above " + btcOrderBookIndex.toFixed(8) + " BTC at position: " + i);
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
            const totalBtc = availableBalance + totalBtcInOpenOffers;

            const cancelOfferPromises = [];
            while (totalBtcInOpenOffers > totalBtc * DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE) {
                console.log("BTC in open offers above threshold. Canceling oldest order...");
                const oldestOffer = getOldestOffer(myOpenOffers);
                cancelOfferPromises.push(cancelOffer(oldestOffer.id));
                totalBtcInOpenOffers -= oldestOffer.amount;
            }

            // If had to cancel orders reduce orderBookIndex by 5% * number of canceled offers
            const reductionAmount = (1 - (cancelOfferPromises.length * 0.05));
            if (cancelOfferPromises.length > 0 && orderBookIndex * reductionAmount > DEFAULT_MINIMUM_ORDER_BOOK_INDEX) {
                console.log("Reducing orderBookIndex to " + reductionAmount * 100 + "% of its original amount");
                orderBookIndex *= reductionAmount; // reduce order book index
            }
            else if (cancelOfferPromises.length == 0 && round > 0 && orderBookIndex * 1.1 < DEFAULT_MAXIMUM_ORDER_BOOK_INDEX) { // Else increase it by 10% but not on first round
                console.log("Increasing oderBookIndex by 10%");
                orderBookIndex *= 1.1;
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
        let totalBtc = 0;

        for (let i = 0; i < offers.length; i++) {
            totalBtc += parseFloat(offers[i].amount);
        }

        return totalBtc;
    }
});

