// AWS Infrastructure creation using IaC - The API-Gateway parts

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

let api: aws.apigateway.RestApi;

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const deployPlatform = config.getBoolean("deployPlatform");

if (deployPlatform) {

	// -------- API Gateway --------
	// IAM Role for the API Gateway
	const apiGatewayRole = new aws.iam.Role("apiGatewayRole", {
	    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "apigateway.amazonaws.com" }),
	});
	
	const apiGatewayPolicy = new aws.iam.RolePolicy("apiGatewayPolicy", {
	    role: apiGatewayRole.id,
	    policy: JSON.stringify({
	        Version: "2012-10-17",
	        Statement: [
	            {
	                Effect: "Allow",
	                Action: ["lambda:InvokeFunction"],
	                Resource: "*",
	            },
	        ],
	    }),
	});
	
	// And the gateway itself
	const api = new aws.apigateway.RestApi("ApiGateway", {
	    name: "platform-api",
	    description: "api access to the platform",
	    apiKeySource: "HEADER",
	    binaryMediaTypes: [
	        "application/octet",
	        "image/jpeg",
	        "image/png",
	        "image/bmp",
	        "multipart/form-data"
	    ],
	    endpointConfiguration: {
	        types: "EDGE",
	    },
	    tags: {
	    }
	});
}


// -------- Export out the values we have set --------
export { api };
