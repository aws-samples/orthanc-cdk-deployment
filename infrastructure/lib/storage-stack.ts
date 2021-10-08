// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import * as rds from '@aws-cdk/aws-rds';
import * as s3 from '@aws-cdk/aws-s3';
import * as kms from '@aws-cdk/aws-kms';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import { FileSystem, LifecyclePolicy, PerformanceMode, ThroughputMode } from "@aws-cdk/aws-efs";

export class StorageStack extends cdk.Stack {

  readonly secret: secretsmanager.Secret;
  readonly fileSystem?: FileSystem;
  readonly rdsInstance: rds.DatabaseInstance;
  readonly orthancBucket?: s3.Bucket;

  constructor(scope: cdk.Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
      // ********************************
      // DB Credentials (Secrets Manager)
      // ********************************
      this.secret = new secretsmanager.Secret(this, 'Orthanc-RDSDatabaseSecret',{
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: "postgres" }),
          generateStringKey: 'password',
          excludeCharacters: "\'\"@/\\",
          passwordLength: 16
        }});

      if(props.enable_dicom_s3_storage) {
        // ********************************
        // S3 DICOM Image store bucket definition
        // ********************************   
        const targetKmsKey = new kms.Key(this, 'MyTargetKey', {
          trustAccountIdentities: true  // delegate key permissions to IAM
        });
    
        this.orthancBucket = new s3.Bucket(this, 'OrthancBucket', {
            bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: targetKmsKey,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
            autoDeleteObjects: true,
            versioned: true,
            lifecycleRules: [
              {
                abortIncompleteMultipartUploadAfter: cdk.Duration.days(30),
                transitions: [
                  {
                    storageClass: s3.StorageClass.INTELLIGENT_TIERING,
                    transitionAfter: cdk.Duration.days(30)
                  },
                ],
              },
            ],
        });
      }
      else { // If S3 is disabled, fall back to standard EFS storage
        // ********************************
        // EFS FileSystem configuration
        // ********************************
        this.fileSystem = new FileSystem(this, 'OrthancFileSystem', {
          vpc: props.vpc,
          securityGroup: props.efsSecurityGroup,
          lifecyclePolicy: LifecyclePolicy.AFTER_14_DAYS, // files are not transitioned to infrequent access (IA) storage by default
          performanceMode: PerformanceMode.GENERAL_PURPOSE, // default
          throughputMode: ThroughputMode.BURSTING,
        });

        this.fileSystem.addAccessPoint('NFSAccessPoint',{
            posixUser: {
                gid: "0",
                uid: "0"
            },
            path: "/" 
        });
      }
      // ********************************
      // RDS Instance configuration
      // ********************************         
      this.rdsInstance = new rds.DatabaseInstance(this, 'orthanc-instance', {
        engine: rds.DatabaseInstanceEngine.postgres({
            version: rds.PostgresEngineVersion.VER_11
        }),
        databaseName: "OrthancDB",
        storageType: rds.StorageType.GP2,
        storageEncrypted: true,
        allocatedStorage: 20,
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MEDIUM),
        credentials: rds.Credentials.fromSecret(this.secret),
        vpc: props.vpc,
        securityGroups: [props.dbClusterSecurityGroup]
      });
  };
}

interface StorageStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dbClusterSecurityGroup: ec2.SecurityGroup;
  efsSecurityGroup: ec2.SecurityGroup;
  enable_dicom_s3_storage: boolean;
}
