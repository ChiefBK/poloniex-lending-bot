#!/usr/bin/env python

import docker
import subprocess
import os
import argparse
import pprint

NETWORK_NAME = "bridge"

if os.environ['POLONIEX_API_KEY'] is None or os.environ['POLONIEX_API_SECRET'] is None:
    raise EnvironmentError('POLONIEX_API_KEY or POLONIEX_API_SECRET env variables not set')

POLONIEX_API_KEY = os.environ['POLONIEX_API_KEY']
POLONIEX_API_SECRET = os.environ['POLONIEX_API_SECRET']

CONTAINERS = [
    {
        'name': 'poloniex-loaning-bot-db',
        'image': 'ipierce/poloniex-loaning-bot-db',
        'ports': [27017],
        'path': os.path.join('/Users', 'ian', 'Code', 'poloniex-loaning-bot-db'),
        'build-args': {}
    },
    {
        'name': 'poloniex-loaning-bot',
        'image': 'ipierce/poloniex-loaning-bot',
        'ports': [],
        'path': os.path.join('/Users', 'ian', 'Code', 'poloniex-loaning-bot'),
        'build-args': {
            'poloniex_api_key': POLONIEX_API_KEY,
            'poloniex_api_secret': POLONIEX_API_SECRET
        }
    }
]

parser = argparse.ArgumentParser(description='Run/Build/Pull Docker containers for the Poloniex Loaning Bot')
parser.add_argument('--build', action='store_true')
parser.add_argument('--run', action='store_true')
args = parser.parse_args()

pp = pprint.PrettyPrinter(indent=4)

CLIENT = docker.from_env()

def main():
    docker_user = "ipierce"
    docker_password = os.environ["DOCKER_PASS"]

    response = CLIENT.login(username=docker_user, password=docker_password)
    print "Logged in!"

    if args.build:
        for container in CONTAINERS:
            CLIENT.images.build(path=container['path'], tag=container['image'], buildargs=container['build-args'])
            print "Built image " + container['image']
    else:
        for container in CONTAINERS:
            CLIENT.images.pull(container['image'])
            print "Pulled image " + container['image']

    for container in CLIENT.containers.list(all=True):
        print "Killing and removing container " + container.name
        if container.status == 'running':
            container.kill()
        container.remove()

    network = get_or_create_network(NETWORK_NAME)

    gateway = network.attrs['IPAM']['Config'][0]['Gateway']

    if args.run:
        for container in CONTAINERS:
            run_container(container, gateway)
            print 'Container ' + container['name'] + ' is running'

        p = subprocess.Popen(['docker', 'logs', '-f', 'poloniex-loaning-bot'])
        try:
            p.wait()
        except KeyboardInterrupt:
            try:
               p.terminate()
            except OSError:
               pass
            p.wait()


def run_container(container_obj, gateway):
    ports = {}

    for port in container_obj['ports']:
        ports[str(port) + '/tcp'] = (gateway, port)

    CLIENT.containers.run(container_obj['image'], name=container_obj['name'], stdin_open=True, tty=True, detach=True, ports=ports)


def get_or_create_network(network_name):
    network_list = CLIENT.networks.list()

    for network in network_list:
        if (network.name == network_name):
            return network

    return CLIENT.networks.create(network_name, driver="bridge")

if __name__ == "__main__": main()