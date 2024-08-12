#!/usr/bin/env bash

GARDENLINUX_GENESIS="2020-03-31"
TODAY=$(date "+%Y-%m-%d")

START_SECONDS=$(date -d "$GARDENLINUX_GENESIS" +%s)
END_SECONDS=$(date -d "$TODAY" +%s)

GARDENLINUX_VERSION=$(( (END_SECONDS - START_SECONDS) / 86400 ))

OUTFILE=$(mktemp)

cd package-aggregator || exit 1
go run . -o $OUTFILE -exclude package-build -exclude package-python3.11
cd ..|| exit 2

git config --global user.email "package_aggregator@gardenlinux.io"
git config --global user.name "package_aggregator"
git fetch origin gh-pages
git checkout gh-pages
cp $OUTFILE packages/$GARDENLINUX_VERSION.json
git add packages/$GARDENLINUX_VERSION.json
git commit -m "Package status for Gardenlinux Day $GARDENLINUX_VERSION"
git push origin gh-pages
