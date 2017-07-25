import Promise from 'bluebird';
import Poloniex from 'poloniex-api-node';

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

const MongoClient = Promise.promisifyAll(require('mongodb').MongoClient);

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

// TODO - add start poller immediately option

export default function Poller(dbConnection) {
    this.db = dbConnection;
};

Poller.prototype.run = () => {
    console.log("STARTING POLLER AT " + new Date().toString() + " - Round " + round);

    returnAvailableAccountBalances(null).then((availableBalances) => {
        let promises = [];
        if ('exchange' in availableBalances) {
            promises.push(transferBalance('BTC', availableBalances.exchange.BTC, 'exchange', 'lending'));
        }

        promises.push(returnLoanOrders('BTC', null));

        return Promise.all(promises);
    }).then((response) => {
        let loanOrders;
        if (response.length > 1) {
            loanOrders = response[1];
        }
        else {
            loanOrders = response[0];
        }

        return Promise.all([loanOrders, returnCompleteBalances('all')]);
    }).then((result) => {
        result.push(returnOpenLoanOffers());
        return Promise.all(result);
    }).then((result) => {
        result.push(returnActiveLoans());
        return Promise.all(result);
    }).then((response) => {
        console.log("Retrieved loan orders, balance, and open loan offers");

        const openLoanOffersOnOrderBook = response[0].offers;
        const availableBalance = parseFloat(response[1].BTC.available);
        let myOpenOffers;

        if ('BTC' in response[2]) // Just in case you have no open offers then you must check that the 'BTC' key is in the response
            myOpenOffers = response[2].BTC;
        else
            myOpenOffers = [];

        const myActiveLoans = response[3].provided;
        const myOpenOffersBalance = countOrderBtc(myOpenOffers);
        const myActiveLoansBalance = countOrderBtc(myActiveLoans);

        console.log('Available balance is ' + availableBalance + ' BTC');
        console.log('There are ' + openLoanOffersOnOrderBook.length + ' offers on the order book');
        console.log('You have ' + myOpenOffers.length + ' open offers worth ' + myOpenOffersBalance.toFixed(8) + ' BTC');
        console.log('You have ' + myActiveLoans.length + ' active loans worth ' + myActiveLoansBalance.toFixed(8) + ' BTC');
        console.log('You have a grand total of ' + (availableBalance + myOpenOffersBalance + myActiveLoansBalance).toFixed(8) + ' BTC');

        return Promise.all([openLoanOffersOnOrderBook, availableBalance, cancelOldOrders(myOpenOffers, availableBalance)]);
    }).then((response) => {
        const openLoanOffersOnOrderBook = response[0];
        const availableBalance = response[1];

        console.log("Finished canceling old orders");

        const totalBtcInOffers = countOrderBtc(openLoanOffersOnOrderBook);
        console.log("There is a total of " + totalBtcInOffers.toFixed(8) + " BTC on the order book");
        const btcOrderBookIndex = totalBtcInOffers * orderBookIndex;
        console.log("The orderBookIndex is at " + orderBookIndex * 100 + "%");
        console.log("Setting the btcOrderBookIndex to " + btcOrderBookIndex.toFixed(8));

        const rate = determineRate(openLoanOffersOnOrderBook, btcOrderBookIndex);
        const amount = Math.min(availableBalance * DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE, DEFAULT_MAXIMUM_LOAN_OFFER_AMOUNT);

        return placeLoanOffer(amount, rate);
    }).then((response) => {
        console.log("Order #" + response.orderID + " placed successfully");
    }).catch((e) => {
        console.log("There was an error placing the loan offer");
        console.log(e);
    }).finally(() => {
        round++;
        console.log("----------------------------------------");
    }).catch((e) => {
        console.log("Error getting balances and load orders");
        console.log(e);
    });

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
};

