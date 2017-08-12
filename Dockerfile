FROM debian:jessie

RUN apt-get update -y
RUN apt-get install -y git-core curl build-essential openssl libssl-dev apt-utils

RUN curl -sL https://deb.nodesource.com/setup_7.x | bash -
RUN apt-get install -y nodejs

RUN mkdir /usr/local/src/poloniex-loaning-bot

ARG poloniex_api_key
ARG poloniex_api_secret

ENV POLONIEX_API_KEY=$poloniex_api_key
ENV POLONIEX_API_SECRET=$poloniex_api_secret

ADD . /usr/local/src/poloniex-loaning-bot

WORKDIR /usr/local/src/poloniex-loaning-bot

CMD "npm" "install"
CMD "npm" "start"