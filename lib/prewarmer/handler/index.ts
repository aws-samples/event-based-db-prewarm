// Copyright Amazon.com, Inc. or its affiliates. All Rights Reserved.
// SPDX-License-Identifier: MIT-0

import { EventBridgeEvent } from "aws-lambda";
import { RdsInstanceEvent } from "./rds-instance-event";
import { DescribeDBClusterEndpointsCommand, DescribeDBClustersCommand, DescribeDBInstancesCommand, ModifyDBClusterEndpointCommand, RDSClient } from "@aws-sdk/client-rds";
import { GetSecretValueCommand, SecretsManagerClient } from "@aws-sdk/client-secrets-manager";
import { connect } from "ts-postgres";

const clusterName = process.env.AURORA_PG_CLUSTER_NAME
const itemsToPrewarm = process.env.ITEMS_TO_PREWARM
const dbClusterEndpointIdentifier = process.env.DB_CLUSTER_ENDPOINT_IDENTIFIER
const dbSecretArn = process.env.DB_SECRET_ARN
const dbName = process.env.DB_NAME

const rdsClient = new RDSClient()
const smClient = new SecretsManagerClient()

export const handler = async(event: EventBridgeEvent<string, RdsInstanceEvent>) => {
    const dbCluster = await rdsClient.send(new DescribeDBClustersCommand({
        DBClusterIdentifier: clusterName
    }))

    if (dbCluster.DBClusters && itemsToPrewarm) {
        console.log(`Found Cluster: ${JSON.stringify(dbCluster.DBClusters[0])}`)
        const arrItemsToPrewarm = itemsToPrewarm.split(",")
        const {detail} = event
        const cluster = dbCluster.DBClusters[0]
        const readReplica = cluster.DBClusterMembers?.find((rr) => rr.DBInstanceIdentifier === detail.SourceIdentifier && !rr.IsClusterWriter)

        if (readReplica) {
            const replicaDetails = await rdsClient.send(new DescribeDBInstancesCommand({
                DBInstanceIdentifier: readReplica.DBInstanceIdentifier
            }))

            if (replicaDetails && replicaDetails.DBInstances) {                
                const dbSecret = await smClient.send(new GetSecretValueCommand({
                    SecretId: dbSecretArn
                }))
    
                const {username, password} = JSON.parse(dbSecret.SecretString!)
    
                const replicaEndpoint = replicaDetails.DBInstances[0].Endpoint

                const pgClient = await connect({
                    host: replicaEndpoint?.Address,
                    port: replicaEndpoint?.Port,
                    user: username,
                    password: password,
                    database: dbName
                })

                for (let itemToPrewarm of arrItemsToPrewarm) {
                    const result = await pgClient.query(`select pg_prewarm('${itemToPrewarm}')`)
                    console.log(`Prewarmed: ${itemToPrewarm}`)
                }

                const endpoints = await rdsClient.send(new DescribeDBClusterEndpointsCommand({
                    DBClusterEndpointIdentifier: dbClusterEndpointIdentifier
                }))

                if (endpoints.DBClusterEndpoints) {
                    let staticMembers = endpoints.DBClusterEndpoints[0].StaticMembers
                    if (!staticMembers) {
                        staticMembers = [readReplica.DBInstanceIdentifier!]
                    } else {
                        staticMembers.push(readReplica.DBInstanceIdentifier!)
                    }

                    console.log(`Updating Custom Endpoints: ${JSON.stringify(staticMembers)}`)
                    await rdsClient.send(new ModifyDBClusterEndpointCommand({
                        DBClusterEndpointIdentifier: dbClusterEndpointIdentifier,
                        StaticMembers: staticMembers
                    }))
                }
            }
        }
    }
}