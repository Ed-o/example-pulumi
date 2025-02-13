// AWS Infrastructure creation using IaC - The secret passwords

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { SecretsManagerClient, GetSecretValueCommand } from "@aws-sdk/client-secrets-manager";
import * as random from "@pulumi/random";


// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file

// Basic settings for account
const infraName = config.require("infraName");
const region = config.require("region");

// -------- Get config values that are secret --------
const secretsManagerClient = new SecretsManagerClient({ region });

function getOrCreateAWSSecret(secretName: string, genLength: number): pulumi.Output<string> {
    // Check if the secret already exists
    const existingSecret = pulumi.output(aws.secretsmanager.getSecret({
        name: `${secretName}-${infraName}`,
    }).catch(() => undefined)); // If the secret doesn't exist, catch the error and return undefined

    return existingSecret.apply(secret => {
        if (secret) {
            // If the secret exists, retrieve its value and create the secret and value just so they do not delete or update
            // console.log(`Secret "${secretName}" already exists. Reusing it.`);
            const Secret = new aws.secretsmanager.Secret(`${secretName}-secret`, { name: `${secretName}-${infraName}`, },
                { additionalSecretOutputs: ["arn"] }); // The secret should stay secret and not be logged
            const secretVersion = new aws.secretsmanager.SecretVersion(`${secretName}-version`, {
                secretId: Secret.arn,
                secretString: "",
            }, {
                 ignoreChanges: ["secretString"],
            });
            return pulumi.output(aws.secretsmanager.getSecretVersion({
                secretId: secret.arn,
            })).apply(version => version.secretString);
        } else {
            // If the secret does not exist
            console.log(`Secret "${secretName}" does not exist. Creating a new one.`);
            const generatedPassword = new random.RandomPassword(`${secretName}-password`, {
                length: genLength,
                special: true,
                overrideSpecial: "!#$%&*()-_=+[]{}<>:?",
            });

            // Create a new secret in AWS Secrets Manager
            const newSecret = new aws.secretsmanager.Secret(`${secretName}-secret`, {
                name: `${secretName}-${infraName}`,
            }, { additionalSecretOutputs: ["arn"] }); // The secret should stay secret and not be logged

            const secretVersion = new aws.secretsmanager.SecretVersion(`${secretName}-version`, {
                secretId: newSecret.arn,
                secretString: generatedPassword.result,
            });

            // Return the generated password
            return generatedPassword.result;
        }
    });
}

// This is where we pick what passwords to setup and how long they should be
const rdsPassword = getOrCreateAWSSecret("RDSPassword", 20);
const grafanaPassword = getOrCreateAWSSecret("grafanaPassword", 15);

// -------- Export out the values we have set --------
const secretsSet = true;
export {secretsSet};
export {rdsPassword};
export {grafanaPassword};

