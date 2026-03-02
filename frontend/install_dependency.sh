#!/bin/bash
set -xe

npm create vite@latest . -- --template react &&
#npm install
npm install xterm xterm-addon-fit
