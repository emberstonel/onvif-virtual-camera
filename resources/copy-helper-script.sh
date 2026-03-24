#!/bin/sh
set -eu

if [ $# -ne 1 ]; then
    echo "Usage: /copy-helper-script <destination-path>"
    exit 1
fi

cp /usr/local/bin/macvlan-init.sh "$1"
chmod +x "$1"
echo "Helper script copied to $1"
