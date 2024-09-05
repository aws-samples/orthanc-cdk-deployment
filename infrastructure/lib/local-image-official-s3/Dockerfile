# Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: MIT-0
FROM osimis/orthanc:21.11.0 as build

RUN apt-get update && \
    apt-get upgrade -y && \
    DEBIAN_FRONTEND="noninteractive" TZ="America/Los_Angeles" && \
    apt-get install -y git wget curl zip unzip tar mercurial cmake build-essential libcrypto++-dev g++ zlib1g-dev libssl-dev libcurl4-openssl-dev pkg-config

# Prepare and install Orthanc S3 plugin dependencies
RUN git clone https://github.com/microsoft/vcpkg
RUN ./vcpkg/bootstrap-vcpkg.sh && ./vcpkg/vcpkg install cryptopp

RUN mkdir /aws
WORKDIR /aws
RUN git clone --recurse-submodules https://github.com/aws/aws-sdk-cpp

WORKDIR /aws/aws-sdk-cpp
RUN git reset --hard f124edc826a883b9814e51f70162812f7eb27516

WORKDIR /aws
RUN mkdir -p /aws/builds/aws-sdk-cpp
WORKDIR /aws/builds/aws-sdk-cpp
RUN cmake -DBUILD_ONLY="s3;transfer" /aws/aws-sdk-cpp 
RUN make -j 4 
RUN make install

# Build Orthanc S3 plugin
WORKDIR /tmp
RUN hg clone https://hg.orthanc-server.com/orthanc-object-storage/ -r 7bf31db5497e
COPY CMakeLists.txt /tmp/orthanc-object-storage/Aws
WORKDIR /tmp/build
RUN apt-get install -y libjsoncpp-dev uuid-dev e2fsprogs libboost-all-dev
RUN cmake -DCMAKE_POLICY_DEFAULT_CMP0057=NEW -DCMAKE_TOOLCHAIN_FILE=/vcpkg/scripts/buildsystems/vcpkg.cmake -DUSE_SYSTEM_GOOGLE_TEST=OFF ../orthanc-object-storage/Aws
RUN CORES=`grep -c ^processor /proc/cpuinfo` && make -j$CORES

FROM osimis/orthanc:21.11.0 as release
# Get compiled S3 plugin binary from build stage
COPY --from=build /tmp/build/libOrthancAwsS3Storage.so /usr/share/orthanc/plugins/
COPY --from=build /usr/local/lib/libaws-cpp-sdk-*.so /usr/local/lib/

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

