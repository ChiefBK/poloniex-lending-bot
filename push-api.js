const WebSocket = require('ws');
const Autobahn = require('autobahn');

var connection = new Autobahn.Connection({
	url: "wss://api.poloniex.com",
	realm: "realm1"
});

connection.onopen = function(session) {
	function marketEvent(args, kwargs) {
		console.log(args);
	}

	function tickerEvent(args, kwargs) {
		console.log(args);
	}

	function trollboxEvent(args, kwargs) {
		console.log(args);
	}
	session.subscribe('BTC_XMR', marketEvent);
	session.subscribe('ticker', tickerEvent);
	session.subscribe('trollbox', trollboxEvent);
}

connection.onclose = function() {
	console.log("Websocket connection closed");
}

console.log("STARTING...");

connection.open();