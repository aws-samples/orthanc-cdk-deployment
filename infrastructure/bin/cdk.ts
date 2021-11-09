#!/usr/bin/env node
// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import 'source-map-support/register';
import * as cdk from '@aws-cdk/core';
import { OrthancStack } from '../lib/orthanc-stack';
import { NetworkStack } from '../lib/networking-stack';
import { StorageStack } from '../lib/storage-stack';

// ********************************
// Deployment parameters
// ********************************   
const ENABLE_DICOM_S3_STORAGE = true;     // If true, use an S3 bucket as the DICOM image store, otherwise use EFS
const ACCESS_LOGS_BUCKET_ARN = "";        // If provided, enables ALB access logs using the specified bucket ARN
const ENABLE_MULTI_AZ = false;            // If true, uses multi-AZ deployment for RDS and ECS
const ENABLE_RDS_BACKUP = false;          // If true, enables automatic backup for RDS
const ENABLE_VPC_FLOW_LOGS = false;       // If true, enables VPC flow logs to CloudWatch

// ********************************
// App & Stack configuration
// ********************************   
const app = new cdk.App();
const networkStack = new NetworkStack(app, 'Orthanc-Network', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  enable_vpc_flow_logs: ENABLE_VPC_FLOW_LOGS
});

const storageStack = new StorageStack(app, 'Orthanc-Storage', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: networkStack.vpc,
  dbClusterSecurityGroup: networkStack.dbClusterSecurityGroup,
  efsSecurityGroup: networkStack.efsSecurityGroup,
  enable_dicom_s3_storage: ENABLE_DICOM_S3_STORAGE,
  enable_multi_az: ENABLE_MULTI_AZ,
  enable_rds_backup: ENABLE_RDS_BACKUP
});

const orthancStack = new OrthancStack(app, 'Orthanc-ECSStack', {
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION },
  vpc: networkStack.vpc,
  orthancBucket: storageStack.orthancBucket,
  orthancFileSystem: storageStack.fileSystem,
  rdsInstance: storageStack.rdsInstance,
  secret: storageStack.rdsSecret,
  ecsSecurityGroup: networkStack.ecsSecurityGroup,
  loadBalancerSecurityGroup: networkStack.loadBalancerSecurityGroup,
  enable_dicom_s3_storage: ENABLE_DICOM_S3_STORAGE,
  enable_multi_az: ENABLE_MULTI_AZ,
  access_logs_bucket_arn: ACCESS_LOGS_BUCKET_ARN,
  efsAccessPoint: storageStack.efsAccessPoint
});
