// AWS Infrastructure creation using IaC

import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import { STSClient, GetCallerIdentityCommand } from "@aws-sdk/client-sts";
import * as random from "@pulumi/random";


// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file

// Basic settings for account
const infraName = config.require("infraName");
const companyURL = config.require("companyURL");
const accountId = config.require("account");
const region = config.require("region");
const worthkeeping = config.getBoolean("worthkeeping");

// -------- Get config values that are secret --------
const secretsManagerClient = new SecretsManagerClient({ region });

async function getOrCreateAWSSecret(secretName: string): Promise<string> {
    try {
        // Attempt to get the secret from Secrets Manager
        const command = new GetSecretValueCommand({ SecretId: secretName });
        const secretValue = await secretsManagerClient.send(command);
        return secretValue.SecretString ?? ""; // Return the existing secret
    } catch (error) {
        // If the error is a ResourceNotFoundException, create a new secret
        const errorMessage = (error as any).message || "Unknown error";
        if (errorMessage.includes("Secrets Manager can't find the specified secret")) {
            const randomPassword = new random.RandomPassword("randomPassword", {
                length: 20,
                special: true,
                overrideSpecial: "!@#$%^&*()-_=+[]{}<>",
            }).result;

            // Store the new password in Secrets Manager
            const secret = new aws.secretsmanager.Secret(secretName, {
                name: secretName,
            });
            new aws.secretsmanager.SecretVersion("secretVersion", {
                secretId: secret.id,
                secretString: randomPassword,
            });

            // Return the generated password
            return "";
        } else {
            throw "Sorry --> an error happened reading AWS secrets";
            // throw errorMessage
            // throw error; 
        }
    }
}

// We get the rds Password here
getOrCreateAWSSecret("rdsPassword").then(password => {
    console.log("Retrieved or created RDS password");
}).catch(error => {
    console.error("Error handling RDS password:", error);
});

// -------- First we check we are in the right AWS account : --------

// Create the STS client
const stsClient = new STSClient({});

// Get the AWS account ID from the credentials
const getCallerIdentity = async () => {
  const command = new GetCallerIdentityCommand({});
  const response = await stsClient.send(command);
  return response.Account;
};

// Perform the check
getCallerIdentity().then((currentAccountId) => {
  if (currentAccountId !== accountId) {
    throw new Error(
      `The current AWS credentials are for account ${currentAccountId}, but the configuration is for account ${accountId}.`
    );
  }
});


// -------- Now we start creating the infrastructure -------- 
// ----------------------------------------------------------

import * as network from "./modules/network";

import * as security from "./modules/security";

import * as database from "./modules/database";

import * as backup from "./modules/backup";

import * as cognito from "./modules/cognito";

import * as apigw from "./modules/apigw";

import * as waf from "./modules/waf";

import * as lambdas from "./modules/lambdas";

import * as dns from "./modules/dns";

import * as logging from "./modules/logging";


// -------- Export out the values we have set --------
export const vpcId = network.vpc.id;
export const publicSubnetIDs = network.publicSubnets;
export const privateSubnetIDs = network.privateSubnets;
export const kmsKeyId = security.kmsKey.id;
export const dbEndpointAddressIs = database.dbEndpoint;
export const dbPortIs = database.dbPort;
export const dbBackupVault = backup.dbBackupVault;
export const userPoolId = cognito.userPool;
export const userPoolClientId = cognito.userPoolClient;
export const apiName = apigw.api;
export const wafAPIGateway = waf.waFv2WebACL;
export const wafCognito = waf.waFv2WebACL2;
export const zoneId = dns.dnsZone.zoneId;
export const certArn = dns.cert.arn;
export const nginxServiceName = pulumi.interpolate`${logging.nginxService.name}.ecs.${region}.amazonaws.com`;

