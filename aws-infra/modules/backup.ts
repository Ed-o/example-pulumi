// AWS Infrastructure creation using IaC - The Backup parts

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as security from "./security" ;
import * as database from "./database" ;

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const dbBackupRetentionPeriodDaily = config.getNumber("dbBackupRetentionPeriodDaily")
const dbBackupRetentionPeriodMonthly = config.getNumber("dbBackupRetentionPeriodMonthly");
const accountId = config.require("account");
const region = config.require("region");
const deployPlatform = config.getBoolean("deployPlatform");

let dbBackupVault: aws.backup.Vault

if (deployPlatform) {
	// Add IAM roles to allow backup to happen
	const backupRole = new aws.iam.Role("backup-role", {
	    assumeRolePolicy: JSON.stringify({
	        Version: "2012-10-17",
	        Statement: [{
	            Effect: "Allow",
	            Principal: { Service: "backup.amazonaws.com" },
	            Action: "sts:AssumeRole",
	        }],
	    }),
	});
	
	// Attach a policy to allow AWS Backup to perform actions on RDS
	const backupRolePolicy = new aws.iam.RolePolicy("backupRolePolicy", {
	    role: backupRole.id,
	    policy: JSON.stringify({
	        Version: "2012-10-17",
	        Statement: [
	            {
	                Effect: "Allow",
	                Action: [
	                    "rds:DescribeDBInstances",
	                    "rds:DescribeDBSnapshots",
	                    "rds:CreateDBSnapshot",
	                    "rds:DeleteDBSnapshot",
	                    "rds:ListTagsForResource"
	                ],
	                Resource: "*"
	            },
	            {
	                Effect: "Allow",
	                Action: [
	                    "ec2:DescribeVolumes",
	                    "ec2:CreateTags",
	                    "ec2:DeleteTags"
	                ],
	                Resource: "*"
	            },
	            {
	                Effect: "Allow",
	                Action: [
	                    "backup:StartBackupJob",
	                    "backup:StopBackupJob",
	                    "backup:ListBackupJobs",
	                    "backup:DescribeBackupVault",
	                    "backup:ListBackupVaults"
	                ],
	                Resource: "*"
	            }
	        ]
	    })
	});
	
	// Define an RDS backup plan
	const dbBackupVault = new aws.backup.Vault("Backups", {
	    name: "Backups",
	});
	
	// Attach a policy to the KMS key to allow the backup vault to use it for encryption
	const backupKeyPolicy = new aws.kms.KeyPolicy("backupKeyPolicy", {
	    keyId: security.kmsKey.id,
	    policy: pulumi.interpolate`{
	        "Version": "2012-10-17",
	        "Statement": [
	            {
	                "Effect": "Allow",
	                "Principal": {
	                    "AWS": "*"
	                },
	                "Action": "kms:Encrypt",
	                "Resource": "${security.kmsKey.arn}",
	                "Condition": {
	                    "StringEquals": {
	                        "kms:ViaService": "backup.${region}.amazonaws.com"
	                    }
	                }
	            },
	            {
	                "Effect": "Allow",
	                "Principal": {
	                    "AWS": "arn:aws:iam::${accountId}:root"
	                },
	                "Action": "kms:*",
	                "Resource": "${security.kmsKey.arn}"
	            }
	        ]
	    }`
	});
	
	const dbBackupPlanDaily = new aws.backup.Plan("rdsBackupPlanDaily", {
	    rules: [{
	        ruleName: "rds-backup-daily",
	        targetVaultName: dbBackupVault.name,
	        schedule: "cron(0 5 ? * * *)",  // Daily backup at 5AM UTC
	        lifecycle: {
	            deleteAfter: dbBackupRetentionPeriodDaily,  // Use the retention period defined
	        },
	    }],
	});
	
	const dbBackupPlanMonthly = new aws.backup.Plan("rdsBackupPlaniMonthly", {
	    rules: [{
	        ruleName: "rds-backup-monthly",
	        targetVaultName: dbBackupVault.name,
	        schedule: "cron(0 5 1 * ? *)",  // Monthly backup
	        lifecycle: {
	            deleteAfter: dbBackupRetentionPeriodMonthly,  // Use the retention period defined
	        },
	    }],
	});
	
	const dbResourceAssignmentDaily = new aws.backup.Selection("dbResourceAssignmentDaily", {
	    iamRoleArn: backupRole.arn,
	    planId: dbBackupPlanDaily.id,
	    resources: [database.rds.arn],
	});
	
	const dbResourceAssignmentMonthly = new aws.backup.Selection("dbResourceAssignmentMonthly", {
	    iamRoleArn: backupRole.arn,
	    planId: dbBackupPlanMonthly.id,
	    resources: [database.rds.arn],
	});

}

// -------- Export out the values we have set --------
export {dbBackupVault};

