#!/bin/sh
grep -RIn --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist -E 'TODO|FIXME' . | head -200
