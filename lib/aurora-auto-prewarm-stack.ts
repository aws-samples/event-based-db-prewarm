// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { AuroraPgAutoPrewarmer } from './aurora-pg-auto-prewarmer';
import { SecurityGroup, SubnetType, Vpc } from 'aws-cdk-lib/aws-ec2';

export class AuroraAutoPrewarmStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = Vpc.fromLookup(this, "prewarmerVpc", {
      vpcId: this.node.tryGetContext("vpcId")
    })

    const dbSecurityGroup = SecurityGroup.fromLookupById(this, "DBSecurityGroup", this.node.tryGetContext("dbSecurityGroupId"))

    new AuroraPgAutoPrewarmer(this, "AuroraPgAutoPrewarmer", {
      clusterIdentifier: this.node.tryGetContext("clusterIdentifier"),
      customEndpointIdentifier: this.node.tryGetContext("customEndpointIdentifier"),
      dbSecretArn: this.node.tryGetContext("dbSecretArn"),
      itemsToPrewarm: this.node.tryGetContext("itemsToPrewarm"),
      vpc,
      prewarmerSubnetIds: this.node.tryGetContext("prewarmerSubnetIds"),
      dbSecurityGroup,
      database: this.node.tryGetContext("database")
    })
  }
}
