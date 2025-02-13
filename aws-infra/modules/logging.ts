// AWS Infrastructure creation using IaC - The Logging and Monitoring parts
	
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as network from "./network" ;
import * as dns from "./dns" ;
import * as secrets from "./secrets" ;

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const monDesiredCount = config.requireNumber("monDesiredCount");
const accountId = config.require("account");
const region = config.require("region");
const infraName = config.require("infraName");
const logGroups = config.requireObject<string[]>("logGroups");
const deployLogging = config.getBoolean("deployLogging");	

let nginxService: aws.ecs.Service;

if (deployLogging) {
	// -------- Logging and Monitoring --------
	
	// ECS Cluster
	const cluster = new aws.ecs.Cluster(`logging-cluster-${infraName}`, {
	    settings: [{
	        name: "containerInsights",
	        value: "enabled",
	    }],
	});
	
	// Security Group for ECS Services
	const ecsSecurityGroup = new aws.ec2.SecurityGroup("ecs-security-group", {
	    vpcId: network.vpc.id,
	    ingress: [
	        { protocol: "tcp", fromPort: 3100, toPort: 3100, cidrBlocks: ["10.0.0.0/8"], description: "Loki" },
	        { protocol: "tcp", fromPort: 9095, toPort: 9095, cidrBlocks: ["10.0.0.0/8"], description: "Loki grpc port" },
	        { protocol: "tcp", fromPort: 3000, toPort: 3000, cidrBlocks: ["10.0.0.0/8"], description: "Grafana" },
	        { protocol: "tcp", fromPort: 9090, toPort: 9090, cidrBlocks: ["10.0.0.0/8"], description: "Prometheus" },
	        { protocol: "tcp", fromPort: 80,   toPort: 80,   cidrBlocks: ["10.0.0.0/8"], description: "Web access internal" },
	        { protocol: "tcp", fromPort: 443,  toPort: 443,  cidrBlocks: ["10.0.0.0/8"], description: "Web access internal" },
	    ],
	    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
	});
	
	// Security Group for ECS load balancer
	const monitorSecurityGroup = new aws.ec2.SecurityGroup("monitor-security-group", {
	    vpcId: network.vpc.id,
	    ingress: [
	        { protocol: "tcp", fromPort: 80,   toPort: 80,   cidrBlocks: ["99.99.99.99/32"], description: "Web access VPN" },
	        { protocol: "tcp", fromPort: 443,  toPort: 443,  cidrBlocks: ["99.99.99.99/32"], description: "Web access VPN" },
	        { protocol: "tcp", fromPort: 80,   toPort: 80,   cidrBlocks: ["55.55.55.55/32"], description: "Web access Office" },
	        { protocol: "tcp", fromPort: 443,  toPort: 443,  cidrBlocks: ["55.55.55.55/32"], description: "Web access Office" },
	    ],
	    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
	})
	
	// Security Group for EFS volume
	const efsSecurityGroup = new aws.ec2.SecurityGroup("efs-security-group", {
	    vpcId: network.vpc.id,
	    ingress: [
	        { protocol: "tcp", fromPort: 2049,   toPort: 2049,   cidrBlocks: ["10.0.0.0/8"], description: "efs volume access" },
	    ],
	    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
	});
	
	// We need a persistant volume for logs and indexes :
	
	// Create an EFS file system
	const efsFileSystem = new aws.efs.FileSystem("loki-efs", {
	    tags: {
	        Name: "loki-efs",
	    },
	});
	
	// Create an EFS Mount Target in each subnet
	const efsMountTargets = [
	    new aws.efs.MountTarget("loki-efs-mount-a", {
	        fileSystemId: efsFileSystem.id,
	        subnetId: network.privateSubnets[0],
	        securityGroups: [efsSecurityGroup.id],
	    }),
	    new aws.efs.MountTarget("loki-efs-mount-b", {
	        fileSystemId: efsFileSystem.id,
	        subnetId: network.privateSubnets[1],
	        securityGroups: [efsSecurityGroup.id],
	    }),
	];
	
	// Add access points to the EFS so it can be mounted in grafana
	const grafanaAccessPoint = new aws.efs.AccessPoint("grafana-access-point", {
	    fileSystemId: efsFileSystem.id,
	    posixUser: {
	        uid: 1000,
	        gid: 1000,
	    },
	    rootDirectory: {
	        path: "/grafana-data",
	        creationInfo: {
	            ownerUid: 1000,
	            ownerGid: 1000,
	            permissions: "0755",
	        },
	    },
	});
	
	// Add access points to the EFS so it can be mounted in loki
	const lokiAccessPoint = new aws.efs.AccessPoint("loki-access-point", {
	    fileSystemId: efsFileSystem.id,
	    posixUser: {
	        uid: 1000,
	        gid: 1000,
	    },
	    rootDirectory: {
	        path: "/loki-data",
	        creationInfo: {
	            ownerUid: 1000,
	            ownerGid: 1000,
	            permissions: "0755",
	        },
	    },
	});
	
	// IAM Role for ECS Task Execution
	const taskRole = new aws.iam.Role("ecsTaskExecutionRole", {
	    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "ecs-tasks.amazonaws.com" }),
	});
	
	new aws.iam.RolePolicyAttachment("ecsTaskExecutionRole-policy", {
	    role: taskRole.name,
	    policyArn: aws.iam.ManagedPolicy.AmazonECSTaskExecutionRolePolicy,
	});
	
	// Attach the AmazonSSMManagedInstanceCore Policy for ECS Exec
	new aws.iam.RolePolicyAttachment("ecsTaskExecutionRole-ssm-policy", {
	    role: taskRole.name,
	    policyArn: aws.iam.ManagedPolicy.AmazonSSMManagedInstanceCore,
	});
	
	// Additional inline policy for Execute Command
	new aws.iam.RolePolicy("ecsTaskExecutionRole-exec-policy", {
	    role: taskRole.name,
	    policy: taskRolePolicy(),
	});
	
	// Inline policy function
	function taskRolePolicy(): string {
	    return JSON.stringify({
	        "Version": "2012-10-17",
	        "Statement": [
	                {
	                        "Action": [
	                                "ssmmessages:CreateControlChannel",
	                                "ssmmessages:CreateDataChannel",
	                                "ssmmessages:OpenControlChannel",
	                                "ssmmessages:OpenDataChannel",
	                                "logs:CreateLogGroup"
	                        ],
	                        "Effect": "Allow",
	                        "Resource": "*"
	                },
	                {
	                        "Action": [
	                                "elasticfilesystem:ClientMount",
	                                "elasticfilesystem:ClientWrite"
	                        ],
	                        "Effect": "Allow",
	                        "Resource": "*"
	                },
	                {
	                        "Action": [
	                                "s3:PutObject",
	                                "s3:GetObject",
	                                "s3:ListBucket",
	                                "s3:DeleteObject"
	                        ],
	                        "Effect": "Allow",
	                        "Resource": "*"
	                },
                        {
                                "Action": [
                                        "ecr:GetAuthorizationToken",
                                        "ecr:GetDownloadUrlForLayer",
                                        "ecr:BatchGetImage",
                                        "ecr:BatchCheckLayerAvailability"
                                ],
                                "Effect": "Allow",
                                "Resource": "arn:aws:ecr:eu-west-1:781659225751:repository/*"
                        },
                        {
                                "Effect": "Allow",
                                "Action": [
                                        "cloudwatch:ListMetrics",
                                        "cloudwatch:GetMetricData",
                                        "cloudwatch:GetMetricStatistics",
                                        "ec2:DescribeTags",
                                        "ec2:DescribeInstances",
                                        "logs:DescribeLogGroups"
                                ],
                                "Resource": "*"
                        }
	        ]
	    });
	}
	
	// Create a Private DNS Namespace for Service Discovery
	const privateNamespace = new aws.servicediscovery.PrivateDnsNamespace("ecs-private-namespace", {
	    name: "local",
	    vpc: network.vpc.id,
	});
	
	
	// Now the other search services in ECS ...

	//const publicSubnetIds = network.publicSubnets.map(subnet => subnet.id);
	//const privateSubnetIds = network.privateSubnets.map(subnet => subnet.id);

	// We create a load balancer to get access ot these ECS services
	const loadBalancer = new aws.lb.LoadBalancer("monitor-lb", {
	    internal: false,
	    securityGroups: [monitorSecurityGroup.id],
	    subnets: network.publicSubnets,
	});
	
	const targetGroupNginx80 = new aws.lb.TargetGroup("nginx-80", {
	    port: 80,
	    protocol: "HTTP",
	    vpcId: network.vpc.id,
	    targetType: "ip",
	    healthCheck: {
	        path: "/test",
	        port: "80",
	        interval: 30,
	        timeout: 5,
	        healthyThreshold: 2,
	        unhealthyThreshold: 2,
	    },
	});
	
	const targetGroupNginx443 = new aws.lb.TargetGroup("nginx-443", {
	    port: 443,
	    protocol: "HTTPS",
	    vpcId: network.vpc.id,
	    targetType: "ip",
	    healthCheck: {
	        path: "/",
	        port: "443",
	        interval: 30,
	        timeout: 5,
	        healthyThreshold: 2,
	        unhealthyThreshold: 2,
	    },
	});
	
	const targetGroupLoki = new aws.lb.TargetGroup("loki-80", {
	    port: 3100,
	    protocol: "HTTP",
	    vpcId: network.vpc.id,
	    targetType: "ip",
	    healthCheck: {
	        path: "/ready",
	        port: "3100",
	        interval: 30,
	        timeout: 5,
	        healthyThreshold: 2,
	        unhealthyThreshold: 2,
	    },
	});
	
	const targetGroupGrafana = new aws.lb.TargetGroup("grafana-80", {
	    port: 3000,
	    protocol: "HTTP",
	    vpcId: network.vpc.id,
	    targetType: "ip",
	    healthCheck: {
	        path: "/api/health",
	        port: "3000",
	        interval: 30,
	        timeout: 5,
	        healthyThreshold: 2,
	        unhealthyThreshold: 2,
	    },
	});
	
	const listener80 = new aws.lb.Listener("nginx-listener-80", {
	    loadBalancerArn: loadBalancer.arn,
	    port: 80,
	    defaultActions: [{
	        type: "forward",
	        targetGroupArn: targetGroupNginx80.arn,
	    }],
	});
	
	const listener443 = new aws.lb.Listener("nginx-listener-443", {
	    loadBalancerArn: loadBalancer.arn,
	    port: 443,
	    protocol: "HTTPS",
	    sslPolicy: "ELBSecurityPolicy-TLS13-1-2-2021-06",
	    certificateArn: dns.cert.arn,
	    defaultActions: [{
	        type: "forward",
	        targetGroupArn: targetGroupNginx80.arn,
	    }],
	});
	
	const lbRuleLoki80 = new aws.lb.ListenerRule("lbRule-loki-80", {
	    listenerArn: listener443.arn,
	    conditions: [{ hostHeader: { values: [`loki.${dns.domain}`], }, }, ],
	    actions: [{ type: "forward", targetGroupArn: targetGroupLoki.arn, }, ],
	    priority: 100,
	});
	
	const lbRuleGrafana80 = new aws.lb.ListenerRule("lbRule-grafana-80", {
	    listenerArn: listener443.arn,
	    conditions: [{ hostHeader: { values: [`grafana.${dns.domain}`], }, }, ],
	    actions: [{ type: "forward", targetGroupArn: targetGroupGrafana.arn, }, ],
	    priority: 110,
	});
	
	const lbAliasRecord = new aws.route53.Record("monitororlb-alias-record", {
	    zoneId: dns.dnsZone.id,
	    name: "mon",
	    type: "A",
	    aliases: [{
	        name: loadBalancer.dnsName,
	        zoneId: loadBalancer.zoneId,
	        evaluateTargetHealth: true,
	    }],
	});
	
	const lbAliasRecordLoki = new aws.route53.Record("monitororlb-alias-record-loki", {
	    zoneId: dns.dnsZone.id,
	    name: "loki",
	    type: "CNAME",
	    ttl: 300,
	    records: [`mon.${dns.domain}.`],
	});
	
	const lbAliasRecordGrafana = new aws.route53.Record("monitororlb-alias-record-grafana", {
	    zoneId: dns.dnsZone.id,
	    name: "grafana",
	    type: "CNAME",
	    ttl: 300,
	    records: [`mon.${dns.domain}.`],
	});
	
	// Create S3 bucket for loki
	const lokiBucket = new aws.s3.Bucket(`${infraName}-loki-logs`, {
	    bucket: `${infraName}-loki-logs`,
	    acl: "private",
	});
	
	const lokiBucketName = lokiBucket.bucket.apply(bucketName => bucketName);
	
	// Task Definition and Service for Loki
	const lokiTaskDefinition = new aws.ecs.TaskDefinition("loki-task", {
	    family: "loki",
	    cpu: "256",
	    memory: "512",
	    networkMode: "awsvpc",
	    requiresCompatibilities: ["FARGATE"],
	    taskRoleArn: taskRole.arn,
	    executionRoleArn: taskRole.arn,
	    volumes: [
	        {
	            name: "efs-volume",
	            efsVolumeConfiguration: {
	                fileSystemId: efsFileSystem.id,
	                transitEncryption: "ENABLED",
	                authorizationConfig: {
	                    accessPointId: lokiAccessPoint.id,
	                },
	            },
	        },
	    ],
	    containerDefinitions: JSON.stringify([
	        {
	            name: "loki",
	            image: `${accountId}.dkr.ecr.eu-west-1.amazonaws.com/ecs-loki:latest`,
	            enableExecuteCommand: true,
	            portMappings: [{ containerPort: 3100, hostPort: 3100 }],
	            environment: [
	                { name: "LOKI_BASE_URL", value: `mon.${dns.domain}/loki` },
                        { name: "LOKI_BUCKET_NAME", value: `${infraName}-loki-logs` },
                        { name: "LOKI_REGION", value: `${region}` },
                    ],
	            mountPoints: [
	                {
	                    sourceVolume: "efs-volume",
	                    containerPath: "/data",
	                    readOnly: false,
	                },
	            ],
	            logConfiguration: {
	                logDriver: "awslogs",
	                options: {
	                    "awslogs-group": `/ecs/${infraName}/loki`,
	                    "awslogs-region": region,
	                    "awslogs-stream-prefix": "loki",
	                },
	            },
	        },
	    ]),
	});
	
	// IAM Role for the Lambda function for loki scraper
	const lokiLambdaRole = new aws.iam.Role("loki-lambda-role", {
	    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: "lambda.amazonaws.com" }),
	});
	
	new aws.iam.RolePolicyAttachment("loki-lambda-execrole-policy", {
	    role: lokiLambdaRole.name,
	    policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
	});
	
	new aws.iam.RolePolicyAttachment("loki-lambda-netrole-policy", {
	    role: lokiLambdaRole.name,
	    policyArn: aws.iam.ManagedPolicy.AWSLambdaVPCAccessExecutionRole,
	});

        // Additional inline policy for Lambda Execute Command
        new aws.iam.RolePolicy("lambdaTaskExecutionRole-exec-policy", {
            role: lokiLambdaRole.name,
            policy: lambdaTaskRolePolicy(),
        });

        // Inline policy function
        function lambdaTaskRolePolicy(): string {
            return JSON.stringify({
                "Version": "2012-10-17",
                "Statement": [
                        {
                                "Action": [
                                        "ecr:GetAuthorizationToken",
                                        "ecr:GetDownloadUrlForLayer",
                                        "ecr:BatchGetImage",
                                        "ecr:BatchCheckLayerAvailability"
                                ],
                                "Effect": "Allow",
                                "Resource": "*"
                        }
                ]
            });
        }	
	// Create a security group for the loki-scraper Lambda function
	const lokilambdaSecurityGroup = new aws.ec2.SecurityGroup("loki-scraper-security-group", {
	    vpcId: network.vpc.id,
	    description: "Security group for Loki SCraper Lambda",
	    ingress: [], // No ingress rules
	    egress: [
	        {
	            protocol: "-1", // All protocols
	            fromPort: 0,
	            toPort: 0,
	            cidrBlocks: ["10.0.0.0/8"],
	        },
	    ],
	});
	
	// Lambda function using the ECR image
	const lambdaFunction = new aws.lambda.Function("cloudwatch-to-loki", {
	    packageType: "Image",
	    role: lokiLambdaRole.arn,
	    imageUri: `${accountId}.dkr.ecr.eu-west-1.amazonaws.com/lambda-promtail:latest`,
	    vpcConfig: {
	        subnetIds: network.privateSubnets,
	        securityGroupIds: [lokilambdaSecurityGroup.id],
	    },
	    environment: {
	        variables: {
	            WRITE_ADDRESS: "http://loki.local:3100/loki/api/v1/push",
	        },
	    },
	});
	
	// local discovery group to add ECS pods to local R53 dns resolver
	const lokiServiceDiscovery = new aws.servicediscovery.Service("loki-service-discovery", {
	    name: "loki",
	    dnsConfig: {
	        namespaceId: privateNamespace.id,
	        dnsRecords: [ {type: "A",  ttl: 60,},],
	        routingPolicy: "MULTIVALUE",
	    },
	    healthCheckCustomConfig: {failureThreshold: 1,},
	});
	
	const lokiService = new aws.ecs.Service("loki-service", {
	    cluster: cluster.arn,
	    taskDefinition: lokiTaskDefinition.arn,
	    desiredCount: monDesiredCount,
	    launchType: "FARGATE",
	    networkConfiguration: {
	        subnets: network.privateSubnets,
	        securityGroups: [ecsSecurityGroup.id],
	        assignPublicIp: false,
	    },
	    serviceRegistries: {
	        registryArn: lokiServiceDiscovery.arn,
	    },
	    loadBalancers: [{
	        containerName: "loki",
	        containerPort: 3100,
	        targetGroupArn: targetGroupLoki.arn,
	    }],
	});
	
	// Log group
	const logGroupLoki = new aws.cloudwatch.LogGroup("loki-log-group", {
	    name: `/ecs/${infraName}/loki`,
	    retentionInDays: 30,
	});
	
	// Lets work out the password from the secret store 
	const grafanaPassword = secrets.grafanaPassword.apply(password => {
            return password;
        });

	// Task Def for grafana
	const grafanaTaskDefinition = new aws.ecs.TaskDefinition("grafana-task", {
	    family: "grafana-task",
	    taskRoleArn: taskRole.arn,
	    executionRoleArn: taskRole.arn,
	    requiresCompatibilities: ["FARGATE"],
	    cpu: "512", // Adjust as needed
	    memory: "1024", // Adjust as needed
	    networkMode: "awsvpc",
	    volumes: [
	        {
	            name: "efs-volume",
	            efsVolumeConfiguration: {
	                fileSystemId: efsFileSystem.id,
	                transitEncryption: "ENABLED",
	                authorizationConfig: {
	                    accessPointId: grafanaAccessPoint.id,
	                },
	            },
	        },
	    ],
	    containerDefinitions: JSON.stringify([
	        {
	            name: "grafana",
	            image: `${accountId}.dkr.ecr.eu-west-1.amazonaws.com/ecs-grafana:latest`,
	            enableExecuteCommand: true,
	            portMappings: [
	                {
	                    containerPort: 3000,
	                    hostPort: 3000,
	                },
	            ],
	            environment: [
	                { name: "GF_SECURITY_ADMIN_USER", value: "admin" },
	                { name: "GF_SECURITY_ADMIN_PASSWORD", value: `${grafanaPassword}` },
	                { name: "GF_SERVER_DOMAIN", value: `mon.${dns.domain}` },  // Taken from the projects url domain and 'mon.' added to the start
			{ name: "GF_REGION", value: `${region}` },
	            ],
	            mountPoints: [
	                {
	                    sourceVolume: "efs-volume",
	                    containerPath: "/var/lib/grafana",
	                    readOnly: false,
	                },
	            ],
	            logConfiguration: {
	                logDriver: "awslogs",
	                options: {
	                    "awslogs-group": `/ecs/${infraName}/grafana`,
	                    "awslogs-region": region,
	                    "awslogs-stream-prefix": "grafana",
	                },
	            },
	        },
	    ]),
	});
	
	// local discovery group to add ECS pods to local R53 dns resolver
	const grafanaServiceDiscovery = new aws.servicediscovery.Service("grafana-service-discovery", {
	    name: "grafana",
	    dnsConfig: {
	        namespaceId: privateNamespace.id,
	        dnsRecords: [ {type: "A",  ttl: 60,},],
	        routingPolicy: "MULTIVALUE",
	    },
	    healthCheckCustomConfig: {failureThreshold: 1,},
	});
	
	// Service
	const grafanaService = new aws.ecs.Service("grafana-service", {
	    cluster: cluster.arn,
	    taskDefinition: grafanaTaskDefinition.arn,
	    desiredCount: 1,
	    launchType: "FARGATE",
	    networkConfiguration: {
	        assignPublicIp: false,
	        subnets: network.privateSubnets,
	        securityGroups: [ecsSecurityGroup.id],
	    },
	    serviceRegistries: {
	        registryArn: grafanaServiceDiscovery.arn,
	    },
	    loadBalancers: [{
	        containerName: "grafana",
	        containerPort: 3000,
	        targetGroupArn: targetGroupGrafana.arn,
	    }],
	});
	
	// Log group
	const logGroupGrafana = new aws.cloudwatch.LogGroup("grafana-log-group", {
	    name: `/ecs/${infraName}/grafana`,
	    retentionInDays: 30,
	});
	
	// Task Definition for NGINX
	const nginxTaskDefinition = new aws.ecs.TaskDefinition("nginx-task", {
	    family: "nginx",
	    requiresCompatibilities: ["FARGATE"],
	    cpu: "256",
	    memory: "512",
	    taskRoleArn: taskRole.arn,
	    executionRoleArn: taskRole.arn,
	    networkMode: "awsvpc",
	    containerDefinitions: JSON.stringify([
	        {
	            name: "nginx",
	            image: `${accountId}.dkr.ecr.eu-west-1.amazonaws.com/ecs-nginx:latest`,
	            enableExecuteCommand: true,
	            portMappings: [
	                { containerPort: 80 },
	                { containerPort: 443 },
	            ],
	            logConfiguration: {
	                logDriver: "awslogs",
	                options: {
	                    "awslogs-region": region ,
	                    "awslogs-group": `/ecs/${infraName}/nginx`,
	                    "awslogs-stream-prefix": "nginx",
	                },
	            },
	        },
	    ]),
	});
	
	// Log group
	const logGroupNginx = new aws.cloudwatch.LogGroup("nginx-log-group", {
	    name: `/ecs/${infraName}/nginx`,
	    retentionInDays: 30,
	});
	
	// local discovery group to add ECS pods to local R53 dns resolver
	const nginxServiceDiscovery = new aws.servicediscovery.Service("nginx-service-discovery", {
	    name: "nginx",
	    dnsConfig: {
	        namespaceId: privateNamespace.id,
	        dnsRecords: [ {type: "A",  ttl: 60,},],
	        routingPolicy: "MULTIVALUE",
	    },
	    healthCheckCustomConfig: {failureThreshold: 1,},
	});
	
	const nginxService = new aws.ecs.Service("nginx-service", {
	    cluster: cluster.arn,
	    taskDefinition: nginxTaskDefinition.arn,
	    desiredCount: 1,
	    launchType: "FARGATE",
	    networkConfiguration: {
	        assignPublicIp: false,
	        subnets: network.privateSubnets,
	        securityGroups: [ecsSecurityGroup.id],
	    },
	    serviceRegistries: {
	        registryArn: nginxServiceDiscovery.arn,
	    },
	    loadBalancers: [{
	        containerName: "nginx",
	        containerPort: 80,
	        targetGroupArn: targetGroupNginx80.arn,
	    }],
	});
	
// Helper function to sanitize names
function sanitizeName(name: string): string {
    return name.replace(/[^a-zA-Z0-9-_]/g, "-");
}

	// Loop through each log group name from the config yaml and 
	// create the subscription filter and permission to allow it to send to the lambda and then loki
	logGroups.forEach((logGroupName) => {
	    const sanitizedName = sanitizeName(logGroupName);
	
	    // Create permission for the Lambda function
	    new aws.lambda.Permission(`cloudwatch-loki-${sanitizedName}`, {
	        action: "lambda:InvokeFunction",
	        function: lambdaFunction.name,
	        principal: "logs.amazonaws.com",
	        sourceArn: pulumi.interpolate`arn:aws:logs:${region}:${accountId}:log-group:${logGroupName}:*`,
	    });
	
	    // Create the subscription filter
	    new aws.cloudwatch.LogSubscriptionFilter(`log-to-loki-${sanitizedName}`, {
	        logGroup: logGroupName,
	        destinationArn: lambdaFunction.arn,
	        filterPattern: "", // Match all logs
	    });
	});
	
}

// -------- Export out the values we have set --------
export {nginxService};
// export {};	
