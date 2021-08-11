const fs = require('fs');
const unzipper = require('unzip-stream');

const unzip = async (path: string, location: string): Promise<void> => {
  return new Promise<void>((resolve, reject) => {
    fs.createReadStream(path)
        .pipe(unzipper.Extract({ path: location }))
        .on('close', () => {
          resolve();
        })
      .on('error', (error) => reject(error));
  });
};

export { unzip };
