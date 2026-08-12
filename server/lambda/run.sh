#!/bin/bash
# Function handler for the Lambda Web Adapter.
#
# LWA's bootstrap wrapper (AWS_LAMBDA_EXEC_WRAPPER=/opt/bootstrap) executes this
# script, then proxies each Function URL invocation to the HTTP server it
# starts. exec replaces the shell so node receives signals directly.
exec node index.js
