/*
 * Copyright (c) 2020, salesforce.com, inc.
 * All rights reserved.
 * Licensed under the BSD 3-Clause license.
 * For full license text, see LICENSE.txt file in the repo root or https://opensource.org/licenses/BSD-3-Clause
 */
import { flags, SfdxCommand } from '@salesforce/command';
import { Messages, SfdxError } from '@salesforce/core';
import { AnyJson } from '@salesforce/ts-types';
import { AsyncResult, DeployResult } from 'jsforce';
import { checkRetrievalStatus } from '../../utils/metadataRetrieve';
import { checkDeploymentStatus } from '../../utils/metadataDeploy';
import { unzip } from '../../utils/zip';

const xml2js = require('xml2js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zipper = require('zip-a-folder');

// Initialize Messages with the current plugin directory
Messages.importMessagesDirectory(__dirname);

// Load the specific messages for this file. Messages from @salesforce/command, @salesforce/core,
// or any library that is using the messages framework can also be loaded this way.
const messages = Messages.loadMessages('report-type-sorter', 'order');

const objectDescribe = {};
const searchNames = {};
let conn;

export default class RtOrder extends SfdxCommand {
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
    reporttypename: flags.string({
      char: 'r',
      description: messages.getMessage('reportTypeNameDescription'),
      required: true,
    }),
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
          members: this.flags.reporttypename,
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

    this.ux.startSpinner(messages.getMessage('retrieveInProgress'));
    const retrieveResult = await checkRetrievalStatus(conn, retrieveId);
    this.ux.stopSpinner(messages.getMessage('done'));
    if (!Array.isArray(retrieveResult.fileProperties)) {
      throw new SfdxError(messages.getMessage('unableToFindReportType'));
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

    this.ux.startSpinner(messages.getMessage('ordering'));

    const xmlString = fs.readFileSync(resultFile, 'utf8');

    await new xml2js.Parser().parseStringPromise(xmlString)
      .then(async (result) => {
        for(const section of result.ReportType.sections) {
          const labels = {};
          for(const column of section.columns) {
            try {
              labels[column.field[0] + column.table[0]] = await getReportTypeLabel(column.field[0], column.table[0]);
            } catch (error) {
              labels[column.field[0] + column.table[0]] = column.field[0];
            }
          }
          
          section.columns.sort((a, b) => {
            const labelA = labels[a.field[0] + a.table[0]];
            const labelB = labels[b.field[0] + b.table[0]];
            return labelA < labelB ? -1 : 1;
          });
        }
        //Result back to XML
        const builder = new xml2js.Builder({ xmldec: { standalone: null, encoding: 'UTF-8' } });
        const xml = builder.buildObject(result);
        fs.writeFileSync(resultFile, xml);
      })
      .catch((error) => {
        throw new SfdxError(error);
      });

    this.ux.stopSpinner(messages.getMessage('done'));

    // Zip result
    const zipFile = path.join(tempFolder, 'package.zip');
    await zipper.zip(extractFolder, zipFile);

    // Deploy Report Type
    conn.metadata.pollTimeout = 300;
    let deployId: AsyncResult;

    const zipStream = fs.createReadStream(zipFile);
    await conn.metadata.deploy(
      zipStream,
      { rollbackOnError: true, singlePackage: true },
      (error, result: AsyncResult) => {
        if (error) {
          throw new SfdxError(error);
        }
        deployId = result;
      }
    );

    this.ux.startSpinner(messages.getMessage('deployRequested', [this.org.getUsername(), deployId.id]));
    const deployResult: DeployResult = await checkDeploymentStatus(conn, deployId.id);
    if (!deployResult.success) {
      throw new SfdxError(
        messages.getMessage('unableToDeployReportType', [deployResult.details['componentFailures']['problem']])
      );
    }
    this.ux.stopSpinner(messages.getMessage('done'));

    this.ux.log(messages.getMessage('reportTypeSorted', [this.flags.reporttypename]));

    return {};
  }
}

const getReportTypeLabel = async (fieldName: string, objectPath: string) => {
  if (!objectDescribe[objectPath]) {
    objectDescribe[objectPath] = await getBaseObjectDescribe(objectPath);
  }
  if (!fieldName.includes('.')) {
    return await getFieldLabel(fieldName, objectPath);
  } else {
    const fieldNameSplit = fieldName.split('.');
    const pathToTheField = fieldNameSplit.slice(0, -1).join('.'); // All bust last element
    const fieldToRetrieve = fieldNameSplit[fieldNameSplit.length - 1]; // Get last split element
    const parentFieldLabel = await getParentFieldLabel(pathToTheField, objectPath);
    const finalLabel = await getFieldLabel(fieldToRetrieve, parentFieldLabel.finalObject);
    return `${parentFieldLabel.prefixLabel}${finalLabel}`;
  }
};

const getBaseObjectDescribe = async (objectPath: string) => {
  const objectPathSplit = objectPath.split('.');
  if (objectPathSplit.length === 1) {
    if (!objectDescribe[objectPath]) {
      objectDescribe[objectPath] = await conn.describe(objectPath);
    }
    return await objectDescribe[objectPath];
  }
  const result = await getBaseObjectDescribe(objectPathSplit.slice(0, -1).join('.'));
  const toReturn = await conn.describe(result.childRelationships.filter(relation => relation.relationshipName === objectPathSplit[objectPathSplit.length - 1])[0].childSObject);
  if (!objectDescribe[objectPath]) {
    objectDescribe[objectPath] = toReturn;
  }
  return toReturn;
};

const getFieldLabel = async (fieldName: string, objectPath: string) => {
  let fieldDescribe = objectDescribe[objectPath].fields.filter(field => (field.name === fieldName || field.name === `${fieldName}Id`))[0];

  if (fieldDescribe.type === 'reference' && fieldDescribe.referenceTo != 'RecordType') {
    let searchName;
    try {
      searchName = await getSearchName(fieldDescribe.referenceTo);
    } catch (error) {
      searchName = ' ';
    }
    return `${fieldDescribe.label}: ${searchName}`;
  } else {
    return fieldDescribe.label != 'Record ID' ? fieldDescribe.label : `${objectDescribe[objectPath].label} ID`;
  }
};

const getSearchName = async (objectName: string) => {
  if (!searchNames[objectName]) {
    const query = `select Id, FieldsDisplayed, Profile, ProfileName from SearchLayout where EntityDefinition.QualifiedApiName = '${objectName}' and LayoutType = 'SearchResult' and Profile = null`;
    const queryResult = await conn.query(query);
    searchNames[objectName] = queryResult.records[0].FieldsDisplayed.fields[0].label;
  }
  return await searchNames[objectName];
};

const getParentFieldLabel = async (pathToTheField: string, baseObject: string) => {
  let label = '';
  for (const parentObject of pathToTheField.split('.')) {
    const fieldDescribe = objectDescribe[baseObject].fields.filter(field => field.name === parentObject || field.name === `${parentObject}Id`)[0];
    label += `${fieldDescribe.label}: `;
    // Preparing for next iteration
    baseObject = fieldDescribe.referenceTo;
    if (!objectDescribe[baseObject]) {
      objectDescribe[baseObject] = await conn.describe(baseObject);
    }
  }

  const result = {
    prefixLabel: label,
    finalObject: baseObject,
  };
  return result;
};
