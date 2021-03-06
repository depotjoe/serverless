'use strict';

const chai = require('chai');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JsZip = require('jszip');
const _ = require('lodash');
const Package = require('../package');
const Serverless = require('../../../Serverless');
const testUtils = require('../../../../tests/utils');

// Configure chai
chai.use(require('chai-as-promised'));
const expect = require('chai').expect;

describe('#zipService()', () => {
  let serverless;
  let packageService;
  let zip;

  const testDirectory = {
    // root
    '.': {
      'event.json': 'some content',
      'handler.js': 'some content',
      'file-1': 'some content',
      'file-2': 'some content',
    },
    // bin
    bin: {
      'binary-777': {
        content: 'some content',
        permissions: 777,
      },
      'binary-444': {
        content: 'some content',
        permissions: 444,
      },
    },
    // lib
    lib: {
      'file-1.js': 'some content',
    },
    'lib/directory-1': {
      'file-1.js': 'some content',
    },
    // node_modules
    'node_modules/directory-1': {
      'file-1': 'some content',
      'file-2': 'some content',
    },
    'node_modules/directory-2': {
      'file-1': 'some content',
      'file-2': 'some content',
    },
  };

  function getTestArtifactFileName(testName) {
    return `test-${testName}-${(new Date()).getTime().toString()}.zip`;
  }

  beforeEach(() => {
    serverless = new Serverless();
    zip = new JsZip();
    packageService = new Package(serverless, {});
    packageService.serverless.cli = new serverless.classes.CLI();

    // create a mock service in a temporary directory
    const tmpDirPath = testUtils.getTmpDirPath();

    Object.keys(testDirectory).forEach(dirName => {
      const dirPath = path.join(tmpDirPath, dirName);
      const files = testDirectory[dirName];

      Object.keys(files).forEach(fileName => {
        const filePath = path.join(dirPath, fileName);
        const fileValue = files[fileName];
        const file = _.isObject(fileValue) ? fileValue : { content: fileValue };

        if (!file.content) {
          throw new Error('File content is required');
        }

        serverless.utils.writeFileSync(filePath, file.content);

        if (file.permissions) {
          fs.chmodSync(filePath, file.permissions);
        }
      });
    });
    // set the service name
    serverless.service.service = 'first-service';

    // set the servicePath
    serverless.config.servicePath = tmpDirPath;
  });

  it('should zip a whole service (without include / exclude usage)', () => {
    const exclude = [];
    const include = [];
    const zipFileName = getTestArtifactFileName('whole-service');

    return expect(packageService.zipDirectory(exclude, include, zipFileName))
      .to.eventually.be.equal(path.join(serverless.config.servicePath, '.serverless', zipFileName))
    .then(artifact => {
      const data = fs.readFileSync(artifact);
      return expect(zip.loadAsync(data)).to.be.fulfilled;
    })
    .then(unzippedData => {
      const unzippedFileData = unzippedData.files;

      expect(Object.keys(unzippedFileData)
       .filter(file => !unzippedFileData[file].dir))
       .to.be.lengthOf(13);

      // root directory
      expect(unzippedFileData['event.json'].name)
        .to.equal('event.json');
      expect(unzippedFileData['handler.js'].name)
        .to.equal('handler.js');
      expect(unzippedFileData['file-1'].name)
        .to.equal('file-1');
      expect(unzippedFileData['file-2'].name)
        .to.equal('file-2');

      // bin directory
      expect(unzippedFileData['bin/binary-777'].name)
        .to.equal('bin/binary-777');
      expect(unzippedFileData['bin/binary-444'].name)
        .to.equal('bin/binary-444');

      // lib directory
      expect(unzippedFileData['lib/file-1.js'].name)
        .to.equal('lib/file-1.js');
      expect(unzippedFileData['lib/directory-1/file-1.js'].name)
        .to.equal('lib/directory-1/file-1.js');

      // node_modules directory
      expect(unzippedFileData['node_modules/directory-1/file-1'].name)
        .to.equal('node_modules/directory-1/file-1');
      expect(unzippedFileData['node_modules/directory-1/file-2'].name)
        .to.equal('node_modules/directory-1/file-2');
      expect(unzippedFileData['node_modules/directory-2/file-1'].name)
        .to.equal('node_modules/directory-2/file-1');
      expect(unzippedFileData['node_modules/directory-2/file-2'].name)
        .to.equal('node_modules/directory-2/file-2');
    });
  });

  it('should keep file permissions', () => {
    const exclude = [];
    const include = [];
    const zipFileName = getTestArtifactFileName('file-permissions');

    return expect(packageService.zipDirectory(exclude, include, zipFileName))
      .to.eventually.be.equal(path.join(serverless.config.servicePath, '.serverless', zipFileName))
    .then(artifact => {
      const data = fs.readFileSync(artifact);
      return expect(zip.loadAsync(data)).to.be.fulfilled;
    }).then(unzippedData => {
      const unzippedFileData = unzippedData.files;

      if (os.platform() === 'win32') {
        // chmod does not work right on windows. this is better than nothing?
        expect(unzippedFileData['bin/binary-777'].unixPermissions)
          .to.not.equal(unzippedFileData['bin/binary-444'].unixPermissions);
      } else {
        // binary file is set with chmod of 777
        expect(unzippedFileData['bin/binary-777'].unixPermissions)
          .to.equal(Math.pow(2, 15) + 777);

        // read only file is set with chmod of 444
        expect(unzippedFileData['bin/binary-444'].unixPermissions)
          .to.equal(Math.pow(2, 15) + 444);
      }
    });
  });

  it('should exclude with globs', () => {
    const exclude = [
      'event.json',
      'lib/**',
      'node_modules/directory-1/**',
    ];
    const include = [];

    const zipFileName = getTestArtifactFileName('exclude-with-globs');

    return expect(packageService.zipDirectory(exclude, include, zipFileName))
      .to.eventually.be.equal(path.join(serverless.config.servicePath, '.serverless', zipFileName))
    .then(artifact => {
      const data = fs.readFileSync(artifact);
      return expect(zip.loadAsync(data)).to.be.fulfilled;
    }).then(unzippedData => {
      const unzippedFileData = unzippedData.files;

      expect(Object.keys(unzippedFileData)
        .filter(file => !unzippedFileData[file].dir))
        .to.be.lengthOf(8);

      // root directory
      expect(unzippedFileData['handler.js'].name)
        .to.equal('handler.js');
      expect(unzippedFileData['file-1'].name)
        .to.equal('file-1');
      expect(unzippedFileData['file-2'].name)
        .to.equal('file-2');

      // bin directory
      expect(unzippedFileData['bin/binary-777'].name)
        .to.equal('bin/binary-777');
      expect(unzippedFileData['bin/binary-444'].name)
        .to.equal('bin/binary-444');

      // node_modules directory
      expect(unzippedFileData['node_modules/directory-2/file-1'].name)
        .to.equal('node_modules/directory-2/file-1');
      expect(unzippedFileData['node_modules/directory-2/file-2'].name)
        .to.equal('node_modules/directory-2/file-2');
    });
  });

  it('should re-include files using ! glob pattern', () => {
    const exclude = [
      'event.json',
      'lib/**',
      'node_modules/directory-1/**',

      '!event.json', // re-include
      '!lib/**', // re-include
    ];
    const include = [];

    const zipFileName = getTestArtifactFileName('re-include-with-globs');

    return expect(packageService.zipDirectory(exclude, include, zipFileName))
      .to.eventually.be.equal(path.join(serverless.config.servicePath, '.serverless', zipFileName))
    .then(artifact => {
      const data = fs.readFileSync(artifact);
      return expect(zip.loadAsync(data)).to.be.fulfilled;
    }).then(unzippedData => {
      const unzippedFileData = unzippedData.files;

      expect(Object.keys(unzippedFileData)
        .filter(file => !unzippedFileData[file].dir))
        .to.be.lengthOf(11);

      // root directory
      expect(unzippedFileData['event.json'].name)
        .to.equal('event.json');
      expect(unzippedFileData['handler.js'].name)
        .to.equal('handler.js');
      expect(unzippedFileData['file-1'].name)
        .to.equal('file-1');
      expect(unzippedFileData['file-2'].name)
        .to.equal('file-2');

      // bin directory
      expect(unzippedFileData['bin/binary-777'].name)
        .to.equal('bin/binary-777');
      expect(unzippedFileData['bin/binary-444'].name)
        .to.equal('bin/binary-444');

      // lib directory
      expect(unzippedFileData['lib/file-1.js'].name)
        .to.equal('lib/file-1.js');
      expect(unzippedFileData['lib/directory-1/file-1.js'].name)
        .to.equal('lib/directory-1/file-1.js');

      // node_modules directory
      expect(unzippedFileData['node_modules/directory-2/file-1'].name)
        .to.equal('node_modules/directory-2/file-1');
      expect(unzippedFileData['node_modules/directory-2/file-2'].name)
        .to.equal('node_modules/directory-2/file-2');
    });
  });

  it('should re-include files using include config', () => {
    const exclude = [
      'event.json',
      'lib/**',
      'node_modules/directory-1/**',
    ];
    const include = [
      'event.json',
      'lib/**',
    ];

    const zipFileName = getTestArtifactFileName('re-include-with-include');

    return expect(packageService.zipDirectory(exclude, include, zipFileName))
      .to.eventually.be.equal(path.join(serverless.config.servicePath, '.serverless', zipFileName))
    .then(artifact => {
      const data = fs.readFileSync(artifact);
      return expect(zip.loadAsync(data)).to.be.fulfilled;
    }).then(unzippedData => {
      const unzippedFileData = unzippedData.files;

      expect(Object.keys(unzippedFileData)
        .filter(file => !unzippedFileData[file].dir))
        .to.be.lengthOf(11);

      // root directory
      expect(unzippedFileData['event.json'].name)
        .to.equal('event.json');
      expect(unzippedFileData['handler.js'].name)
        .to.equal('handler.js');
      expect(unzippedFileData['file-1'].name)
        .to.equal('file-1');
      expect(unzippedFileData['file-2'].name)
        .to.equal('file-2');

      // bin directory
      expect(unzippedFileData['bin/binary-777'].name)
        .to.equal('bin/binary-777');
      expect(unzippedFileData['bin/binary-444'].name)
        .to.equal('bin/binary-444');

      // lib directory
      expect(unzippedFileData['lib/file-1.js'].name)
        .to.equal('lib/file-1.js');
      expect(unzippedFileData['lib/directory-1/file-1.js'].name)
        .to.equal('lib/directory-1/file-1.js');

      // node_modules directory
      expect(unzippedFileData['node_modules/directory-2/file-1'].name)
        .to.equal('node_modules/directory-2/file-1');
      expect(unzippedFileData['node_modules/directory-2/file-2'].name)
        .to.equal('node_modules/directory-2/file-2');
    });
  });
});
