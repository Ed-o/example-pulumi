// AWS Infrastructure creation using IaC - The DNS and CERT parts

import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

// -------- Get config values --------
const config = new pulumi.Config();
// Get configuration values from the Pulumi.{stack}.yaml file
const dnsValidationWait = config.getBoolean("dnsValidationWait");
const infraName = config.require("infraName");
const companyURL = config.require("companyURL");
const worthkeeping = config.getBoolean("worthkeeping");
const deployBaseNetwork = config.getBoolean("deployBaseNetwork");

let domain: string;
let dnsZone: aws.route53.Zone;
let cert: aws.acm.Certificate;

if (deployBaseNetwork) {
	// -------- R53 DNS --------
	
	const domain = `${infraName.toLowerCase()}.${companyURL.toLowerCase()}`;
	
	// Step 1: Create the Route 53 hosted zone
	const dnsZone = new aws.route53.Zone("dnsZone", {
	    name: domain,
	},{ protect: worthkeeping, }); // This keeps this item if the variable is set
	
	// Export the Name Servers so they can be added to the main account
	const subdomainNameServers = dnsZone.nameServers;
	
	
	// -------- ACM --------
	
	// Add a generic DNS cert to match the domain we have for this setup
	const cert = new aws.acm.Certificate("tlsCert", {
	    domainName: `*.${domain}`,
	    subjectAlternativeNames: [domain],
	    validationMethod: "DNS",
	    tags: {
	        "Name": `${infraName} Certificate`,
	    },
	}, { protect: worthkeeping, }); // This keeps this item if the variable is set
	
	/*   - VALIDATION TAKEN OFFLINE TO GET DNS STUFF WORKING
	
	// Now lets see what DNS validation it needs and add on those records
	const validationRecords = cert.domainValidationOptions.apply(options =>
	    options.map(option => {
	        try {
	            return new aws.route53.Record(`certValidation-${option.domainName}`, {
	                name: option.resourceRecordName,
	                zoneId: dnsZone.zoneId,
	                type: option.resourceRecordType,
	                records: [option.resourceRecordValue],
	                ttl: 300,
	            });
	        } catch (error) {
	            const errorMessage = (error as Error).message; // Assert the error type
	            console.warn(`Skipping creation of DNS record ${option.resourceRecordName}: ${errorMessage}`);
	            return undefined;
	        }
	    })
	);
	
	// Wait for validation to complete
	if (dnsValidationWait) {
	const certValidation = new aws.acm.CertificateValidation("certValidation", {
	        certificateArn: cert.arn,
	        validationRecordFqdns: validationRecords.apply(records => {
	            // Filter out undefined records
	            const definedRecords = records.filter((record): record is aws.route53.Record => record !== undefined);
	            return definedRecords.map(record => record.fqdn); // Access fqdn safely
	        }),
	    });
	};
	
	*/

}	
// -------- Export out the values we have set --------
export {domain};
export {dnsZone};
export {cert};
// export {};

