#!/bin/bash
# 只关闭自动化浏览器，不动用户的日常 Chrome
pkill -f "Chrome-Agent.app/Contents/MacOS/Google Chrome" 2>/dev/null
sleep 2
echo "已关闭 Chrome-Agent；日常 Chrome 不受影响"
