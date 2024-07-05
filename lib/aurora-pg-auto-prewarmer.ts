// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { Duration, Names, Stack } from "aws-cdk-lib";
import { ISecurityGroup, IVpc, Port, SecurityGroup, Subnet, SubnetSelection, Vpc } from "aws-cdk-lib/aws-ec2";
import { EventBus, Rule } from "aws-cdk-lib/aws-events";
import { LambdaFunction } from "aws-cdk-lib/aws-events-targets";
import { Effect, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { DatabaseCluster } from "aws-cdk-lib/aws-rds";
import { NagSuppressions } from "cdk-nag";
import { Construct } from "constructs";

export interface AuroraPgAutoPrewarmerProps {
    clusterIdentifier: string
    itemsToPrewarm: string[]
    dbSecretArn: string
    customEndpointIdentifier: string
    vpc: IVpc
    prewarmerSubnetIds: string[],
    dbSecurityGroup: ISecurityGroup
    database: string
}

export class AuroraPgAutoPrewarmer extends Construct {
    constructor(scope: Construct, id: string, props: AuroraPgAutoPrewarmerProps) {
        super(scope, id)

        const stack = Stack.of(this)

        const clusterArn = `arn:aws:rds:${stack.region}:${stack.account}:cluster:${props.clusterIdentifier}`
        const clusterEndpointArn = `arn:aws:rds:${stack.region}:${stack.account}:cluster-endpoint:${props.customEndpointIdentifier}`

        const dbCluster = DatabaseCluster.fromDatabaseClusterAttributes(this, "TargetAuroraCluster", {
            clusterIdentifier: props.clusterIdentifier
        })

        const subnetArns: string[] = props.prewarmerSubnetIds.map((r) => `arn:aws:ec2:${stack.region}:${stack.account}:subnet/${r}`)
        const prewarmerLambdaFunctionName = `AuroraAutoPrewarmer-${props.clusterIdentifier}-${props.customEndpointIdentifier}-${props.database}`
        const logGroupArn = `arn:aws:logs:${stack.region}:${stack.account}:log-group:/aws/lambda/${prewarmerLambdaFunctionName}`
        const prewarmerSecuritGroup = new SecurityGroup(this, "PrewarmerSecurityGroup", {
            vpc: props.vpc
        })
        const prewarmerRole = new Role(this, "PrewarmerRole", {
            assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
            inlinePolicies: {
                "VPCAccess": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "ec2:CreateNetworkInterface"
                            ],
                            resources: [
                                `arn:aws:ec2:${stack.region}:${stack.account}:network-interface/*`,
                                `arn:aws:ec2:${stack.region}:${stack.account}:security-group/${prewarmerSecuritGroup.securityGroupId}`
                            ].concat(subnetArns)
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "ec2:DescribeNetworkInterfaces",
                                "ec2:DescribeSubnets"
                            ],
                            resources: ["*"]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "ec2:DeleteNetworkInterface",
                                "ec2:AssignPrivateIpAddresses",
                                "ec2:UnassignPrivateIpAddresses"
                            ],
                            resources: ["*"],
                            conditions: {
                                "StringEqualsIfExists": {
                                    "ec2:Subnet": subnetArns
                                }
                            }
                        })
                    ]
                }),
                "CWLogsAccess": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "logs:CreateLogGroup"
                            ],
                            resources: [
                                `${logGroupArn}:*`
                            ]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "logs:CreateLogStream",
                                "logs:PutLogEvents"
                            ],
                            resources: [
                                `${logGroupArn}:log-stream:*`
                            ]
                        })
                    ]
                }),
                "DBCredentialsAccess": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "secretsmanager:GetSecretValue"
                            ],
                            resources: [
                                props.dbSecretArn
                            ]
                        })
                    ]
                }),
                "RDSClusterAccess": new PolicyDocument({
                    statements: [
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "rds:DescribeDBClusters"
                            ],
                            resources: [
                                clusterArn
                            ]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "rds:DescribeDBInstances"
                            ],
                            resources: ["*"]
                        }),
                        new PolicyStatement({
                            effect: Effect.ALLOW,
                            actions: [
                                "rds:DescribeDBClusterEndpoints",
                                "rds:ModifyDBClusterEndpoint"
                            ],
                            resources: [clusterEndpointArn]
                        })
                    ]
                }),
            }
        })

        NagSuppressions.addResourceSuppressions(prewarmerRole, [
            {
                id: "AwsSolutions-IAM5",
                reason: "Resources can't be identified during build time, can only be known during runtime."
            }
        ])

        const prewarmerFunction = new NodejsFunction(this, "PrewarmerFunction", {
            entry: __dirname+"/prewarmer/handler/index.ts",
            depsLockFilePath: __dirname+"/prewarmer/package-lock.json",
            role: prewarmerRole,
            timeout: Duration.minutes(5),
            memorySize: 256,
            environment: {
                "AURORA_PG_CLUSTER_NAME": props.clusterIdentifier,
                "ITEMS_TO_PREWARM": props.itemsToPrewarm.join(","),
                "DB_CLUSTER_ENDPOINT_IDENTIFIER": props.customEndpointIdentifier,
                "DB_SECRET_ARN": props.dbSecretArn,
                "DB_NAME": props.database
            },
            bundling: {
                nodeModules: [
                    "ts-postgres"
                ]
            },
            functionName: prewarmerLambdaFunctionName,
            vpc: props.vpc,
            vpcSubnets: props.vpc.selectSubnets({
                subnets: props.prewarmerSubnetIds.map((r) => Subnet.fromSubnetAttributes(this, `prewarmer-subnet-${r}`, {
                    subnetId: r,
                    availabilityZone: "RESOLVE_LATER"
                }))
            }),
            runtime: Runtime.NODEJS_20_X,
            securityGroups: [
                prewarmerSecuritGroup
            ]
        })

        
        props.dbSecurityGroup.connections.allowFrom(prewarmerSecuritGroup, Port.tcp(5432))

        const defaultEventBus = EventBus.fromEventBusName(this, "DefaultEventBus", "default")

        new Rule(this, "NewDBInstanceEvent", {
            eventBus: defaultEventBus,
            eventPattern: {
                source: ["aws.rds"],
                detailType: ["RDS DB Instance Event"],
                detail: {
                    EventID: ["RDS-EVENT-0005"]
                }
            },
            targets: [
                new LambdaFunction(prewarmerFunction)
            ]
        })
    }
}