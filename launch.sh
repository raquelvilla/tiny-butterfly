#!/bin/bash
# Starts the Tiny Butterfly server on :8790 if it isn't already answering.
if lsof -ti:8790 > /dev/null 2>&1; then
  if ! curl -sf http://localhost:8790 > /dev/null 2>&1; then
    kill $(lsof -ti:8790) 2>/dev/null
    sleep 1
  fi
fi

if ! lsof -ti:8790 > /dev/null 2>&1; then
  nohup /usr/bin/python3 /Users/raquel/Documents/tiny-butterfly/serve.py > /tmp/tiny-butterfly.log 2>&1 &
  sleep 2
fi
