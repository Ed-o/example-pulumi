// AWS Infrastructure creation using IaC - The lambda platform parts

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const deployPlatform = config.getBoolean("deployPlatform");

if (deployPlatform) {

	// Lambdas go here
}

// -------- Export out the values we have set --------
export {};

