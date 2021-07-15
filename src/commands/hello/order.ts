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
const unzipper = require('unzip-stream');
const os = require('os');
const path = require('path');
const zipper = require('zip-a-folder');

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('reportTypeSorter', 'order');

const objectDescribe = {};
let conn;

/////TODO: CACHED CALLs
//https://jsforce.github.io/document/

//TODO: messages
//throw new SfdxError(messages.getMessage('errorNoOrgResults', [this.org.getOrgId()]));

//TODO: Account.Retailer

export default class Org extends SfdxCommand {
  public static description = messages.getMessage('commandDescription');

  public static examples = [
    `$ sfdx rt:order --targetusername myOrg@example.com -r Service_Contracts_with_Entitlements
    Applying alphabetical order
    Deploying Report Type to alice@s4g.es with ID 0Af3X00000dpGJMSA2
    Deploying...
    Report Type Service_Contracts_with_Entitlements sorted
  `,
  ];

  protected static flagsConfig = {
    reporttypename: flags.string({char: 'r', description: messages.getMessage('reportTypeNameDescription'), required: true}),
  };

  // Comment this out if your command does not require an org username
  protected static requiresUsername = true;

  // Set this to true if your command requires a project workspace; 'requiresProject' is false by default
  protected static requiresProject = false;

  public async run(): Promise<AnyJson> {
    // Remove temp folder if any
    const tempFolder = path.join(os.tmpdir(), 'reportTypeSorter');
    if (fs.existsSync(tempFolder)) {
      fs.rmdirSync(tempFolder, { recursive: true });
    }

    // this.org is guaranteed because requiresUsername=true, as opposed to supportsUsername
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
        throw new SfdxError(error);
      }
      retrieveId = result.id;
    });

    const retrieveResult = await checkRetrievalStatus(conn, retrieveId);
    if (!Array.isArray(retrieveResult.fileProperties)) {
      throw new SfdxError('Unable to find the requested Report Type');
    }

    // Create temp folder
    fs.mkdirSync(tempFolder);

    // Extract Report Type
    const zipFileName = path.join(tempFolder, 'unpackaged.zip');
    fs.writeFileSync(zipFileName, retrieveResult.zipFile, { encoding: 'base64' });
    const extractFolder = path.join(tempFolder, 'extract');
    try {
      await unzip(zipFileName, extractFolder);
    } catch (error) {
      throw new SfdxError(error);
    }

    // Delete Zip
    fs.unlinkSync(zipFileName);

    const resultFile = path.join(extractFolder, 'reportTypes', `${this.flags.reporttypename}.reportType`);

    this.ux.log(`Applying alphabetical order`);
    const xmlString = fs.readFileSync(resultFile, 'utf8');

    await new xml2js.Parser().parseStringPromise(xmlString)
      .then(async (result) => {
        for(const section of result.ReportType.sections){
          let labels = {};
          for(const column of section.columns){
            try {
              labels[column.field[0] + column.table[0]] = await getFieldLabel(column.field[0], column.table[0]);
            } catch (error) {
              labels[column.field[0] + column.table[0]] = column.field[0];
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
        throw new SfdxError(error);
      });

    // Zip result
    const zipFile = path.join(tempFolder, 'package.zip');
    await zipper.zip(extractFolder, zipFile);

    // Deploy Report Type
    conn.metadata.pollTimeout = 300;
    let deployId: AsyncResult;

    var zipStream = fs.createReadStream(zipFile);
    await conn.metadata.deploy(zipStream, { rollbackOnError: true, singlePackage: true }, (error, result: AsyncResult) => {
        if (error) {
          throw new SfdxError(error);
        }
        deployId = result;
      }
    );
    this.ux.log(`Deploying Report Type to ${this.org.getUsername()} with ID ${deployId.id}`);
    let deployResult: DeployResult = await checkDeploymentStatus(conn, deployId.id);
    if (!deployResult.success) {
      throw new SfdxError(`Unable to deploy ReportType : ${deployResult.details['componentFailures']['problem']}`);
    }

    this.ux.log(`Report Type ${this.flags.reporttypename} sorted`);

    return {};
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
  let metadataResult;

  while (true) {
    await conn.metadata.checkRetrieveStatus(retrievedId, (error, result) => {
      if (error) {
        return new SfdxError(error.message);
      }
      metadataResult = result;
    });

    if (metadataResult.done === 'false') {
      console.log('Retrieving Report Type...');
      await delay(5000);
    } else {
      break;
    }
  }
  return metadataResult;
};

const delay = async (ms: number) => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

const unzip = async (path: string, location: string) => {
  return new Promise((resolve, reject) => {
    fs.createReadStream(path)
      .pipe(unzipper.Extract({ path: location }))
      .on('close', () => {
        resolve();
      })
      .on('error', (error) => reject(error));
  });
};

const checkDeploymentStatus = async (conn: Connection, retrievedId: string): Promise<DeployResult> => {
  let deployResult;

  while (true) {
    await conn.metadata.checkDeployStatus(retrievedId, true, (error, result) => {
      if (error) {
        throw new SfdxError(error);
      }
      deployResult = result;
    });

    if (!deployResult.done) {
      console.log('Deploying...');
      await delay(5000);
    } else {
      break;
    }
  }
  return deployResult;
};
