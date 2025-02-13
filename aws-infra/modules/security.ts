// AWS Infrastructure creation using IaC - The Security parts

import * as aws from "@pulumi/aws";
import * as network from "./network" ;


// -------- KMS Key for Encryption  --------
const kmsKey = new aws.kms.Key("kms-key", {
    description: "KMS key for data encryption",
    deletionWindowInDays: 30,
    enableKeyRotation: true,
});

// -------- Security Groups --------
// add here as needed....

// -------- Export out the values we have set --------
export {kmsKey};
