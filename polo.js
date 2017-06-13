//KEYS and REQUIRES
var Poloniex = require('poloniex-api-node');
var poloniex = new Poloniex('API-PUBLIC-KEY', 'API-PRIVATE-KEY', {
  socketTimeout: 130000
});

var availableBalance = 0;
var sumOffers = 0;
var threshold = "False";
var rate = 0.0;
var offerRate = 0.0;
program_counter = 0;

var gogopolo = function() {

  program_counter = program_counter + 1;
  console.log("BEGIN********************");
  console.log("Program Counter: " + program_counter);
  console.log(availableBalance + " " + sumOffers + " " + threshold + " " + rate + " " + offerRate);
  console.log("*************************");

  //Calculate offerRate
  poloniex.returnLoanOrders('BTC', null, function(err, ticker) {
    if (!err) {
      for (var i = 0; i <= ticker.offers.length - 1; i++) {
        sumOffers = sumOffers + Number(ticker.offers[i].amount);
        if (sumOffers > 20 && threshold == "False") {
          threshold = "True";
          console.log("Loan offers are above 20 BTC at position: " + i);
          rate = ticker.offers[i].rate;
        }
      }
      threshold = "False";
      sumOffers = 0;
    } else {
      console.log("returnLoanOrders errored: " + err)
    }
  });

  //Find available lending balance
  poloniex.returnCompleteBalances("all", function(err, body) {
    if (!err) {
      availableBalance = body.BTC.available;
      console.log("Available balance is: " + availableBalance);
      console.log("rate is: " + rate);
      offerRate = (parseFloat(rate) - .000005).toFixed(6)
      console.log("offer rate is: " + offerRate);

    } else {
      console.log("returnCompleteBalances errored: " + err);
    }

    if (availableBalance > .1 && offerRate > 0) {
      place_loan_offer();
    } else {
      console.log("No order placed: Available Balance: " + availableBalance + " offer rate: " + offerRate)
      rate = 0;
      offerRate = 0;
      availableBalance = 0;
    }

  }); //end of returnCompleteBalance

  //Place loan offer if possible
  var place_loan_offer = function() {
    console.log("placing loan offer " + availableBalance + " " + offerRate)
    poloniex.createLoanOffer("BTC", availableBalance, "2", "0", offerRate, function(err, body) {
      if (!err) {
        console.log(body);
        availableBalance = 0;
        rate = 0;
        offerRate = 0;
        console.log("END************************");
      } else {
        console.log(err);
      }
    });
  };

}; // end gogopolo

var cancel_old_orders = function() {

  poloniex.returnOpenLoanOffers(function(err, body) {
    if (!err) {
      if (Object.keys(body).length > 0) {
        cancel_order(body.BTC[body.BTC.length - 1].id);
      } else {
        console.log("No open loan offers to cancel");
      }
    } else {
      console.log("ReturnOpenLoanOffers errored");
      console.log(err);
    }
  });

}; // end cancel_old_orders

var cancel_order = function(orderId) {

  poloniex.cancelLoanOffer(orderId, function(err, body) {
    if (!err) {
      console.log(body);
    } else {
      console.log("Should never see");
      console.log(err);
    }
  });
}; // end cancel_order

var Atai = setInterval(gogopolo, 160000); //check if a loan offer can be placed.
var Atai2 = setInterval(cancel_old_orders, 3600123); //cancel a loan offer if it has not been taken.