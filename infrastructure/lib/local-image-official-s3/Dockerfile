# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
FROM osimis/orthanc:21.11.0 as build
RUN apt-get -y update
RUN apt-get install -y git mercurial build-essential unzip cmake libcrypto++-dev wget
WORKDIR /tmp
RUN hg clone https://hg.orthanc-server.com/orthanc-object-storage/ -b default
WORKDIR /tmp/build
RUN cmake -DSTATIC_BUILD=ON -DCMAKE_BUILD_TYPE=Release -DUSE_VCPKG_PACKAGES=OFF -DUSE_SYSTEM_GOOGLE_TEST=OFF ../orthanc-object-storage/Aws
RUN CORES=`grep -c ^processor /proc/cpuinfo` && make -j$CORES

FROM osimis/orthanc:21.11.0 as release
# Get compiled S3 plugin binary from build stage
COPY --from=build /tmp/build/libOrthancAwsS3Storage.so /usr/share/orthanc/plugins/
# Update OS packages
RUN apt-get -y update 
RUN DEBIAN_FRONTEND=noninteractive apt-get -y upgrade
# Create non-root Orthanc user and group
RUN groupadd -r orthanc -g 433 && \
    useradd -u 431 -r -g orthanc -c "Orthanc user" orthanc
RUN chmod -R 755 /usr/share/orthanc
RUN chown -R orthanc /usr/share/orthanc
# Add custom script that can remove S3 plugin if neccessary
COPY custom-script.sh /tmp
RUN chown -R orthanc /tmp
RUN chmod +x /tmp/custom-script.sh
#USER orthanc

