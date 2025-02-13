// AWS Infrastructure creation using IaC - The Database parts

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as network from "./network" ;
import * as security from "./security" ;

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const dbServerless = config.getBoolean("dbServerless");
const dbSize = config.require("dbSize");
const dbStorage = config.getNumber("dbStorage");
const highAvailability = config.getBoolean("highAvailability");
const deployPlatform = config.getBoolean("deployPlatform");

let dbPort : string;
let dbEndpoint : string;
let rds: aws.rds.Instance | aws.rds.Cluster;

if (deployPlatform) {
	// Security Group for Database access
	const rdsSecurityGroup = new aws.ec2.SecurityGroup("rds-security-group", {
	    vpcId: network.vpc.id,
	    description: "Allow inbound MySQL access",
	    ingress: [
	        {
	            protocol: "tcp",
	            fromPort: 3306,
	            toPort: 3306,
	            cidrBlocks: ["10.0.0.0/8"], // Change this to restrict access
	        },
	    ],
	    egress: [
	        {
	            protocol: "-1", // All traffic
	            fromPort: 0,
	            toPort: 0,
	            cidrBlocks: ["0.0.0.0/0"],
	        },
	    ],
	});
	
	// -------- Database --------
	const rdsConfig = {
	    engine: "mysql",
	    engineVersion: "8.0",
	    port: 3306,
	    dbName: "db",
	    username: "admin",
	    password: "SuperSecretPassword123",
	};
	
	let dbSubnetGroup: aws.rds.SubnetGroup | undefined;
	
	if (highAvailability && network.privateSubnets.length > 0) {
	    dbSubnetGroup = new aws.rds.SubnetGroup("db-subnet-group", {
	        subnetIds: network.privateSubnets
		    .filter(subnet => subnet !== undefined && subnet !== null) // Filter invalid subnets
		    .map(subnet => subnet),
	    });
	} else if (highAvailability) {
	    throw new Error("No private subnets found for highAvailability setup.");
	}
	
	const rdsIamRole = new aws.iam.Role("rds-iam-role", {
	    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
	        Service: "rds.amazonaws.com",
	    }),
	});
	
	// IAM Policy to allow RDS to access KMS for encryption
	const kmsPolicy = new aws.iam.RolePolicy("kms-access-policy", {
	    role: rdsIamRole.id,
	    policy: pulumi.interpolate`{
	        "Version": "2012-10-17",
	        "Statement": [
	            {
	                "Effect": "Allow",
	                "Action": [
	                    "kms:Encrypt",
	                    "kms:Decrypt",
	                    "kms:ReEncrypt*",
	                    "kms:GenerateDataKey*",
	                    "kms:DescribeKey"
	                ],
	                "Resource": "${security.kmsKey.arn}"
	            }
	        ]
	    }`,
	});
	
	// Create either an RDS instance or a serverless cluster
	
	if (dbServerless) {
	    rds = new aws.rds.Cluster("db-cluster", {
	        ...rdsConfig,
	        clusterIdentifier: "db",
	        engineMode: "serverless",
	        engine: "mysql",
	        engineVersion: "8.0",
	        scalingConfiguration: {
	            autoPause: true,
	            maxCapacity: 2,
	            minCapacity: 1,
	        },
	    });
	} else {
	    rds = new aws.rds.Instance("db", {
	        ...rdsConfig,
	        instanceClass: dbSize,
	        allocatedStorage: dbStorage,
	        multiAz: highAvailability,
	        engine: "mysql",
	        engineVersion: "8.0",
	        dbSubnetGroupName: dbSubnetGroup ? dbSubnetGroup.name : undefined,
	        kmsKeyId: security.kmsKey.arn,
	        storageEncrypted: true,
	        skipFinalSnapshot: true,
	        vpcSecurityGroupIds: [rdsSecurityGroup.id],
	        autoMinorVersionUpgrade: true,
	        backupRetentionPeriod: 7,
	    });
	}
	
	
	// -------- Export out the values we have set --------

	const dbEndpoint = dbServerless ? rds.endpoint : (rds as aws.rds.Instance).address;
	const dbPort = rdsConfig.port;

}
export {dbPort};
export {dbEndpoint};
export {rds};
