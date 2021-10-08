# Orthanc deployment with S3 compatibility using AWS CDK

This project aims to help you provision a ready-to-use [Orthanc](https://www.orthanc-server.com/) cluster on Amazon ECS Fargate, with support for the official S3 plugin. The infrastructure code is using the [AWS Cloud Development Kit(AWS CDK)](https://aws.amazon.com/cdk/).

Orthanc is an open-source DICOM server, which is designed to improve the DICOM flows in hospitals and to support research about the automated analysis of medical images. Orthanc lets its users focus on the content of the DICOM files, hiding the complexity of the DICOM format and of the DICOM protocol.

## Solution Overview
![](images/orthanc-solution.png)

## Features

- [x] "One-click" serverless deployment
- [x] Infrastructure is split into 3 interdependent stacks (Networking, Storage, ECS Fargate Cluster)
- [x] Configurable DICOM image storage (EFS or S3)
- [x] DICOM indexes are stored in RDS Postgres11
- [x] Configurable S3 Object Lifecycle policies to support archival scenarios
- [x] Secure HTTPS connection using Cloudfront
- [x] Automatic build of the official S3 plugin using a multi-stage Docker image file


## Project structure
    
    ├── infrastructure                      # Infrastructure code via CDK(Typescript).
    │   ├── bin                             # CDK App - Deploys the stacks  
    │   ├── lib                             #
    |   |   ├── local-image-official-s3     # Orthanc Multi-stage Dockerfile 
    |   |   ├── network-stack.ts            # Basic VPC config & network stack
    |   |   ├── orthanc-stack.ts            # ECS Fargate Service & CDN stack
    |   |   ├── storage-stack.ts            # Storage (EFS/S3) & DB stack
    └── ...

The `cdk.json` file inside `infrastructure` directory tells the CDK Toolkit how to execute your app.

## Prerequisites

- Make sure you have [AWS CDK](https://docs.aws.amazon.com/cdk/latest/guide/getting_started.html) installed and configured with an aws account you want to use.
- Ensure you have [docker](https://docs.docker.com/get-docker/) installed and is up and running locally.

## Getting started

### Configuration
The Orthanc CDK project comes with a set of pre-defined parameters, which you can view/change in `/infrastructure/bin/cdk.ts`.

```Javascript
// ********************************
// Orthanc parameters
// ********************************   
const ENABLE_DICOM_S3_STORAGE = true;     // If true, use an S3 bucket as the DICOM image store
const ORTHANC_USERNAME = "admin";         // Default Orthanc admin username
const ORTHANC_PASSWORD = "_Admin1";       // Default Orthanc admin password
```
> `You must change the default admin credentials for production environments!`

### Deployment

- Change directory to where infrastructure code lives.
```bash
    cd infrastructure
```

- Restore NPM packages for the project
```bash
    npm install
```

- Bootstrap your AWS account as it's required for the automated Docker image build and deployment
```bash
    cdk bootstrap aws://{ACCOUNT_ID}/{REGION}
```

- Synthesize the cdk stack to emits the synthesized CloudFormation template. Set up will make sure to build and package 
  the lambda functions residing in [software](/software) directory.
```bash
    cdk synth
```

- Deploy the CDK application
```bash
    cdk deploy --all
```


## Useful commands

 * `cdk ls`          list all stacks in the app
 * `cdk synth`       emits the synthesized CloudFormation template
 * `cdk deploy`      deploy this stack to your default AWS account/region
 * `cdk diff`        compare deployed stack with current state
 * `cdk docs`        open CDK documentation

Enjoy!

## Security

See [CONTRIBUTING](CONTRIBUTING.md#security-issue-notifications) for more information.

## License

This library is licensed under the MIT-0 License. See the LICENSE file.
