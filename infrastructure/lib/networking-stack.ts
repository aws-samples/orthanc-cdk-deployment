// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import * as cdk from '@aws-cdk/core';
import * as ec2 from "@aws-cdk/aws-ec2";
import { Peer, Port, SecurityGroup } from '@aws-cdk/aws-ec2';

export class NetworkStack extends cdk.Stack {

  readonly vpc: ec2.Vpc;
  readonly ecsSecurityGroup: ec2.SecurityGroup;
  readonly dbClusterSecurityGroup: ec2.SecurityGroup;
  readonly efsSecurityGroup: ec2.SecurityGroup;
  readonly loadBalancerSecurityGroup: ec2.SecurityGroup;

  constructor(scope: cdk.Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);
      // ********************************
      // VPC configuration
      // ********************************
      this.vpc = new ec2.Vpc(this, "OrthancVpc", {
        maxAzs: 2 // Default is all AZs in region
      });

      // ********************************
      // Security Group configuration
      // ********************************
      this.loadBalancerSecurityGroup = new SecurityGroup(this, 'Orthanc-ALB-SecurityGroup', { vpc: this.vpc });
      this.loadBalancerSecurityGroup.addIngressRule(Peer.ipv4('0.0.0.0/0'), Port.tcp(80));

      this.ecsSecurityGroup = new SecurityGroup(this, 'Orthanc-ECS-SecurityGroup', { vpc: this.vpc });
      this.ecsSecurityGroup.addIngressRule(this.loadBalancerSecurityGroup, Port.tcp(80));
      this.ecsSecurityGroup.addIngressRule(this.loadBalancerSecurityGroup, Port.tcp(4242));
      this.ecsSecurityGroup.addIngressRule(this.loadBalancerSecurityGroup, Port.tcp(8042));
      this.ecsSecurityGroup.addIngressRule(this.ecsSecurityGroup, Port.allTraffic());

      this.dbClusterSecurityGroup = new SecurityGroup(this, 'Orthanc-DBCluster-SecurityGroup', { vpc: this.vpc });
      this.dbClusterSecurityGroup.addIngressRule(this.ecsSecurityGroup, Port.tcp(5432));

      this.efsSecurityGroup = new SecurityGroup(this, 'Orthanc-EFS-SecurityGroup', { vpc: this.vpc });
      this.efsSecurityGroup.addIngressRule(this.ecsSecurityGroup, Port.tcp(2049));
  };
}
