#!/bin/bash

set -o errexit
set -o xtrace

# Removing S3 plugin so it won't crash Orthanc at startup, if the configuration is not present
rm -f /usr/share/orthanc/plugins/libOrthancAwsS3Storage.so