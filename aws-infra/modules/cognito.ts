// AWS Infrastructure creation using IaC - The Cognito parts

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const deployPlatform = config.getBoolean("deployPlatform");

let userPool: aws.cognito.UserPool;
let userPoolClient: aws.cognito.UserPoolClient;


if (deployPlatform) {

	// -------- Cognito --------

	// Create a Cognito User Pool
	const userPool = new aws.cognito.UserPool("cognitoUserPool", {
	    name: "cognitoUserPool",
	    passwordPolicy: {
	        minimumLength: 8,
	        requireLowercase: true,
	        requireNumbers: true,
	        requireSymbols: true,
	        requireUppercase: true,
	    },
	    // mfaConfiguration: "OPTIONAL",
	    autoVerifiedAttributes: ["email"],
	});
	
	// Create a User Pool Client for the User Pool
	const userPoolClient = new aws.cognito.UserPoolClient("cognitoUserPoolClient", {
	    userPoolId: userPool.id,
	    generateSecret: false,
	    allowedOauthFlows: ["code"],
	    allowedOauthScopes: ["phone", "email", "openid", "profile"],
	    allowedOauthFlowsUserPoolClient: true,
	    callbackUrls: ["https://myapp.com/callback"],
	    logoutUrls: ["https://myapp.com/logout"],
	});
}

// -------- Export out the values we have set --------
export {userPool};
export {userPoolClient};

// export {};
