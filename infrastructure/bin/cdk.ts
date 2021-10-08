#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { OrthancStack } from '../lib/orthanc-stack';
import { NetworkStack } from '../lib/networking-stack';
import { StorageStack } from '../lib/storage-stack';

// ********************************
// Orthanc parameters
// ********************************   
const ENABLE_DICOM_S3_STORAGE = true;     // If true, use an S3 bucket as the DICOM image store
const ORTHANC_USERNAME = "admin";         // Default Orthanc admin username
const ORTHANC_PASSWORD = "_Admin1";       // Default Orthanc admin password

// ********************************
// App & Stack configuration
// ********************************   
const app = new cdk.App();
const networkStack = new NetworkStack(app, 'Orthanc-Network', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }
});

const storageStack = new StorageStack(app, 'Orthanc-Storage', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: networkStack.vpc,
  dbClusterSecurityGroup: networkStack.dbClusterSecurityGroup,
  efsSecurityGroup: networkStack.efsSecurityGroup,
  enable_dicom_s3_storage: ENABLE_DICOM_S3_STORAGE
});

const orthancStack = new OrthancStack(app, 'Orthanc-ECSStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: networkStack.vpc,
  orthancBucket: storageStack.orthancBucket,
  orthancFileSystem: storageStack.fileSystem,
  rdsInstance: storageStack.rdsInstance,
  secret: storageStack.secret,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  loadBalancerSecurityGroup: networkStack.loadBalancerSecurityGroup,
  orthancUserName: ORTHANC_USERNAME,
  orthancPassword: ORTHANC_PASSWORD,
  enable_dicom_s3_storage: ENABLE_DICOM_S3_STORAGE
});
