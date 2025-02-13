// AWS Infrastructure creation using IaC - The Network parts

import * as aws from "@pulumi/aws";
import * as awsx from "@pulumi/awsx";
import * as pulumi from "@pulumi/pulumi";

// Set up some variables to hold the network setup as it is created :
let vpc: aws.ec2.Vpc;
// let publicSubnets: aws.ec2.Subnet[];
// let privateSubnets: aws.ec2.Subnet[];
let publicSubnets: pulumi.Output<string>[] = [];
let privateSubnets: pulumi.Output<string>[] = [];

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const highAvailability = config.getBoolean("highAvailability");
const networkSetup = config.require("networkSetup");

if (networkSetup === "existing") {
	const existingVpcId = config.require("existingVpc");
	const vpc = aws.ec2.Vpc.get("vpc", existingVpcId);
	// Fetch existing public subnets
	const existingPublicSubnetIds = config.requireObject<string[]>("existingPublic");
	publicSubnets = [
	    ...publicSubnets,
	    ...existingPublicSubnetIds.map((subnetId, index) =>
	        aws.ec2.Subnet.get(`existingPublicSubnet${index}`, subnetId).id
	    ),];

	// Fetch existing private subnets
	const existingPrivateSubnetIds = config.requireObject<string[]>("existingPrivate");
	privateSubnets = [
	    ...privateSubnets,
	    ...existingPrivateSubnetIds.map((subnetId, index) =>
	        aws.ec2.Subnet.get(`existingPrivateSubnet${index}`, subnetId).id
	    ),
	];
} else { // if (networkSetup === "new") {
	const netCidrBlock = config.require("netCidrBlock");
	const netPubl1 = config.require("netPubl1");
	const netPubl2 = config.require("netPubl2");
	const netPriv1 = config.require("netPriv1");
	const netPriv2 = config.require("netPriv2");
	const netZone1 = config.require("netZone1");
	const netZone2 = config.require("netZone2");
	
	// -------- Now we start creating the infrastructure -------- 
	// ----------------------------------------------------------
	
	
	
	// -------- VPC --------
	const vpc = new aws.ec2.Vpc("vpc", {
	    cidrBlock: netCidrBlock,
	    enableDnsSupport: true,
	    enableDnsHostnames: true,
	    tags: { 
		Name: "vpc", 
		use: "infrastructure", 
	    },
	});
	
	// -------- Internet Gateway for the VPC --------
	const igw = new aws.ec2.InternetGateway("vpc-igw", {
	    vpcId: vpc.id,
	    tags: {
	        Name: "internet-igw",
	        use: "infrastructure",
	    },
	});
	
	// -------- Route Table and Routes for Public Subnet --------
	const routeTable = new aws.ec2.RouteTable("public-route-table", {
	    vpcId: vpc.id,
	    routes: [
	        {
	            cidrBlock: "0.0.0.0/0",
	            gatewayId: igw.id,
	        },
	    ],
	    tags: { Name: "public-route-table" },
	});
	
	// -------- Subnets --------
	const publicSubnet1 = new aws.ec2.Subnet("public-subnet-1", {
	    vpcId: vpc.id,
	    cidrBlock: netPubl1,
	    mapPublicIpOnLaunch: true,
	    availabilityZone: netZone1,
	    tags: {
	        Name: `public-${netZone1}`,
	    },
	});
	// publicSubnets = [publicSubnet1.id];
	publicSubnets.push(publicSubnet1.id);
	
	const privateSubnet1 = new aws.ec2.Subnet("private-subnet-1", {
	    vpcId: vpc.id,
	    cidrBlock: netPriv1,
	    availabilityZone: netZone1,
	    tags: {
	        Name: `private-${netZone1}`,
	    },
	});
	privateSubnets.push(privateSubnet1.id);
	
	const eip1 = new aws.ec2.Eip("eip1", {});
	
	const natGateway1 = new aws.ec2.NatGateway("nat-gateway-1", {
	    allocationId: eip1.id,
	    subnetId: publicSubnet1.id,
	    tags: {
	        Name: "natgw-1",
	        use: "infrastructure",
	    },
	});
	
	const rtAssocA = new aws.ec2.RouteTableAssociation("public-rt-assoc-1", {
	    subnetId: publicSubnet1.id,
	    routeTableId: routeTable.id,
	});
	
	// -------- Route Table and Routes for Private Subnet --------
	const privateRouteTable1 = new aws.ec2.RouteTable("private-route-table-1", {
	    vpcId: vpc.id,
	    routes: [
	        {
	            cidrBlock: "0.0.0.0/0",
	            gatewayId: natGateway1.id,
	        },
	    ],
	    tags: { Name: "private-route-table-1" },
	});
	
	// Associate the Private Route Table with the Private Subnet
	new aws.ec2.RouteTableAssociation("private-route-association-1", {
	    subnetId: privateSubnet1.id,
	    routeTableId: privateRouteTable1.id,
	});
	
	
	// If we have set High Availability - then we add another subNet on
	if (highAvailability) {
	    const publicSubnet2 = new aws.ec2.Subnet("public-subnet-2", {
	        vpcId: vpc.id,
	        cidrBlock: netPubl2,
	        mapPublicIpOnLaunch: true,
	        availabilityZone: netZone2,
	        tags: {
	            Name: `public-${netZone2}`,
	        },
	    });
	    // Add publicSubnet2 to the list of public subnets
	    publicSubnets.push(publicSubnet2.id);

	    const privateSubnet2 = new aws.ec2.Subnet("private-subnet-2", {
	        vpcId: vpc.id,
	        cidrBlock: netPriv2,
	        availabilityZone: netZone2,
	        tags: {
	            Name: `private-${netZone2}`,
	        },
	    });
	    // Add privateSubnet2 to the list of private subnets
	    privateSubnets.push(privateSubnet2.id);
	
	    const eip2 = new aws.ec2.Eip("eip2", {});
	
	    const natGateway2 = new aws.ec2.NatGateway("nat-gateway-2", {
	        allocationId: eip2.id,
	        subnetId: publicSubnet2.id,
	        tags: {
	            Name: "natgw2",
	            use: "infrastructure",
	        },
	    });
	
	    const rtAssocB = new aws.ec2.RouteTableAssociation("public-rt-assoc-2", {
	        subnetId: publicSubnet2.id,
	        routeTableId: routeTable.id,
	    });
	
	    const privateRouteTable2 = new aws.ec2.RouteTable("private-route-table-2", {
	        vpcId: vpc.id,
	        routes: [
	            {
	                cidrBlock: "0.0.0.0/0",
	                gatewayId: natGateway2.id,
	            },
	        ],
	        tags: { Name: "private-route-table-2" },
	    });
	
	    new aws.ec2.RouteTableAssociation("private-route-association-2", {
	        subnetId: privateSubnet2.id,
	        routeTableId: privateRouteTable2.id,
	    });
	
	}
	
	// Security Group for NAT Gateway
	const natSecurityGroup = new aws.ec2.SecurityGroup("nat-security-group", {
	    vpcId: vpc.id,
	    description: "Allow outbound internet access for NAT Gateway",
	    ingress: [],
	    egress: [
	        {
	            protocol: "-1", // All traffic
	            fromPort: 0,
	            toPort: 0,
	            cidrBlocks: ["0.0.0.0/0"],
	        },
	    ],
	});
	
}

// -------- Export out the values we have set --------
export { vpc };
export { publicSubnets } ;
export { privateSubnets } ;

