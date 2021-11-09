// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import * as rds from '@aws-cdk/aws-rds';
import * as s3 from '@aws-cdk/aws-s3';
import * as kms from '@aws-cdk/aws-kms';
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import { FileSystem, LifecyclePolicy, PerformanceMode, ThroughputMode, AccessPoint } from "@aws-cdk/aws-efs";

export class StorageStack extends cdk.Stack {

  readonly rdsSecret: secretsmanager.Secret;
  readonly fileSystem?: FileSystem;
  readonly rdsInstance: rds.DatabaseInstance;
  readonly orthancBucket?: s3.Bucket;
  readonly efsAccessPoint?: AccessPoint;

  constructor(scope: cdk.Construct, id: string, props: StorageStackProps) {
    super(scope, id, props);
      // ********************************
      // DB Credentials (Secrets Manager)
      // ********************************
      this.rdsSecret = new secretsmanager.Secret(this, 'Orthanc-RDSDatabaseSecret',{
        generateSecretString: {
          excludeCharacters: "\'\"@/\\",
          passwordLength: 16
        }});

      if(props.enable_dicom_s3_storage) {
        // ********************************
        // S3 DICOM Image store bucket definition
        // ********************************   
        const bucketKmsKey = new kms.Key(this, 'OrthancBucketKey', {
          trustAccountIdentities: true,  // delegate key permissions to IAM
          enableKeyRotation: true
        });
    
        this.orthancBucket = new s3.Bucket(this, 'OrthancBucket', {
            bucketName: cdk.PhysicalName.GENERATE_IF_NEEDED,
            encryption: s3.BucketEncryption.KMS,
            encryptionKey: bucketKmsKey,
            blockPublicAccess:s3.BlockPublicAccess.BLOCK_ALL,
            enforceSSL: true,
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
        //TODO: add bucket policy
      }
      else { // If S3 is disabled, fall back to standard EFS storage
        // ********************************
        // EFS FileSystem configuration
        // ********************************
        const efsKmsKey = new kms.Key(this, 'OrthancEFSKey', {
          trustAccountIdentities: true,  // delegate key permissions to IAM
          enableKeyRotation: true
        });

        this.fileSystem = new FileSystem(this, 'OrthancFileSystem', {
          vpc: props.vpc,
          securityGroup: props.efsSecurityGroup,
          lifecyclePolicy: LifecyclePolicy.AFTER_14_DAYS, // files are not transitioned to infrequent access (IA) storage by default
          performanceMode: PerformanceMode.GENERAL_PURPOSE, // default
          throughputMode: ThroughputMode.BURSTING,
          encrypted: true,
          removalPolicy: cdk.RemovalPolicy.DESTROY,
          kmsKey: efsKmsKey
        });

        this.efsAccessPoint = this.fileSystem.addAccessPoint('NFSAccessPoint',{
            createAcl: {
              ownerGid: "433",
              ownerUid: "431",
              permissions: "755"
            },
            posixUser: {
                gid: "433",
                uid: "431"
            },
            path: "/orthanc" 
        });
      }
      // ********************************
      // RDS Instance configuration
      // ********************************   
      const rdsKmsKey = new kms.Key(this, 'OrthancRDSKey', {
        trustAccountIdentities: true,  // delegate key permissions to IAM
        enableKeyRotation: true
      });
      
      this.rdsInstance = new rds.DatabaseInstance(this, 'orthanc-instance', {
        engine: rds.DatabaseInstanceEngine.postgres({
            version: rds.PostgresEngineVersion.VER_11
        }),
        multiAz: props.enable_multi_az,
        deletionProtection: false,
        databaseName: "OrthancDB",
        storageType: rds.StorageType.GP2,
        storageEncrypted: true,
        storageEncryptionKey: rdsKmsKey,
        allocatedStorage: 20,
        backupRetention: props.enable_rds_backup ? cdk.Duration.days(30) : cdk.Duration.days(0),
        instanceType: ec2.InstanceType.of(ec2.InstanceClass.BURSTABLE3, ec2.InstanceSize.MEDIUM),
        credentials: rds.Credentials.fromPassword("postgres", this.rdsSecret.secretValue ),
        vpc: props.vpc,
        vpcSubnets: {
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT
        },
        securityGroups: [props.dbClusterSecurityGroup]
      });
  };
}

interface StorageStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  dbClusterSecurityGroup: ec2.SecurityGroup;
  efsSecurityGroup: ec2.SecurityGroup;
  enable_dicom_s3_storage: boolean;
  enable_multi_az: boolean;
  enable_rds_backup: boolean;
}
