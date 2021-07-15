/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';

const xml2js = require('xml2js');
const fs = require('fs');
const parser = new xml2js.Parser();
var unzipper = require("unzip-stream");
const os = require('os');
var path = require('path');
const zipper = require('zip-a-folder');
// var archiver = require("archiver");

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('reportTypeSorter', 'order');

const objectDescribe = {};
let conn;

/////TODO: CACHED CALLs
//https://jsforce.github.io/document/

export default class Org extends SfdxCommand {
  public static description = messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx hello:org --targetusername myOrg@example.com --targetdevhubusername devhub@org.com
Hello world! This is org: MyOrg and I will be around until Tue Mar 20 2018!
My hub org id is: 00Dxx000000001234
  `,
    `$ sfdx hello:org --name myname --targetusername myOrg@example.com
Hello myname! This is org: MyOrg and I will be around until Tue Mar 20 2018!
  `,
  ];

  // public static args = [{ name: 'file' }];

  protected static flagsConfig = {
    // flag with a value (-n, --name=VALUE)
    reporttypename: flags.string({char: 'r', description: messages.getMessage('nameFlagDescription'), required: true}),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  public async run(): Promise<AnyJson> {
    const tempFolder = path.join(os.tmpdir(), 'reportTypeSorter');
    if (fs.existsSync(tempFolder)) {
      fs.rmdirSync(tempFolder, { recursive: true });
    }

    // this.org is guaranteed because requiresUsername=true, as opposed to supportsUsername
    // await this.org.refreshAuth();
    conn = this.org.getConnection();

    // Retrieve Report Type
    const apiVersion = await conn.retrieveMaxApiVersion();
    const retrieveRequest = {
      apiVersion: apiVersion,
      singlePackage: true,
      unpackaged: {
        types: {
          name: 'ReportType',
          members: this.flags.reporttypename
        },
      },
    };

    conn.metadata.pollTimeout = 60;
    let retrieveId;
    await conn.metadata.retrieve(retrieveRequest, (error, result: AsyncResult) => {
      if (error) {
        return console.error(error);
      }
      retrieveId = result.id;
    });

    const retrieveResult = await checkRetrievalStatus(conn, retrieveId);
    if (!Array.isArray(retrieveResult.fileProperties)) {
      throw new SfdxError('Unable to find the requested Report Type');
    }

    // Extract Report Type
    if (!fs.existsSync(tempFolder)) {
      fs.mkdirSync(tempFolder);
    }
    const zipFileName = path.join(tempFolder, 'unpackaged.zip');
    fs.writeFileSync(zipFileName, retrieveResult.zipFile, { encoding: 'base64' });

    const extractFolder = path.join(tempFolder, 'extract');
    await unzip(zipFileName, extractFolder);
    // Delete Zip
    fs.unlinkSync(zipFileName);

    const resultFile = path.join(extractFolder, 'reportTypes', `${this.flags.reporttypename}.reportType`);
    
    const xmlString = fs.readFileSync(resultFile, "utf8");

    await parser.parseStringPromise(xmlString)
    .then(async (result) => {
      for(const section of result.ReportType.sections){
        let labels = {};
        for(const column of section.columns){
          try {
            labels[column.field[0] + column.table[0]] = await getFieldLabel(column.field[0], column.table[0]);
            // return;
            // console.log(`Label for ${column.field[0]}-----${column.table[0]}: ${labels[column.field[0] + column.table[0]]}`);
          } catch (error) {
            console.error(error);
            labels[column.field[0] + column.table[0]] = column.field[0];
            console.log(`(ERROR) Label for ${column.field[0]}-----${column.table[0]}: ${labels[column.field[0] + column.table[0]]}`);
          }
        }
        
        section.columns.sort((a, b) => {
          let labelA = labels[a.field[0] + a.table[0]];
          let labelB = labels[b.field[0] + b.table[0]];
          return labelA < labelB ? -1 : 1;
        });
      }
      //Result
      var builder = new xml2js.Builder({ xmldec: {standalone: null, encoding: 'UTF-8'}});
      const xml = builder.buildObject(result);
      fs.writeFileSync(resultFile, xml);
    })
    .catch((error) => {
      console.error(error);
    });

    const zipFile = path.join(tempFolder, 'package.zip');
    await zipper.zip(extractFolder, zipFile);

    // Deploy Report Type
    conn.metadata.pollTimeout = 300;
    let deployId: AsyncResult;

    var zipStream = fs.createReadStream(zipFile);
    await conn.metadata.deploy(zipStream, { rollbackOnError: true, singlePackage: true }, (error, result: AsyncResult) => {
        if (error) {
          return console.error(error);
        }
        deployId = result;
      }
    );

    this.ux.log(`Deploying Report Type to ${this.org.getUsername()}. ID ${deployId.id}`);
    let deployResult: DeployResult = await checkDeploymentStatus(conn, deployId.id);

    if (!deployResult.success) {
      throw new SfdxError(`Unable to deploy ReportType : ${deployResult.details['componentFailures']['problem']}`);
    }

    this.ux.log(`Report Type ${this.flags.reporttypename} sorted`);

    return {};
    // const query = 'Select Name, TrialExpirationDate from Organization';

    // The type we are querying for
    // interface Organization {
    //   Name: string;
    //   TrialExpirationDate: string;
    // }

    // // Query the org
    // const result = await conn.query<Organization>(query);

    // Organization will always return one result, but this is an example of throwing an error
    // The output and --json will automatically be handled for you.
    // if (!result.records || result.records.length <= 0) {
    //   throw new SfdxError(messages.getMessage('errorNoOrgResults', [this.org.getOrgId()]));
    // }

    // // Organization always only returns one result
    // const orgName = result.records[0].Name;
    // const trialExpirationDate = result.records[0].TrialExpirationDate;

    // let outputString = `Hello ${name}! This is org: ${orgName}`;
    // if (trialExpirationDate) {
    //   const date = new Date(trialExpirationDate).toDateString();
    //   outputString = `${outputString} and I will be around until ${date}!`;
    // }
    // this.ux.log(outputString);

    // // this.hubOrg is NOT guaranteed because supportsHubOrgUsername=true, as opposed to requiresHubOrgUsername.
    // if (this.hubOrg) {
    //   const hubOrgId = this.hubOrg.getOrgId();
    //   this.ux.log(`My hub org id is: ${hubOrgId}`);
    // }

    // if (this.flags.force && this.args.file) {
    //   this.ux.log(`You input --force and a file: ${this.args.file as string}`);
    // }

    // // Return an object to be displayed with --json
    // return { orgId: this.org.getOrgId(), outputString };
  }
}

const getFieldLabel = async (fieldName: string, objectPath: string) => {
  if (!objectDescribe[objectPath]) {
    objectDescribe[objectPath] = await getObjectDescribe(objectPath);
  }
  return await objectDescribe[objectPath].fields.filter(field => (field.name === fieldName || field.name === `${fieldName}Id`))[0].label;
};

const getObjectDescribe = async (objectPath: string) => {
  let objectPathSplit = objectPath.split('.');
  if (objectPathSplit.length === 1) {
    if(!objectDescribe[objectPath]){
      objectDescribe[objectPath] = await conn.describe(objectPath);
    }

    return await objectDescribe[objectPath];
  }
  let result = await getObjectDescribe(objectPathSplit.slice(0, -1).join('.'));
  let toReturn = await conn.describe(result.childRelationships.filter(relation => relation.relationshipName === objectPathSplit[objectPathSplit.length - 1])[0].childSObject);
  if(!objectDescribe[objectPath]){
    objectDescribe[objectPath] = toReturn;
  }
  return toReturn;
};

const checkRetrievalStatus = async (conn: Connection, retrievedId: string) => {
  let metadata_result;

  while (true) {
    await conn.metadata.checkRetrieveStatus(retrievedId, (error, result) => {
      if (error) {
        return new SfdxError(error.message);
      }
      metadata_result = result;
    });

    if (metadata_result.done === "false") {
      console.log('Polling...');
      await delay(5000);
    } else {
      //this.ux.logJson(metadata_result);
      break;
    }
  }
  return metadata_result;
};

const delay = async (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms));
}


const unzip = async (path: string, location: string) => {
  return new Promise((resolve, reject) => {
    fs.createReadStream(path)
      .pipe(unzipper.Extract({ path: `${location}` }))
      .on('close', () => {
        resolve();
      })
      .on('error', error => reject(error));
  });
};

const zipDirectory= async (source, out) => {
  const archive = archiver('zip', { zlib: { level: 9 } });
  const stream = fs.createWriteStream(out);

  return new Promise((resolve, reject) => {
    archive
      .directory(source, false)
      .on('error', err => reject(err))
      .pipe(stream);

    stream.on('close', () => resolve());
    archive.finalize();
  });
};

const checkDeploymentStatus = async (conn: Connection, retrievedId: string): Promise<DeployResult> => {
  let deployResult;

  while (true) {
    await conn.metadata.checkDeployStatus(retrievedId, true, (error,result) => {
      if (error) {
        throw new SfdxError(error.message);
      }
      deployResult = result;
    });

    if (!deployResult.done) {
      console.log("Polling for Deployment Status");
      await delay(5000);
    } else {
      break;
    }
  }
  return deployResult;
};