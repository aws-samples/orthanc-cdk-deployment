// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Aws, CfnOutput, Duration, Stack, StackProps, Token } from "aws-cdk-lib";
import {
  AllowedMethods,
  CachePolicy,
  Distribution,
  Function,
  FunctionCode,
  FunctionEventType,
  OriginProtocolPolicy,
  OriginRequestCookieBehavior,
  OriginRequestHeaderBehavior,
  OriginRequestPolicy,
  OriginRequestQueryStringBehavior,
  ResponseHeadersPolicy,
  SecurityPolicyProtocol,
} from "aws-cdk-lib/aws-cloudfront";
import { LoadBalancerV2Origin } from "aws-cdk-lib/aws-cloudfront-origins";
import { IVpc, SecurityGroup } from "aws-cdk-lib/aws-ec2";
import {
  AwsLogDriver,
  Cluster,
  ContainerDefinition,
  ContainerImage,
  FargatePlatformVersion,
  FargateTaskDefinition,
  LinuxParameters,
  Protocol,
  Secret,
  Volume,
} from "aws-cdk-lib/aws-ecs";
import { ApplicationLoadBalancedFargateService } from "aws-cdk-lib/aws-ecs-patterns";
import { AccessPoint, FileSystem } from "aws-cdk-lib/aws-efs";
import { ApplicationLoadBalancer } from "aws-cdk-lib/aws-elasticloadbalancingv2";
import { DatabaseInstance } from "aws-cdk-lib/aws-rds";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Construct } from "constructs";
import * as secretsmanager from "aws-cdk-lib/aws-secretsmanager";

export class OrthancStack extends Stack {
  constructor(scope: Construct, id: string, props: OrthancStackProps) {
    super(scope, id, props);

    // ********************************
    // Orthanc Credentials (Secrets Manager)
    // ********************************
    const orthancCredentials = new secretsmanager.Secret(
      this,
      "Orthanc-Credentials",
      {
        generateSecretString: {
          secretStringTemplate: JSON.stringify({}),
          generateStringKey: "admin",
          excludeCharacters: "'\"@/\\",
          passwordLength: 16,
        },
      }
    );

    // ********************************
    // ECS Fargate Cluster & ALB & Task definition
    // ********************************
    const cluster = new Cluster(this, "OrthancCluster", {
      vpc: props.vpc,
    });

    // create a task definition with CloudWatch Logs
    const logging = new AwsLogDriver({
      streamPrefix: "orthanc",
    });

    const taskDef = new FargateTaskDefinition(this, "OrthancTaskDefinition", {
      memoryLimitMiB: 4096,
      cpu: 2048,
    });

    let orthancConfig = {
      AwsS3Storage: {
        BucketName: props.orthancBucket?.bucketName,
        Region: Aws.REGION
      },
      PostgreSQL: {
        EnableIndex: true,
        EnableStorage: false,
        Port: Token.asNumber(props.rdsInstance.dbInstanceEndpointPort),
        Host: props.rdsInstance.dbInstanceEndpointAddress,
        Database: "postgres",
        Username: "postgres",
        Password: Secret.fromSecretsManager(props.secret),
        EnableSsl: true,
        Lock: false
      }
    };

    let container = {
      image: ContainerImage.fromRegistry("orthancteam/orthanc:24.8.3-full"),
      logging,
      taskDefinition: taskDef,
      environment: {
        DICOM_WEB_PLUGIN_ENABLED: "true",
        ORTHANC_WEB_VIEWER_PLUGIN_ENABLED: "true",
        STONE_WEB_VIEWER_PLUGIN_ENABLED: "true",
        AWS_S3_STORAGE_PLUGIN_ENABLED: "true",
        POSTGRESQL_PLUGIN_ENABLED: "true",
        WSI_PLUGIN_ENABLED: "true",
        LOCALDOMAIN: Aws.REGION + ".compute.internal-orthanconaws.local",
        //VERBOSE_STARTUP: "true",      // uncomment to enable verbose logging in container
        //VERBOSE_ENABLED: "true",      // uncomment to enable verbose logging in container
        //TRACE_ENABLED: "true",        // uncomment to enable trace level logging in container
        STORAGE_BUNDLE_DEFAULTS: "false",
        LD_LIBRARY_PATH: "/usr/local/lib",
        ORTHANC_JSON: JSON.stringify(orthancConfig),
        // If we disabled S3, remove the plugin so it won't cause issues at startup
        //BEFORE_ORTHANC_STARTUP_SCRIPT: props.enable_dicom_s3_storage
        //  ? ""
        //  : "/tmp/custom-script.sh",
      },
      secrets: {
        ORTHANC__REGISTERED_USERS:
          Secret.fromSecretsManager(orthancCredentials),
        ORTHANC__POSTGRESQL__PASSWORD: Secret.fromSecretsManager(props.secret),
      },
      linuxParameters: new LinuxParameters(this, "OrthancLinuxParams", {
        initProcessEnabled: true,
      }),
      containerName: "orthanc-container",
      portMappings: [
        {
          containerPort: 8042,
          hostPort: 8042,
          protocol: Protocol.TCP,
        },
        {
          containerPort: 4242,
          hostPort: 4242,
          protocol: Protocol.TCP,
        },
      ],
      SecurityGroup: props.ecsSecurityGroup,
    };

    const orthancContainerDefinition: ContainerDefinition =
      taskDef.addContainer("OrthancContainer", container);
    orthancCredentials.grantRead(
      orthancContainerDefinition.taskDefinition.taskRole
    );
    props.secret.grantRead(orthancContainerDefinition.taskDefinition.taskRole);

    if (props.enable_dicom_s3_storage) {
      // If S3 DICOM storage is enabled, add neccessary permissions to bucket
      props.orthancBucket?.grantReadWrite(taskDef.taskRole);
    } else {
      // If S3 DICOM storage is disabled, fall back to EFS - add volume and mount points
      const volume: Volume = {
        name: "orthanc-efs",
        efsVolumeConfiguration: {
          fileSystemId: props.orthancFileSystem?.fileSystemId
            ? props.orthancFileSystem?.fileSystemId
            : "",
          transitEncryption: "ENABLED",
          authorizationConfig: {
            accessPointId: props.efsAccessPoint?.accessPointId,
            iam: "ENABLED",
          },
        },
      };

      orthancContainerDefinition.addMountPoints({
        containerPath: "/var/lib/orthanc/db",
        sourceVolume: volume.name,
        readOnly: false,
      });
      taskDef.addVolume(volume);
    }

    const loadBalancer = new ApplicationLoadBalancer(
      this,
      "OrthancLoadBalancer",
      {
        vpc: props.vpc,
        securityGroup: props.loadBalancerSecurityGroup,
        internetFacing: true,
      }
    );

    if (props.access_logs_bucket_arn != "") {
      loadBalancer.logAccessLogs(
        Bucket.fromBucketArn(
          this,
          "MyAccessLogBucket",
          props.access_logs_bucket_arn
        )
      );
    }

    const fargateService = new ApplicationLoadBalancedFargateService(
      this,
      "OrthancService",
      {
        cluster,
        loadBalancer: loadBalancer,
        taskDefinition: taskDef,
        desiredCount: props.enable_multi_az ? 2 : 1,
        platformVersion: FargatePlatformVersion.VERSION1_4,
        securityGroups: [props.ecsSecurityGroup],
      }
    );

    fargateService.targetGroup.configureHealthCheck({
      path: "/",
      interval: Duration.seconds(60),
      healthyHttpCodes: "200-499", // We have to check for 401 as the default state of "/" is unauthenticated
    });

    // ********************************
    // Cloudfront Distribution
    // ********************************
    const myOriginRequestPolicy = new OriginRequestPolicy(
      this,
      "OriginRequestPolicy",
      {
        originRequestPolicyName: "OrthancPolicy",
        comment: "Policy optimised for Orthanc",
        cookieBehavior: OriginRequestCookieBehavior.all(),
        headerBehavior: OriginRequestHeaderBehavior.all(),
        queryStringBehavior: OriginRequestQueryStringBehavior.all(),
      }
    );
    
    /** Fixes Cors Issue */
    const cors = new Function(this, "CorsFunction", {
      code: FunctionCode.fromInline(`
        function handler(event) {
          if(event.request.method === 'OPTIONS') {
              var response = {
                  statusCode: 204,
                  statusDescription: 'OK',
                  headers: {
                      'access-control-allow-origin': { value: '*' },
                      'access-control-allow-headers': { value: '*' }
                  }
              };
              return response;
          }
          return event.request;
        }
      `),
    });

    const orthancDistribution = new Distribution(this, "OrthancDistribution", {
      defaultBehavior: {
        origin: new LoadBalancerV2Origin(loadBalancer, {
          protocolPolicy: OriginProtocolPolicy.HTTP_ONLY,
        }),
        originRequestPolicy: myOriginRequestPolicy,
        responseHeadersPolicy: ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS_WITH_PREFLIGHT,
        cachePolicy: CachePolicy.CACHING_DISABLED,
        allowedMethods: AllowedMethods.ALLOW_ALL,
        functionAssociations: [
          {
            function: cors,
            eventType: FunctionEventType.VIEWER_REQUEST,
          },
        ],
      },
      minimumProtocolVersion: SecurityPolicyProtocol.TLS_V1_2_2019,
    });

    // ********************************
    // Stack Outputs
    // ********************************
    new CfnOutput(this, "OrthancCredentialsName", {
      value: orthancCredentials.secretName,
      description: "The name of the OrthancCredentials secret",
      exportName: "orthancCredentialsName",
    });
    new CfnOutput(this, "OrthancURL", {
      value: orthancDistribution.distributionDomainName,
      description: "Orthanc Distribution URL",
      exportName: "orthancDistributionURL",
    });
  }
}

interface OrthancStackProps extends StackProps {
  vpc: IVpc;
  orthancBucket?: Bucket;
  orthancFileSystem?: FileSystem;
  rdsInstance: DatabaseInstance;
  secret: secretsmanager.Secret;
  ecsSecurityGroup: SecurityGroup;
  loadBalancerSecurityGroup: SecurityGroup;
  enable_dicom_s3_storage: Boolean;
  enable_multi_az: Boolean;
  access_logs_bucket_arn: string;
  efsAccessPoint?: AccessPoint;
}
