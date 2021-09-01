import { Connection, DeployResult } from 'jsforce';
import { SfdxError } from '@salesforce/core';
import { delay } from './delay';

const checkDeploymentStatus = async (conn: Connection, retrievedId: string): Promise<DeployResult> => {
  let deployResult;

  while (true) {
    await conn.metadata.checkDeployStatus(retrievedId, true, (error, result) => {
      if (error) {
        throw new SfdxError(error.message);
      }
      deployResult = result;
    });

    if (!deployResult.done) {
      await delay(5000);
    } else {
      break;
    }
  }
  return deployResult;
};

export { checkDeploymentStatus };
