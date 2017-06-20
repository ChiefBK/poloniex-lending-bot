var Promise = require("bluebird");
var Poloniex = require('poloniex-api-node');
var cron = require('node-cron');

var API_KEY = "LOJIE6LN-EJBGZHC6-H7TOW5KZ-5WB9SG13";
var SECRET = "cad96077dddbb2d539f45697d0164bbd37e587be0f302ee972bfc76ed14e026331d93da885a9699ec930b734c92ec3cc46fa58311744fffa14cefab9f7f3a3d2";

var DEFAULT_RATE = 0.0015;
var DEFAULT_DURATION = "2"; // A string with the number of days of loan
var DEFAULT_AUTO_RENEW = "1"; // "1" if auto-renew; "0" if not to auto-renew
var DEFAULT_STARTING_ORDER_BOOK_PERCENTAGE = 0.6; // The starting depth in the order book
var DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE = 0.2; // If open orders contain more than this percentage of funds of the total than start canceling orders
var DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE = 0.2;

var poloniex = new Poloniex(API_KEY, SECRET, {
    socketTimeout: 130000
});

var returnLoanOrders = Promise.promisify(Poloniex.prototype.returnLoanOrders, {context: poloniex});
var returnCompleteBalances = Promise.promisify(Poloniex.prototype.returnCompleteBalances, {context: poloniex});
var createLoanOffer = Promise.promisify(Poloniex.prototype.createLoanOffer, {context: poloniex});
var returnOpenLoanOffers = Promise.promisify(Poloniex.prototype.returnOpenLoanOffers, {context: poloniex});
var cancelLoanOffer = Promise.promisify(Poloniex.prototype.cancelLoanOffer, {context: poloniex});

var orderBookIndex = DEFAULT_STARTING_ORDER_BOOK_PERCENTAGE; // How deep in the order book to open loan orders

var round = 0; // number of polling cycles

var poller = function () {
    console.log("STARTING POLLER AT " + new Date().toString() + " - Round " + round);
    var loanOrders = returnLoanOrders('BTC', null);
    var balances = returnCompleteBalances('all');
    var openLoanOffers = returnOpenLoanOffers();

    Promise.all([loanOrders, balances, openLoanOffers]).then(function (response) {
        console.log("Retrieved loan orders, balance, and open loan offers");

        var openOffers = response[0].offers;
        var availableBalance = response[1].BTC.available;
        var myOpenOffers;

        if ('BTC' in response[2]) // Just in case you have no open offers
            myOpenOffers = response[2].BTC;
        else
            myOpenOffers = [];

        console.log('Available balance is ' + availableBalance);
        console.log('There are ' + openOffers.length + ' offers on the order book');
        console.log('You have ' + myOpenOffers.length + ' open offers');

        cancelOldOrders(myOpenOffers, availableBalance).then(function () {
            console.log("Finished canceling old orders");

            var totalBtcInOffers = countOrderBtc(openOffers);
            console.log("There is a total of " + totalBtcInOffers + " BTC on the order book");
            var btcOrderBookIndex = totalBtcInOffers * orderBookIndex;
            console.log("The orderBookIndex is at " + orderBookIndex * 100 + "%");
            console.log("Setting the btcOrderBookIndex to " + btcOrderBookIndex);

            var rate = determineRate(openOffers, btcOrderBookIndex);
            var amount = availableBalance * DEFAULT_LOAN_OFFER_AMOUNT_PERCENTAGE_OF_AVAILABLE;

            placeLoanOffer(amount, rate).then(function (response) {
                console.log("Order placed successfully");
                console.log("Order ID : " + response.orderID);
                console.log("Amount : " + amount);
                console.log("Rate : " + rate);
            }).catch(function (e) {
                console.log("There was an error placing the loan offer");
                console.log(e);
            }).finally(function () {
                round++;
            });

        }).catch(function (e) {
            console.log("There was an error canceling old orders");
            console.log(e);
        })
    }).catch(function (e) {
        console.log("Error getting balances and load orders");
        console.log(e);
    });

    function determineRate(loanOffers, btcOrderBookIndex) {
        var sumOffers = 0;

        for (var i = 0; i < loanOffers.length; i++) { // Find loan order with more than
            sumOffers += Number(loanOffers[i].amount);
            if (sumOffers > btcOrderBookIndex) {
                console.log("Loan offers are above " + btcOrderBookIndex + " BTC at position: " + i);
                return loanOffers[i].rate;
            }
        }

        console.log('Using the default rate');
        return DEFAULT_RATE;
    }

    // Returns a Promise after placing offer
    function placeLoanOffer(amount, rate) {
        if (amount <= 0)
            return Promise.reject("Amount was less then or equal to zero");

        console.log("creating loan offer of " + amount + " BTC for " + DEFAULT_DURATION + " days at a rate of " + rate + " with auto-renew " + DEFAULT_AUTO_RENEW);
        return createLoanOffer('BTC', amount, DEFAULT_DURATION, DEFAULT_AUTO_RENEW, rate);
    }

    function cancelOldOrders(myOpenOffers, availableBalance) {
        return new Promise(function (resolve, reject) {
            var totalBtcInOpenOffers = countOrderBtc(myOpenOffers);
            var totalBtc = availableBalance + totalBtcInOpenOffers;

            var cancelOfferPromises = [];
            while (totalBtcInOpenOffers > totalBtc * DEFAULT_OPEN_ORDERS_THRESHOLD_PERCENTAGE) {
                console.log("BTC in open offers above threshold. Canceling oldest order...");
                var oldestOffer = getOldestOffer(myOpenOffers);
                cancelOfferPromises.push(cancelOffer(oldestOffer.id));
                totalBtcInOpenOffers -= oldestOffer.amount;
            }

            // If had to cancel orders reduce orderBookIndex by 5% * number of canceled offers
            if (cancelOfferPromises.length > 0) {
                var reductionAmount = (1 - (cancelOfferPromises.length * 0.05));
                console.log("Reducing orderBookIndex to " + reductionAmount * 100 + "% of its original amount");
                orderBookIndex *= reductionAmount; // reduce order book index
            }
            else if (cancelOfferPromises.length == 0 && round > 0) { // Else increase it by 10% but not on first round
                console.log("Increasing oderBookIndex by 10%");
                orderBookIndex *= 1.1;
            }

            Promise.all(cancelOfferPromises).then(function () {
                resolve();
            })
        });
    }

    function cancelOffer(orderId) {
        return new Promise(function (resolve, reject) {
            cancelLoanOffer(orderId).then(function () {
                console.log("Successfully canceled order");
                console.log("Order ID : " + orderId);
                resolve();
            })
        })
    }

    function getOldestOffer(openOffers) {
        var oldestOffer = openOffers[0];

        for (var i = 1; i < openOffers.length; i++) {
            var offer = openOffers[i];
            var offerTimestamp = new Date(offer.date).getTime();
            var oldestOfferTimestamp = new Date(oldestOffer.date).getTime();

            if (oldestOfferTimestamp > offerTimestamp) {
                oldestOffer = offer;
            }
        }

        return oldestOffer;
    }

    function countOrderBtc(offers) {
        var totalBtc = 0;

        for (var i = 0; i < offers.length; i++) {
            totalBtc += parseFloat(offers[i].amount);
        }

        return totalBtc;
    }
};

console.log("STARTING at " + new Date().toString());

cron.schedule('5 * * * *', poller);