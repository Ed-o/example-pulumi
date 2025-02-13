// AWS Infrastructure creation using IaC - The WAF parts
	
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
	
// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const pKMSKEY = config.get("pKMSKEY") || "";
const pFlowAPILogGroup = config.get("pFlowAPILogGroup") || "aws-waf-logs-API-Gateways";
const pFlowCognitoLogGroup = config.get("pFlowCognitoLogGroup") || "aws-waf-logs-Cognito";
const logRetentionDays = config.get("logRetentionDays") || 7;
const deployPlatform = config.getBoolean("deployPlatform");

let waFv2WebACL: aws.wafv2.WebAcl;
let waFv2WebACL2: aws.wafv2.WebAcl;

if (deployPlatform) {	
	// -------- WAF --------
	
	const waFv2WebACL = new aws.wafv2.WebAcl("waFv2WebAcl", {
	    description: "WAF-Api-Gateway",
	    defaultAction: {
	        allow: {},
	    },
	    visibilityConfig: {
	        sampledRequestsEnabled: true,
	        cloudwatchMetricsEnabled: true,
	        metricName: "Waf-Api-Gateway",
	    },
	    scope: "REGIONAL",
	    rules: [
	        {
	            name: "AWS-brute-force",
	            priority: 0,
	            action: {
	                captcha: {},
	            },
	            statement: {
	                rateBasedStatement: {
	                    limit: 2000,
	                    aggregateKeyType: "IP",
	                    scopeDownStatement: {
	                        byteMatchStatement: {
	                            fieldToMatch: {
	                                uriPath: {},
	                            },
	                            textTransformations: [{
	                                priority: 0,
	                                type: "NONE",
	                            }],
	                            positionalConstraint: "STARTS_WITH",
	                            searchString: "/",
	                        },
	                    },
	                },
	            },
	            visibilityConfig: {
	                sampledRequestsEnabled: true,
	                cloudwatchMetricsEnabled: true,
	                metricName: "AWS-API-Brute-Force",
	            },
	        },
	        {
	            name: "AWS-AWSManagedRulesAmazonIpReputationList",
	            priority: 1,
	            overrideAction: {
	                none: {},
	            },
	            statement: {
	                managedRuleGroupStatement: {
	                    vendorName: "AWS",
	                    name: "AWSManagedRulesAmazonIpReputationList",
	                    ruleActionOverrides: [
	                        {
	                            name: "AWSManagedIPReputationList",
	                            actionToUse: {
	                                count: {},
	                            },
	                        },
	                        {
	                            name: "AWSManagedReconnaissanceList",
	                            actionToUse: {
	                                count: {},
	                            },
	                        },
	                        {
	                            name: "AWSManagedIPDDoSList",
	                            actionToUse: {
	                                count: {},
	                            },
	                        },
	                    ],
	                },
	            },
	            visibilityConfig: {
	                sampledRequestsEnabled: true,
	                cloudwatchMetricsEnabled: true,
	                metricName: "AWS-AWSManagedRulesAmazonIpReputationList",
	            },
	        },
	        {
	            name: "AWS-AWSManagedRulesAnonymousIpList",
	            priority: 2,
	            overrideAction: {
	                none: {},
	            },
	            statement: {
	                managedRuleGroupStatement: {
	                    vendorName: "AWS",
	                    name: "AWSManagedRulesAnonymousIpList",
	                    ruleActionOverrides: [
	                        {
	                            name: "AnonymousIPList",
	                            actionToUse: {
	                                count: {},
	                            },
	                        },
	                        {
	                            name: "HostingProviderIPList",
	                            actionToUse: {
	                                count: {},
	                            },
	                        },
	                    ],
	                },
	            },
	            visibilityConfig: {
	                sampledRequestsEnabled: true,
	                cloudwatchMetricsEnabled: true,
	                metricName: "AWS-AWSManagedRulesAnonymousIpList",
	            },
	        },
	    ],
	//    tags: [{
	//        key: "Name",
	//        value: `WAF-${region}`,
	//    }],
	});
	
	//const apiLogGroup = new aws.logs.LogGroup("apiLogGroup", {
	//    kmsKeyId: `arn:aws:kms:${region}:${accountId}:key/${pKMSKEY}`,
	//    logGroupName: pFlowAPILogGroup,
	//    retentionInDays: logRetentionDays,
	//});
	
	const waFv2WebACL2 = new aws.wafv2.WebAcl("waFv2WebACL2", {
	    description: "WAF-Cognito",
	    defaultAction: {
	        allow: {},
	    },
	    visibilityConfig: {
	        sampledRequestsEnabled: true,
	        cloudwatchMetricsEnabled: true,
	        metricName: "WAF-Cognito",
	    },
	    scope: "REGIONAL",
	    rules: [
	        {
	            name: "WAF-for-Brute-force",
	            priority: 0,
	            action: {
	                captcha: {},
	            },
	            statement: {
	                rateBasedStatement: {
	                    limit: 2000,
	                    aggregateKeyType: "IP",
	                },
	            },
	            visibilityConfig: {
	                sampledRequestsEnabled: true,
	                cloudwatchMetricsEnabled: true,
	                metricName: "WAF-for-Brutte-force",
	            },
	        },
	        {
	            name: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
	            priority: 1,
	            overrideAction: {
	                none: {},
	            },
	            statement: {
	                managedRuleGroupStatement: {
	                    vendorName: "AWS",
	                    name: "AWSManagedRulesKnownBadInputsRuleSet",
	                },
	            },
	            visibilityConfig: {
	                sampledRequestsEnabled: true,
	                cloudwatchMetricsEnabled: true,
	                metricName: "AWS-AWSManagedRulesKnownBadInputsRuleSet",
	            },
	        },
	        {
	            name: "AWS-AWSManagedRulesBotControlRuleSet",
	            priority: 2,
	            overrideAction: {
	                none: {},
	            },
	            statement: {
	                managedRuleGroupStatement: {
	                    vendorName: "AWS",
	                    name: "AWSManagedRulesBotControlRuleSet",
	                    managedRuleGroupConfigs: [{
	                        awsManagedRulesBotControlRuleSet: {
	                            inspectionLevel: "COMMON",
	                        },
	                    }],
	                    ruleActionOverrides: [
	                        {
	                            name: "CategoryAdvertising",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryArchiver",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryContentFetcher",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryEmailClient",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryHttpLibrary",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryLinkChecker",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryMiscellaneous",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryMonitoring",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategoryScrapingFramework",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategorySearchEngine",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategorySecurity",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategorySeo",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "CategorySocialMedia",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "SignalAutomatedBrowser",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "SignalKnownBotDataCenter",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                        {
	                            name: "SignalNonBrowserUserAgent",
	                            actionToUse: {
	                                allow: {},
	                            },
	                        },
	                    ],
	                },
	            },
	            visibilityConfig: {
	                sampledRequestsEnabled: true,
	                cloudwatchMetricsEnabled: true,
	                metricName: "AWS-AWSManagedRulesBotControlRuleSet",
	            },
	        },
	    ],
	//    tags: [{
	//        key: "Name",
	//        value: `WAF-Cognito-${region}`,
	//    }],
	});
	
	//const cognitoLogGroup = new aws.logs.LogGroup("cognitoLogGroup", {
	//    kmsKeyId: `arn:aws:kms:${region}:${accountId}:key/${pKMSKEY}`,
	//    logGroupName: pFlowCognitoLogGroup,
	//    retentionInDays: logRetentionDays,
	//});
	
}	
	
// -------- Export out the values we have set --------
export {waFv2WebACL};
export {waFv2WebACL2};
// export {} ;	
