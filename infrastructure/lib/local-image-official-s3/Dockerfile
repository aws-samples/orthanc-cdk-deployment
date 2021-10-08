# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
FROM osimis/orthanc as build
RUN apt-get -y update
RUN apt-get install -y git mercurial build-essential unzip cmake libcrypto++-dev wget
WORKDIR /tmp
RUN hg clone https://hg.orthanc-server.com/orthanc-object-storage/ -b default
WORKDIR /tmp/build
RUN cmake -DSTATIC_BUILD=ON -DCMAKE_BUILD_TYPE=Release -DUSE_VCPKG_PACKAGES=OFF -DUSE_SYSTEM_GOOGLE_TEST=OFF ../orthanc-object-storage/Aws
RUN CORES=`grep -c ^processor /proc/cpuinfo` && make -j$CORES

FROM osimis/orthanc as release
COPY --from=build /tmp/build/libOrthancAwsS3Storage.so /usr/share/orthanc/plugins/