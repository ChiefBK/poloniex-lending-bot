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

APIKey = 'I5BFCRA1-JS5LE8ZU-GA8BZCW3-C0QSIPXR'
Secret = '1f35ce8954b6d38c00091b8057a18199882377233478fb6288071009f1796d3b8b40c5a94501bf1a51880442350d12b8b016e04bc2f3d5430023367dc297ea89'

command="returnLendingHistory"

req['command'] = command

req['nonce'] = int(time.time()*1000)
req['start'] = 1502668800g
req['end'] = 1502742555
post_data = urllib.urlencode(req)

sign = hmac.new(Secret, post_data, hashlib.sha512).hexdigest()

headers = {
    'Sign': sign,
    'Key': APIKey
}

ret = urllib2.urlopen(urllib2.Request('https://poloniex.com/tradingApi', post_data, headers))
jsonRet = json.loads(ret.read())

pp.pprint(jsonRet)