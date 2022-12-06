// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0
import { App, Stack, StackProps } from 'aws-cdk-lib'; 
import { FlowLogDestination, FlowLogTrafficType, Peer, Port, SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2';
import { LogGroup } from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

export class NetworkStack extends Stack {

  readonly vpc: Vpc;
  readonly ecsSecurityGroup: SecurityGroup;
  readonly dbClusterSecurityGroup: SecurityGroup;
  readonly efsSecurityGroup: SecurityGroup;
  readonly loadBalancerSecurityGroup: SecurityGroup;

  constructor(scope: Construct, id: string, props: NetworkStackProps) {
    super(scope, id, props);
      // ********************************
      // VPC configuration
      // ********************************
      this.vpc = new Vpc(this, "OrthancVpc", {
        maxAzs: 2, // Default is all AZs in region
      });

      if(props.enable_vpc_flow_logs) {
        const cwLogs = new LogGroup(this, 'Log', {
          logGroupName: '/aws/vpc/flowlogs',
        });  
        this.vpc.addFlowLog("OrthancVPCFlowLogs",{
          destination: FlowLogDestination.toCloudWatchLogs(cwLogs),
          trafficType: FlowLogTrafficType.ALL
        });
      }
      // ********************************
      // Security Group configuration
      // ********************************
      this.loadBalancerSecurityGroup = new SecurityGroup(this, 'Orthanc-ALB-SecurityGroup', { vpc: this.vpc });
      this.loadBalancerSecurityGroup.addIngressRule(Peer.ipv4('0.0.0.0/0'), Port.tcp(80));

      this.ecsSecurityGroup = new SecurityGroup(this, 'Orthanc-ECS-SecurityGroup', { vpc: this.vpc, allowAllOutbound: true });
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

interface NetworkStackProps extends StackProps {
  enable_vpc_flow_logs: Boolean;
}