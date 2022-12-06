# Cloud storage plugins for Orthanc
# Copyright (C) 2020-2021 Osimis S.A., Belgium
#
# This program is free software: you can redistribute it and/or
# modify it under the terms of the GNU Affero General Public License
# as published by the Free Software Foundation, either version 3 of
# the License, or (at your option) any later version.
#
# This program is distributed in the hope that it will be useful, but
# WITHOUT ANY WARRANTY; without even the implied warranty of
# MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the GNU
# Affero General Public License for more details.
#
# You should have received a copy of the GNU Affero General Public License
# along with this program. If not, see <http://www.gnu.org/licenses/>.


cmake_minimum_required(VERSION 2.8)

project(OrthancAwsS3Storage)

set(PLUGIN_VERSION "mainline")

if (PLUGIN_VERSION STREQUAL "mainline")
  set(ORTHANC_FRAMEWORK_DEFAULT_VERSION "mainline")
  set(ORTHANC_FRAMEWORK_DEFAULT_SOURCE "hg")
else()
  set(ORTHANC_FRAMEWORK_DEFAULT_VERSION "1.9.3")
  set(ORTHANC_FRAMEWORK_DEFAULT_SOURCE "web")
endif()

set(STATIC_BUILD OFF CACHE BOOL "Static build of the third-party libraries (necessary for Windows)")
set(ALLOW_DOWNLOADS ON CACHE BOOL "Allow CMake to download packages")
set(ORTHANC_FRAMEWORK_SOURCE "${ORTHANC_FRAMEWORK_DEFAULT_SOURCE}" CACHE STRING "Source of the Orthanc framework (can be \"system\", \"hg\", \"archive\", \"web\" or \"path\")")
set(ORTHANC_FRAMEWORK_VERSION "${ORTHANC_FRAMEWORK_DEFAULT_VERSION}" CACHE STRING "Version of the Orthanc framework")
set(ORTHANC_FRAMEWORK_ARCHIVE "" CACHE STRING "Path to the Orthanc archive, if ORTHANC_FRAMEWORK_SOURCE is \"archive\"")
set(ORTHANC_FRAMEWORK_ROOT "" CACHE STRING "Path to the Orthanc source directory, if ORTHANC_FRAMEWORK_SOURCE is \"path\"")

set(USE_VCPKG_PACKAGES ON CACHE BOOL "Use Microsoft vcpkg to link against crypto++ and AWS SDK")
set(USE_SYSTEM_CRYPTOPP ON CACHE BOOL "Use the system version of crypto++")

include(CheckIncludeFileCXX)

# Download and setup the Orthanc framework
include(${CMAKE_SOURCE_DIR}/../Common/Resources/Orthanc/CMake/DownloadOrthancFramework.cmake)

if (ORTHANC_FRAMEWORK_SOURCE STREQUAL "system")
  if (ORTHANC_FRAMEWORK_USE_SHARED)
    include(FindBoost)
    find_package(Boost COMPONENTS filesystem thread)
    
    if (NOT Boost_FOUND)
      message(FATAL_ERROR "Unable to locate Boost on this system")
    endif()
    
    include(FindOpenSSL)
    if (NOT OPENSSL_FOUND)
      message(FATAL_ERROR "Unable to find OpenSSL")
    endif()

    include(FindCURL)
    if (NOT CURL_FOUND)
      message(FATAL_ERROR "Unable to find LibCurl")
    endif()

    link_libraries(${Boost_LIBRARIES} ${OPENSSL_LIBRARIES} ${CURL_LIBRARIES} jsoncpp)
  endif()

  link_libraries(${ORTHANC_FRAMEWORK_LIBRARIES})
  
  set(USE_SYSTEM_GOOGLE_TEST ON CACHE BOOL "Use the system version of Google Test")
  set(USE_GOOGLE_TEST_DEBIAN_PACKAGE OFF CACHE BOOL "Use the sources of Google Test shipped with libgtest-dev (Debian only)")
  mark_as_advanced(USE_GOOGLE_TEST_DEBIAN_PACKAGE)
  include(${CMAKE_SOURCE_DIR}/../Common/Resources/Orthanc/CMake/GoogleTestConfiguration.cmake)
  
else()
  include(${ORTHANC_FRAMEWORK_ROOT}/../Resources/CMake/OrthancFrameworkParameters.cmake)

  set(ENABLE_CRYPTO_OPTIONS ON)
  set(ENABLE_GOOGLE_TEST ON)
  set(ENABLE_MODULE_DICOM OFF)
  set(ENABLE_MODULE_IMAGES OFF)
  set(ENABLE_MODULE_JOBS OFF)
  set(ENABLE_WEB_CLIENT ON)  # Access options related to curl
  set(ORTHANC_FRAMEWORK_PLUGIN ON)

  include(${ORTHANC_FRAMEWORK_ROOT}/../Resources/CMake/OrthancFrameworkConfiguration.cmake)

  include_directories(
    ${ORTHANC_FRAMEWORK_ROOT}
    )
endif()


include(${CMAKE_SOURCE_DIR}/../Common/Resources/Orthanc/Plugins/OrthancPluginsExports.cmake)


add_definitions(
  -DHAS_ORTHANC_EXCEPTION=1
  -DORTHANC_ENABLE_LOGGING=1
  -DAWS_STORAGE_PLUGIN=1
  -DPLUGIN_VERSION="${PLUGIN_VERSION}"
  )

include_directories(
  ${CMAKE_SOURCE_DIR}/../Common/Resources/Orthanc/Plugins/
  ${CMAKE_SOURCE_DIR}/../Common/Resources/Orthanc/Sdk-1.9.2/
  )


if (NOT STATIC_BUILD AND USE_VCPKG_PACKAGES)
  # Use vcpkg by Microsoft
  option(BUILD_SHARED_LIBS "Build shared libraries" ON)
  find_package(cryptopp CONFIG REQUIRED)
  find_package(AWSSDK REQUIRED COMPONENTS s3)
  set(CRYPTOPP_LIBRARIES cryptopp::cryptopp)
  
else()
  include(${CMAKE_SOURCE_DIR}/../Common/CryptoPPConfiguration.cmake)
  include(${CMAKE_SOURCE_DIR}/AwsStaticConfiguration.cmake)
endif()


set(COMMON_SOURCES
  ${CMAKE_SOURCE_DIR}/../Common/IStorage.h
  ${CMAKE_SOURCE_DIR}/../Common/BaseStorage.h
  ${CMAKE_SOURCE_DIR}/../Common/BaseStorage.cpp
  ${CMAKE_SOURCE_DIR}/../Common/EncryptionHelpers.cpp
  ${CMAKE_SOURCE_DIR}/../Common/EncryptionHelpers.h
  ${CMAKE_SOURCE_DIR}/../Common/EncryptionConfigurator.cpp
  ${CMAKE_SOURCE_DIR}/../Common/EncryptionConfigurator.h
  ${CMAKE_SOURCE_DIR}/../Common/FileSystemStorage.h
  ${CMAKE_SOURCE_DIR}/../Common/FileSystemStorage.cpp
  ${CMAKE_SOURCE_DIR}/../Common/MoveStorageJob.h
  ${CMAKE_SOURCE_DIR}/../Common/MoveStorageJob.cpp
  ${CMAKE_SOURCE_DIR}/../Common/Resources/Orthanc/Plugins/OrthancPluginCppWrapper.cpp

  ${AWS_SOURCES}
  ${CRYPTOPP_SOURCES}
  ${ORTHANC_CORE_SOURCES}
  )

add_library(OrthancAwsS3Storage SHARED
  AwsS3StoragePlugin.cpp
  AwsS3StoragePlugin.h
  ${CMAKE_SOURCE_DIR}/../Common/StoragePlugin.cpp

  ${COMMON_SOURCES}
  )

set_target_properties(OrthancAwsS3Storage PROPERTIES
  VERSION ${PLUGIN_VERSION}
  SOVERSION ${PLUGIN_VERSION}
  )

target_link_libraries(OrthancAwsS3Storage
  PRIVATE
  ${CRYPTOPP_LIBRARIES}
  ${AWSSDK_LINK_LIBRARIES}
  ${ORTHANC_FRAMEWORK_LIBRARIES}
  )

add_executable(UnitTests
  ${GOOGLE_TEST_SOURCES}
  ${COMMON_SOURCES}

  ${CMAKE_SOURCE_DIR}/../UnitTestsSources/EncryptionTests.cpp
  ${CMAKE_SOURCE_DIR}/../UnitTestsSources/UnitTestsMain.cpp
  )

target_link_libraries(UnitTests
  PRIVATE
  ${GOOGLE_TEST_LIBRARIES}
  ${CRYPTOPP_LIBRARIES}
  ${AWSSDK_LINK_LIBRARIES}
  ${ORTHANC_FRAMEWORK_LIBRARIES}
  )

if (STATIC_BUILD OR NOT USE_VCPKG_PACKAGES)
  add_dependencies(OrthancAwsS3Storage AwsSdkCpp)
  add_dependencies(UnitTests AwsSdkCpp)
endif()
