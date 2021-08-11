import { Connection, RetrieveResult } from 'jsforce';
import { SfdxError } from '@salesforce/core';
import { delay } from './delay';

const checkRetrievalStatus = async (conn: Connection, retrievedId: string): Promise<RetrieveResult> => {
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

export { checkRetrievalStatus };
