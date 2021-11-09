// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import * as cloudfront from '@aws-cdk/aws-cloudfront';
import * as origins from '@aws-cdk/aws-cloudfront-origins';
import * as ecs from "@aws-cdk/aws-ecs";
import * as elbv2 from "@aws-cdk/aws-elasticloadbalancingv2";
import * as ecs_patterns from "@aws-cdk/aws-ecs-patterns";
import * as s3 from '@aws-cdk/aws-s3';
import * as ec2 from "@aws-cdk/aws-ec2";
import * as secretsmanager from '@aws-cdk/aws-secretsmanager';
import { ContainerDefinition, FargatePlatformVersion, LinuxParameters, Protocol } from '@aws-cdk/aws-ecs';
import { Aws } from '@aws-cdk/core';
import { FileSystem, AccessPoint } from "@aws-cdk/aws-efs";
import * as rds from '@aws-cdk/aws-rds';

export class OrthancStack extends cdk.Stack {

  constructor(scope: cdk.Construct, id: string, props: OrthancStackProps) {
    super(scope, id, props);

      // ********************************
      // Orthanc Credentials (Secrets Manager)
      // ********************************
      const orthancCredentials = new secretsmanager.Secret(this, 'Orthanc-Credentials',{
        generateSecretString: {
          secretStringTemplate: JSON.stringify({}),
          generateStringKey: 'admin',
          excludeCharacters: "\'\"@/\\",
          passwordLength: 16
        }});

      // ********************************
      // ECS Fargate Cluster & ALB & Task definition
      // ********************************      
      const cluster = new ecs.Cluster(this, "OrthancCluster", {
        vpc: props.vpc,
      });

      // create a task definition with CloudWatch Logs
      const logging = new ecs.AwsLogDriver({
        streamPrefix: "orthanc",
      });
  
      const taskDef = new ecs.FargateTaskDefinition(this, "OrthancTaskDefinition", {
        memoryLimitMiB: 4096,
        cpu: 2048,
      });

      let orthancConfig = { 
        AwsS3Storage: { 
          BucketName:  props.orthancBucket?.bucketName,
          Region: Aws.REGION,
          ConnectionTimeout: 30, 
          RequestTimeout: 1200, 
          RootPath: "",
          StorageStructure: "flat", 
          MigrationFromFileSystemEnabled: false } 
        };
      
      let container = {
        image: ecs.ContainerImage.fromAsset('./lib/local-image-official-s3/'),
        logging,
        taskDefinition: taskDef,
        environment: {
            ORTHANC__POSTGRESQL__HOST: props.rdsInstance.dbInstanceEndpointAddress,
            ORTHANC__POSTGRESQL__PORT: props.rdsInstance.dbInstanceEndpointPort,     
            LOCALDOMAIN: Aws.REGION + ".compute.internal-orthanconaws.local",
            DICOM_WEB_PLUGIN_ENABLED: "true",
            ORTHANC__POSTGRESQL__USERNAME: "postgres",
            //VERBOSE_STARTUP: "true",      // uncomment to enable verbose logging in container
            //VERBOSE_ENABLED: "true",      // uncomment to enable verbose logging in container
            //TRACE_ENABLED: "true",        // uncomment to enable trace level logging in container
            STONE_WEB_VIEWER_PLUGIN_ENABLED: "true",
            STORAGE_BUNDLE_DEFAULTS: "false",
            LD_LIBRARY_PATH: "/usr/local/lib",
            WSI_PLUGIN_ENABLED: "true",
            ORTHANC_JSON: props.enable_dicom_s3_storage ? JSON.stringify(orthancConfig) : "{}",
            // If we disabled S3, remove the plugin so it won't cause issues at startup
            BEFORE_ORTHANC_STARTUP_SCRIPT: props.enable_dicom_s3_storage ? "" : "/tmp/custom-script.sh"
        },
        secrets: {
            ORTHANC__REGISTERED_USERS: ecs.Secret.fromSecretsManager(orthancCredentials),
            ORTHANC__POSTGRESQL__PASSWORD: ecs.Secret.fromSecretsManager(props.secret)
        },
        linuxParameters: new LinuxParameters(this, "OrthancLinuxParams", { initProcessEnabled: true}),
        containerName: "orthanc-container",
        portMappings: [
            {
                containerPort: 8042,
                hostPort: 8042,
                protocol: Protocol.TCP
            },
            {
                containerPort: 4242,
                hostPort: 4242,
                protocol: Protocol.TCP
            },
        ],
        SecurityGroup: props.ecsSecurityGroup
      };

      const orthancContainerDefinition: ContainerDefinition = taskDef.addContainer("OrthancContainer", container);
      orthancCredentials.grantRead(orthancContainerDefinition.taskDefinition.taskRole);
      props.secret.grantRead(orthancContainerDefinition.taskDefinition.taskRole);

      if(props.enable_dicom_s3_storage) { // If S3 DICOM storage is enabled, add neccessary permissions to bucket
        props.orthancBucket?.grantReadWrite(taskDef.taskRole); 
      }
      else { // If S3 DICOM storage is disabled, fall back to EFS - add volume and mount points
        const volume: ecs.Volume = {
          name: "orthanc-efs",
          efsVolumeConfiguration: {
            fileSystemId: props.orthancFileSystem?.fileSystemId ? props.orthancFileSystem?.fileSystemId : "",
            transitEncryption: "ENABLED",
            authorizationConfig: {
                accessPointId: props.efsAccessPoint?.accessPointId,
                iam: "ENABLED"
            }
          }
        };
        
        orthancContainerDefinition.addMountPoints(
          {
            containerPath: "/var/lib/orthanc/db",
            sourceVolume: volume.name,
            readOnly: false,
          }
        );
        taskDef.addVolume(volume);
      }
      
      const loadBalancer = new elbv2.ApplicationLoadBalancer(this, "OrthancLoadBalancer", {
        vpc: props.vpc,
        securityGroup: props.loadBalancerSecurityGroup,
        internetFacing: true,
      });

      if(props.access_logs_bucket_arn != "") {
        loadBalancer.logAccessLogs(s3.Bucket.fromBucketArn(this, "MyAccessLogBucket", props.access_logs_bucket_arn));
      }

      const fargateService = new ecs_patterns.ApplicationLoadBalancedFargateService(this, "OrthancService", {
        cluster,
        loadBalancer: loadBalancer,
        taskDefinition: taskDef,
        desiredCount: props.enable_multi_az ? 2 : 1,
        platformVersion: FargatePlatformVersion.VERSION1_4,
        securityGroups: [props.ecsSecurityGroup]
      });

      fargateService.targetGroup.configureHealthCheck({
        path: "/",
        interval: cdk.Duration.seconds(60),
        healthyHttpCodes:"200-499", // We have to check for 401 as the default state of "/" is unauthenticated
      });

      // ********************************
      // Cloudfront Distribution
      // ********************************    
      const myOriginRequestPolicy = new cloudfront.OriginRequestPolicy(this, 'OriginRequestPolicy', {
        originRequestPolicyName: 'OrthancPolicy',
        comment: 'Policy optimised for Orthanc',
        cookieBehavior: cloudfront.OriginRequestCookieBehavior.all(),
        headerBehavior: cloudfront.OriginRequestHeaderBehavior.all(),
        queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      });

      const orthancDistribution = new cloudfront.Distribution(this, 'OrthancDistribution', {
        defaultBehavior: { 
          origin: new origins.LoadBalancerV2Origin(loadBalancer, { protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY }),
          originRequestPolicy: myOriginRequestPolicy,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        },
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2019
      });

      // ********************************
      // Stack Outputs
      // ********************************  
      new cdk.CfnOutput(this, 'OrthancCredentialsName', {
        value: orthancCredentials.secretName,
        description: 'The name of the OrthancCredentials secret',
        exportName: 'orthancCredentialsName',
      });
      new cdk.CfnOutput(this, 'OrthancURL', {
        value: orthancDistribution.distributionDomainName,
        description: 'Orthanc Distribution URL',
        exportName: 'orthancDistributionURL',
      });
  };
}

interface OrthancStackProps extends cdk.StackProps {
  vpc: ec2.IVpc;
  orthancBucket?: s3.Bucket;
  orthancFileSystem?: FileSystem;
  rdsInstance: rds.DatabaseInstance;
  secret: secretsmanager.Secret;
  ecsSecurityGroup: ec2.SecurityGroup;
  loadBalancerSecurityGroup: ec2.SecurityGroup;
  enable_dicom_s3_storage: Boolean;
  enable_multi_az: Boolean;
  access_logs_bucket_arn: string;
  efsAccessPoint?: AccessPoint;
}
