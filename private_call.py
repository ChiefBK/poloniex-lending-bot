#!/usr/bin/env python

import urllib
import urllib2
import json
import time
import hmac,hashlib
import pprint
import os

pp = pprint.PrettyPrinter(indent=4)

req={}

APIKey = os.environ['POLONIEX_API_KEY']
Secret = os.environ['POLONIEX_API_SECRET']

command="returnAvailableAccountBalances"

req['command'] = command

req['nonce'] = int(time.time()*1000)
post_data = urllib.urlencode(req)

sign = hmac.new(Secret, post_data, hashlib.sha512).hexdigest()

headers = {
    'Sign': sign,
    'Key': APIKey
}

ret = urllib2.urlopen(urllib2.Request('https://poloniex.com/tradingApi', post_data, headers))
jsonRet = json.loads(ret.read())

pp.pprint(jsonRet)